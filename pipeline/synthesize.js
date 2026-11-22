#!/usr/bin/env node
// synthesize.js — aggregate strengths: per-domain LLM synthesis of all upstream rules into one canonical set.
// Contradictions the model cannot reconcile come back as dilemmas -> conflicts/*.yml -> arbitration.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, FILES } from './lib/env.js';
import { log, readYAML, writeYAML, readJSON, writeJSON, listYAMLFiles, ruleHash, nextId, conflictFingerprint, sha1, tokens, jaccard } from './lib/util.js';
import { chatJSON } from './lib/llm.js';

const DOMAINS = ['color', 'type', 'layout', 'motion', 'a11y', 'copy', 'imagery', 'code', 'process'];
const STATE_FILE = path.join(DIRS.work, 'synthesize-state.json'); // input digest — skip LLM when nothing changed

const SYSTEM = `You synthesize one canonical UI-design rule set per domain from rules collected across several upstream skills — the "aggregate the strengths" step.

Rules:
- CONSOLIDATE AGGRESSIVELY: emit strictly FEWER rules than the input count — fold 2-5 inputs into each output by merging rules that say the same thing differently into the single strongest statement (union of allowances, strictest compatible constraint). Splitting one input into several outputs is forbidden.
- Where variants differ only in degree (thresholds, counts), pick the most defensible or write a scope-split ("for X ..., for Y ...").
- Rewrite in your own words (license hygiene). Keep each rule self-contained and actionable.
- Every output rule carries "source_ids" listing the input rule ids it was synthesized from. Do NOT emit severity/scope/evidence — those are derived downstream.
- TRUE DILEMMAS ONLY: if two input rules directly contradict in the same scope and no reasonable pick/scope-split resolves them, OMIT the contested claim from rules[]. (Dilemmas are adjudicated in a separate pass.)
- Output rule ids: short slugs like "no-transition-all".`;

const RULES_SHAPE = `{"rules":[{"id":"slug","rule":"sentence","source_ids":["hallma-001","taste--042"]}]}`;

const DILEMMA_SYSTEM = `You find TRUE dilemmas between UI-design rules from different upstream skills: pairs that directly contradict in the same scope where NO reasonable pick or scope-split resolves them ("never X" vs "always X"). Most pairs are reconcilable — report only real dilemmas. For each, cite the two input ids and give a bilingual explanation plus a suggested resolution.`;

const DILEMMA_SHAPE = `{"dilemmas":[{"a_id":"hallma-001","b_id":"taste--042","explanation":"EN","explanation_zh":"中文","kind":"keep-a|keep-b|scope-split|merge","note":"...","note_zh":"中文"}]}`;

function loadExtracted() {
  const all = [];
  for (const f of listYAMLFiles(DIRS.extracted)) {
    const doc = readYAML(f);
    const name = path.basename(f, '.yml');
    for (const r of doc.rules ?? []) all.push({ ...r, source: name });
  }
  return all;
}

function loadConflicts() {
  return listYAMLFiles(DIRS.conflicts).map((f) => ({ file: f, ...readYAML(f) }));
}

function loadDecisions() {
  return new Map(listYAMLFiles(DIRS.decisions).map((f) => {
    const d = readYAML(f);
    return [d.id, { file: f, ...d }];
  }));
}

const VALID_SCOPE = new Set(DOMAINS);

const CHUNK = 50;      // rules per synthesis call — bigger chunks overrun the output token budget on this model
const CONSOLIDATE = 80; // rules fed into the merge pass
const POOL = Number(process.env.SYNTH_POOL ?? 3); // parallel LLM calls — omlx is a single-stream local server

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/** Consolidate one unit of rules. Returns {rules} — dilemma detection runs once per domain
 * on the FINAL synthesized set (see detectDilemmas), so cross-chunk contradictions aren't missed. */
async function synthUnit(domain, rules, refs, label) {
  const user = `DOMAIN: ${domain}\n\nINPUT RULES:\n${rules.map((r) => `${r.id} [${r.severity ?? 'reflex'}] ${r.rule}`).join('\n')}`;
  const out = await chatJSON({
    thinking: false, temperature: 0.4, maxTokens: 32768,
    label, system: SYSTEM, user, shapeDesc: RULES_SHAPE,
    validate: (o) => {
      if (!Array.isArray(o?.rules)) return 'missing rules[]';
      if (o.rules.length > rules.length) return `must not emit more than ${rules.length} rules (got ${o.rules.length}) — splitting is forbidden`;
      let orphaned = 0;
      for (const r of o.rules) {
        if (!r.rule || !Array.isArray(r.source_ids)) return `bad rule: ${JSON.stringify(r).slice(0, 120)}`;
        // strip hallucinated ids instead of failing — provenance is best-effort
        r.source_ids = r.source_ids.filter((id) => refs.has(id));
        if (!r.source_ids.length) orphaned++;
      }
      // a few hallucinated rules are dropped; systemic hallucination fails the call
      if (orphaned > Math.max(3, o.rules.length >> 2)) return `${orphaned} rules lost all provenance`;
      o.rules = o.rules.filter((r) => r.source_ids.length);
      return true;
    },
  });
  return { rules: out.rules, dilemmas: [] };
}

/** One dilemma pass over a domain's FINAL synthesized rules — pairs that stayed contradictory
 * after consolidation are the true dilemmas. Each side resolves to its first original source rule. */
async function detectDilemmas(domain, rules, label) {
  const refs = new Map(rules.map((r) => [r.id, r]));
  const user = `DOMAIN: ${domain}\n\nRULES:\n${rules.map((r) => `${r.id}: ${r.rule}`).join('\n')}`;
  const out = await chatJSON({
    thinking: false, temperature: 0.4, maxTokens: 32768,
    label, system: DILEMMA_SYSTEM, user, shapeDesc: DILEMMA_SHAPE,
    validate: (o) => {
      if (!Array.isArray(o?.dilemmas)) return 'missing dilemmas[]';
      for (const d of o.dilemmas) if (!refs.has(d.a_id) || !refs.has(d.b_id) || d.a_id === d.b_id) return 'dilemma refs unknown ids';
      return true;
    },
  });
  return out.dilemmas;
}

/** Run synthesis over a rule set, chunking when >CHUNK. depth>0 tags ids so source_ids resolve back
 * to original rule ids through each level. Returns {rules, dilemmas} with ids normalized to originals. */
async function synthSet(domain, input, label, depth = 0) {
  const nChunks = Math.ceil(input.length / CHUNK);
  if (nChunks <= 1) {
    return synthUnit(domain, input, new Map(input.map((r) => [r.id, r])), label);
  }
  log(`synthesize: ${domain} level-${depth} split into ${nChunks} chunks (~${CHUNK}/chunk)`);

  const chunks = [];
  input.forEach((r, i) => {
    (chunks[i % nChunks] ??= []).push(r); // interleave upstreams — cross-source conflicts stay visible
  });

  const partials = await pool(chunks, POOL, async (chunk, ci) => {
    try {
      const out = await synthUnit(domain, chunk, new Map(chunk.map((r) => [r.id, r])), `${label}:c${ci + 1}`);
      for (const r of out.rules) r.id = `${domain}-l${depth}c${ci + 1}-${r.id ?? 'r'}`;
      return out;
    } catch (e) {
      // one bad chunk must not kill the domain — fall back to raw inputs so no rules are lost
      log(`synthesize: ${label}:c${ci + 1} failed (${e.message.split('\n')[0]}); passing ${chunk.length} inputs through unsynthesized`);
      return {
        rules: chunk.map((r) => ({ id: `${domain}-l${depth}c${ci + 1}-${r.id}`, rule: r.rule, source_ids: r.source_ids ?? [r.id] })),
        dilemmas: [],
      };
    }
  });

  const midRules = partials.flatMap((p) => p.rules);
  const midRefs = new Map(midRules.map((r) => [r.id, r]));

  if (midRules.length <= CONSOLIDATE || depth >= 2) return { rules: midRules, dilemmas: [] };

  const final = await synthSet(domain, midRules, `${label}:cons`, depth + 1);
  for (const r of final.rules) {
    const through = new Set();
    for (const mid of r.source_ids) for (const src of midRefs.get(mid)?.source_ids ?? []) through.add(src);
    r.source_ids = [...through];
  }
  return { rules: final.rules, dilemmas: [] };
}

async function synthDomain(domain, input) {
  return synthSet(domain, input, `synth:${domain}`, 0);
}

const SEV_RANK = { floor: 0, reflex: 1, finish: 2, guidance: 3 };
const EV_RANK = { none: 0, audit: 1, recording: 2, screenshot: 3 };

/** Deterministic post-pass: union-find merge of near-verbatim duplicates (Jaccard ≥ 0.9 on
 * content tokens). Chunked synthesis often emits the same rule twice from different chunks —
 * folding them keeps one survivor with unioned provenance/scope, strictest severity, strongest
 * evidence. Arbitrated rules (decidedBy) are never absorbed. */
function dedupeMerged(rules) {
  const parent = rules.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const toks = rules.map((r) => tokens(r.rule));
  const pairs = [];
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      if (rules[i].decidedBy || rules[j].decidedBy) continue;
      const sim = jaccard(toks[i], toks[j]);
      if (sim >= 0.9) pairs.push([sim, i, j]);
    }
  }
  pairs.sort((a, b) => b[0] - a[0]); // most-identical first — deterministic merge order
  for (const [, i, j] of pairs) {
    const ri = find(i), rj = find(j);
    if (ri === rj) continue;
    const a = rules[ri], b = rules[rj];
    // survivor: stricter severity, then longer (more detailed) text
    const keepA = SEV_RANK[a.severity] !== SEV_RANK[b.severity]
      ? SEV_RANK[a.severity] < SEV_RANK[b.severity]
      : a.rule.length >= b.rule.length;
    const [keep, drop, keepRoot, dropRoot] = keepA ? [a, b, ri, rj] : [b, a, rj, ri];
    keep.sources = [...new Map([...keep.sources, ...drop.sources].map((s) => [`${s.source}:${s.id}`, s])).values()];
    keep.scope = [...new Set([...keep.scope, ...drop.scope])];
    keep.mechanizable ||= drop.mechanizable;
    if ((EV_RANK[drop.evidence] ?? 0) > (EV_RANK[keep.evidence] ?? 0)) keep.evidence = drop.evidence;
    parent[dropRoot] = keepRoot;
  }
  return rules.filter((_, i) => find(i) === i);
}

export async function synthesize({ applyOnly = false, onlyDomain = null } = {}) {
  const rules = loadExtracted();
  log(`synthesize: ${rules.length} extracted rules in`);

  // exact-hash dedupe
  const byHash = new Map();
  for (const r of rules) {
    if (byHash.has(r.hash)) byHash.get(r.hash).sources.push({ source: r.source, id: r.id });
    else byHash.set(r.hash, { ...r, sources: [{ source: r.source, id: r.id }] });
  }
  const canonical = [...byHash.values()];
  log(`synthesize: ${canonical.length} canonical after dedupe`);

  const conflicts = loadConflicts();
  const decisions = loadDecisions();
  const conflictByFp = new Map(conflicts.map((c) => [c.fingerprint, c]));
  const held = new Set();      // pending conflict sides stay out of synthesis inputs
  const absorbed = new Set();  // decision losers / merge-custom replaced sides
  const overlays = [];         // merge/custom decision-authored rules

  for (const c of conflicts) {
    const dec = decisions.get(c.id);
    const sideHash = (key) => c.sides.find((s) => s.key === key)?.hash;
    if (dec?.status === 'active') {
      if ((dec.resolution === 'merge' || dec.resolution === 'custom') && dec.custom) {
        for (const s of c.sides) absorbed.add(s.hash);
        overlays.push({
          id: `${c.id}-merged`,
          rule: dec.custom,
          severity: dec.severity ?? 'reflex',
          scope: dec.scope ?? ['process'],
          evidence: dec.evidence ?? 'none',
          mechanizable: dec.mechanizable ?? false,
          sources: c.sides.map((s) => ({ source: s.source, id: s.rule_id })),
          decidedBy: c.id,
        });
      } else {
        const drop = dec.resolution === 'B' ? 'A' : 'B';
        const dh = sideHash(drop);
        if (dh) absorbed.add(dh);
      }
    } else if (c.status === 'pending') {
      for (const s of c.sides ?? []) held.add(s.hash);
    }
  }

  const inputs = canonical.filter((r) => !absorbed.has(r.hash) && !held.has(r.hash));

  if (applyOnly) {
    writeYAML(FILES.mergedRules, { generated: new Date().toISOString(), count: inputs.length + overlays.length, rules: [...inputs, ...overlays] });
    log(`synthesize: --apply-only wrote ${inputs.length + overlays.length} rules (no LLM)`);
    return;
  }

  // group by primary scope (first listed) so every rule is synthesized exactly once
  const byDomain = new Map(DOMAINS.map((d) => [d, []]));
  for (const r of inputs) byDomain.get(r.scope?.[0] && byDomain.has(r.scope[0]) ? r.scope[0] : 'process').push(r);

  // per-domain incremental: a new pending dilemma only holds sides in ITS domain, so unchanged
  // domains reuse their previous synthesized rules instead of re-running ~10 LLM calls
  const state = readJSON(STATE_FILE) ?? {};
  const prev = readYAML(FILES.mergedRules);
  const prevByDomain = new Map(DOMAINS.map((d) => [d, (prev?.rules ?? []).filter((r) => r.synthesizedFrom === `domain:${d}`)]));
  const domDigest = (d) => sha1(JSON.stringify({
    in: byDomain.get(d).map((r) => r.hash).sort(),
    ov: overlays.filter((o) => (o.scope?.[0] ?? 'process') === d).map((o) => o.rule).sort(),
  }));
  const newDigests = { ...(state.domains ?? {}) };

  const synthRules = [];
  let dilemmaCount = 0;

  for (const domain of DOMAINS) {
    if (onlyDomain && domain !== onlyDomain) continue;
    const dom = byDomain.get(domain);
    if (!dom.length) continue;
    const input = dom; // rule ids are already unique slugs — use them as source_ids directly
    const idToRule = new Map(input.map((r) => [r.id, r]));
    const dg = domDigest(domain);

    const reusable = prevByDomain.get(domain) ?? [];
    if (state.domains?.[domain] === dg && reusable.length) {
      log(`synthesize [${DOMAINS.indexOf(domain) + 1}/${DOMAINS.length}]: ${domain} — inputs unchanged, reusing ${reusable.length} rules`);
      synthRules.push(...reusable);
      continue;
    }
    log(`synthesize [${DOMAINS.indexOf(domain) + 1}/${DOMAINS.length}]: ${domain} — ${input.length} input rules`);
    newDigests[domain] = dg;

    const out = await synthDomain(domain, input);

    const sevRank = (s) => SEV_RANK[s] ?? 3;
    for (const r of out.rules) {
      const srcIds = new Set(r.source_ids);
      const srcs = input.filter((r2) => srcIds.has(r2.id));
      // metadata derived from sources: strictest severity wins, evidence = strongest available
      const severity = srcs.map((s) => s.severity).sort((a, b) => sevRank(a) - sevRank(b))[0] ?? 'guidance';
      const evidence = ['screenshot', 'recording', 'audit'].find((e) => srcs.some((s) => s.evidence === e)) ?? 'none';
      const scope = [...new Set(srcs.flatMap((s) => s.scope ?? []))].filter((s) => VALID_SCOPE.has(s));
      synthRules.push({
        id: `${domain}--${r.id ?? synthRules.length}`,
        rule: r.rule,
        severity,
        scope: scope.length ? scope : [domain],
        evidence,
        mechanizable: srcs.some((s) => s.mechanizable),
        hash: ruleHash(r.rule),
        sources: srcs.flatMap((r2) => r2.sources),
        synthesizedFrom: `domain:${domain}`,
      });
    }

    // dilemma pass on the final synthesized set — catches contradictions spanning chunks;
    // each side resolves back to its first original source rule
    const synthById = new Map(out.rules.map((r) => [r.id, r]));
    let dilemmas = [];
    try {
      dilemmas = await detectDilemmas(domain, out.rules, `synth:${domain}:dilemmas`);
    } catch (e) {
      log(`synthesize: ${domain} dilemma pass failed (${e.message.split('\n')[0]}); continuing without`);
    }
    const seenPair = new Set();
    for (const d of dilemmas) {
      const aId = synthById.get(d.a_id)?.source_ids?.[0] ?? d.a_id;
      const bId = synthById.get(d.b_id)?.source_ids?.[0] ?? d.b_id;
      const ra = idToRule.get(aId), rb = idToRule.get(bId);
      if (!ra || !rb || aId === bId) { log(`synthesize: dilemma with unresolvable ids ${d.a_id}~${d.b_id}, skipped`); continue; }
      // guards against non-dilemmas the detector files anyway — restatements aren't contradictions
      if (jaccard(tokens(ra.rule), tokens(rb.rule)) >= 0.8) {
        log(`synthesize: near-identical sides ${aId}~${bId} skipped (restatement, not a dilemma)`); continue;
      }
      if (/not contradict|no (true )?dilemma|identical|redundant|same directive|do not conflict/i.test(d.explanation ?? '')) {
        log(`synthesize: self-admitted non-dilemma ${aId}~${bId} skipped`); continue;
      }
      const fp = conflictFingerprint([{ text: ra.rule }, { text: rb.rule }]);
      if (seenPair.has(fp)) continue;
      seenPair.add(fp);
      if (conflictByFp.has(fp)) continue; // already known
      const id = nextId(DIRS.conflicts, 'conf');
      writeYAML(path.join(DIRS.conflicts, `${id}.yml`), {
        id,
        status: 'pending',
        fingerprint: fp,
        detected_at: new Date().toISOString(),
        evidence: 'screenshot', // non-visual pairs degrade to 'inconclusive' at render, never blank issues
        sides: [
          { key: 'A', source: ra.sources[0]?.source ?? ra.source, rule_id: ra.id, hash: ra.hash, severity: ra.severity, text: ra.rule, text_zh: null },
          { key: 'B', source: rb.sources[0]?.source ?? rb.source, rule_id: rb.id, hash: rb.hash, severity: rb.severity, text: rb.rule, text_zh: null },
        ],
        ai_explanation: (d.explanation ?? '').replace(/^(EN|ZH|中文)\s*[:：]\s*/i, ''),
        ai_explanation_zh: (d.explanation_zh ?? '').replace(/^(EN|ZH|中文)\s*[:：]\s*/i, '') || null,
        suggestion: d.kind ? {
          kind: d.kind,
          note: (d.note ?? '').replace(/^(EN|ZH|中文)\s*[:：]\s*/i, '') || null,
          note_zh: (d.note_zh ?? '').replace(/^(EN|ZH|中文)\s*[:：]\s*/i, '') || null,
        } : null,
        issue_url: null,
      });
      conflictByFp.set(fp, { fingerprint: fp });
      dilemmaCount++;
      log(`synthesize: dilemma -> ${id}`);
    }
    log(`synthesize: ${domain} -> ${out.rules.length} rules, ${dilemmas.length} dilemmas`);
  }

  // conflicts filed during THIS run also hold sides — refresh the set so verbatim passthrough
  // of a just-detected dilemma's side can't leak into merged output
  for (const c of loadConflicts()) {
    if (c.status === 'pending') for (const s of c.sides ?? []) held.add(s.hash);
  }
  const merged = (onlyDomain
    ? [...(prev?.rules ?? []).filter((r) => r.synthesizedFrom !== `domain:${onlyDomain}` && !r.decidedBy), ...synthRules, ...overlays]
    : [...synthRules, ...overlays]
  ).filter((r) => !held.has(r.hash)); // contested verbatim must not leak via passthrough/reuse
  const deduped = dedupeMerged(merged);
  if (deduped.length !== merged.length) log(`synthesize: folded ${merged.length - deduped.length} near-identical synthesized rules`);
  writeYAML(FILES.mergedRules, {
    generated: new Date().toISOString(),
    count: deduped.length,
    rules: deduped.sort((a, b) => a.scope[0].localeCompare(b.scope[0])),
  });
  writeJSON(STATE_FILE, { domains: newDigests, at: new Date().toISOString() });
  log(`synthesize: wrote ${deduped.length} merged rules; ${dilemmaCount} new dilemmas, ${held.size} held pending`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const di = process.argv.indexOf('--domain');
  await synthesize({
    applyOnly: process.argv.includes('--apply-only'),
    onlyDomain: di !== -1 ? process.argv[di + 1] : null,
  });
}
