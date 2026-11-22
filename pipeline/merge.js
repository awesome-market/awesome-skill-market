#!/usr/bin/env node
// merge.js — dedupe extracted rules, LLM-judge candidate pairs, emit merged/rules.yml + conflicts/*
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, FILES } from './lib/env.js';
import { log, readYAML, writeYAML, listYAMLFiles, tokens, jaccard, sha1, nextId } from './lib/util.js';
import { chatJSON } from './lib/llm.js';

const SIM_THRESHOLD = 0.08;
const MAX_PAIRS_PER_RUN = 80;

export function loadExtracted() {
  const all = [];
  for (const f of listYAMLFiles(DIRS.extracted)) {
    const doc = readYAML(f);
    const name = path.basename(f, '.yml');
    for (const r of doc.rules ?? []) all.push({ ...r, source: name, repo: doc.source?.repo });
  }
  return all;
}

export function conflictFingerprint(sides) {
  return sha1(sides.map((s) => s.text).map((t) => t.toLowerCase().replace(/\s+/g, ' ').trim()).sort().join('\n---\n'));
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

const JUDGE_SYSTEM = `You adjudicate pairs of UI-design rules for a merge pipeline. Decide their relationship:

- "conflict": an agent cannot obey both at once in the same scope (direct contradiction, or one prohibits what the other requires/recommends as default).
- "overlap": same intent, different wording or coverage — can be merged into one rule without losing meaning.
- "distinct": compatible; neither conflict nor real overlap. Adjacent topics are distinct. A rule about color and a rule about focus-rings are distinct even if both mention contrast.

When genuinely unsure, prefer "conflict" — false conflicts are cheap (a human arbitrates), missed conflicts are not.

If "conflict", propose the most defensible resolution as "suggestion": one of {"kind":"keep-a"} | {"kind":"keep-b"} | {"kind":"scope-split","note":"when each applies"} | {"kind":"merge","note":"reconciled rule text"}.
If "overlap", provide "merged" — a single consolidated rule (severity, scope array, evidence, mechanizable).

Every human-facing string ships bilingual: provide "explanation_zh" (Chinese translation of explanation), "suggestion.note_zh", and "sides_zh" (Chinese translations of rules A and B). English remains canonical; Chinese is a faithful translation.`;

const JUDGE_SHAPE = `{"relationship":"conflict|overlap|distinct","explanation":"1-2 sentences","explanation_zh":"中文翻译","suggestion":{"kind":"keep-a|keep-b|scope-split|merge","note":"...","note_zh":"中文"},"sides_zh":{"A":"规则A的中文翻译","B":"规则B的中文翻译"},"merged":{"rule":"...","severity":"floor|reflex|finish|guidance","scope":["..."],"evidence":"screenshot|recording|audit|none","mechanizable":true}}`;

async function judgePair(a, b) {
  return chatJSON({
    label: `judge:${a.id}~${b.id}`,
    system: JUDGE_SYSTEM,
    user: `RULE A [${a.source} · ${a.severity} · ${a.scope.join(',')}]\n${a.rule}\n\nRULE B [${b.source} · ${b.severity} · ${b.scope.join(',')}]\n${b.rule}`,
    shapeDesc: JUDGE_SHAPE,
    thinking: true, // the one step that earns its reasoning budget
    maxTokens: 8192,
    validate: (o) => ['conflict', 'overlap', 'distinct'].includes(o?.relationship) || 'bad relationship',
  });
}

export async function merge() {
  const rules = loadExtracted();
  log(`merge: ${rules.length} extracted rules in`);

  // 1. exact-hash dedupe across upstreams
  const byHash = new Map();
  for (const r of rules) {
    if (byHash.has(r.hash)) {
      byHash.get(r.hash).sources.push({ source: r.source, id: r.id });
    } else {
      byHash.set(r.hash, { ...r, sources: [{ source: r.source, id: r.id }] });
    }
  }
  const canonical = [...byHash.values()];
  log(`merge: ${canonical.length} canonical after exact dedupe`);

  const conflicts = loadConflicts();
  const decisions = loadDecisions();
  const conflictByFp = new Map(conflicts.map((c) => [c.fingerprint, c]));
  const absorbed = new Set(); // rule hashes merged away / dropped by decision
  const held = new Set(); // rule hashes held out while a conflict is pending
  const overlays = []; // replacement rules authored by "merge"-type decisions

  // decisions & pending holds apply by rule hash so they survive re-extraction id churn
  for (const c of conflicts) {
    const dec = decisions.get(c.id);
    const sideHash = (key) => c.sides.find((s) => s.key === key)?.hash;
    if (dec?.status === 'active') {
      if (dec.resolution === 'merge' && dec.custom) {
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

  // 2. candidate pairs across different upstreams
  const tok = canonical.map((r) => tokens(r.rule));
  const pairs = [];
  for (let i = 0; i < canonical.length; i++) {
    for (let j = i + 1; j < canonical.length; j++) {
      if (absorbed.has(canonical[i].hash) || absorbed.has(canonical[j].hash)) continue;
      const sameSrc = canonical[i].sources.every((s) => canonical[j].sources.some((t) => t.source === s.source));
      if (sameSrc) continue;
      const sim = jaccard(tok[i], tok[j]);
      const sharedScope = canonical[i].scope?.some((s) => canonical[j].scope?.includes(s));
      if (sim >= SIM_THRESHOLD || sharedScope) pairs.push([i, j, sim + (sharedScope ? 0.05 : 0)]);
    }
  }
  pairs.sort((a, b) => b[2] - a[2]);
  const shortlisted = pairs.slice(0, MAX_PAIRS_PER_RUN);
  log(`merge: ${pairs.length} candidate pairs, judging top ${shortlisted.length}`);

  for (const [i, j] of shortlisted) {
    const a = canonical[i], b = canonical[j];
    if (absorbed.has(a.hash) || absorbed.has(b.hash)) continue;
    const fp = conflictFingerprint([{ text: a.rule }, { text: b.rule }]);

    if (conflictByFp.has(fp)) {
      const c = conflictByFp.get(fp);
      if (c.status === 'pending') { held.add(a.hash); held.add(b.hash); }
      // decided conflicts already handled above
      continue;
    }

    let verdict;
    try {
      verdict = await judgePair(a, b);
    } catch (e) {
      log(`judge ${a.id}~${b.id} failed: ${e.message}; holding both`);
      held.add(a.hash); held.add(b.hash);
      continue;
    }
    log(`judge ${a.id}~${b.id}: ${verdict.relationship}`);

    if (verdict.relationship === 'overlap' && verdict.merged?.rule) {
      const m = verdict.merged;
      absorbed.add(b.hash);
      a.rule = m.rule;
      a.severity = m.severity ?? a.severity;
      a.scope = m.scope ?? a.scope;
      a.evidence = m.evidence ?? a.evidence;
      a.mechanizable = m.mechanizable ?? a.mechanizable;
      a.sources.push(...b.sources);
      continue;
    }

    if (verdict.relationship === 'conflict') {
      const id = nextId(DIRS.conflicts, 'conf');
      const ev = [a.evidence, b.evidence].includes('recording') ? 'recording'
        : [a.evidence, b.evidence].includes('screenshot') ? 'screenshot'
        : [a.evidence, b.evidence].includes('audit') ? 'audit' : 'none';
      writeYAML(path.join(DIRS.conflicts, `${id}.yml`), {
        id,
        status: 'pending',
        fingerprint: fp,
        detected_at: new Date().toISOString(),
        evidence: ev,
        sides: [
          { key: 'A', source: a.source, rule_id: a.id, hash: a.hash, severity: a.severity, text: a.rule, text_zh: verdict.sides_zh?.A ?? null },
          { key: 'B', source: b.source, rule_id: b.id, hash: b.hash, severity: b.severity, text: b.rule, text_zh: verdict.sides_zh?.B ?? null },
        ],
        ai_explanation: verdict.explanation ?? '',
        ai_explanation_zh: verdict.explanation_zh ?? null,
        suggestion: verdict.suggestion ?? null,
        issue_url: null,
      });
      held.add(a.hash); held.add(b.hash);
      log(`merge: new conflict ${id}`);
    }
  }

  // 3. write merged set
  const out = [
    ...canonical.filter((r) => !absorbed.has(r.hash) && !held.has(r.hash)),
    ...overlays,
  ]
    .map(({ origin: _o, chunk: _c, repo: _r, localId: _l, ...r }) => r)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id));

  fs.mkdirSync(DIRS.merged, { recursive: true });
  writeYAML(FILES.mergedRules, {
    generated_at: new Date().toISOString(),
    counts: { extracted: rules.length, canonical: canonical.length, merged: out.length, pendingHeld: held.size },
    rules: out,
  });
  log(`merge: wrote ${out.length} merged rules; ${held.size} held pending, ${absorbed.size} absorbed`);
  return out.length;
}

const severityRank = (s) => ({ floor: 0, reflex: 1, finish: 2, guidance: 3 }[s] ?? 4);

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await merge();
}
