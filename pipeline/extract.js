#!/usr/bin/env node
// extract.js — LLM pass: normalize each upstream's markdown rules into extracted/<name>.yml
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, FILES } from './lib/env.js';
import { log, readJSON, writeYAML, walk, sha1, ruleHash } from './lib/util.js';
import { chatJSON } from './lib/llm.js';

const CHUNK = 24000; // chars per extraction call

const SYSTEM = `You normalize design-skill documentation into a flat rule list for an automated merge pipeline.

From the provided markdown extract every ACTIONABLE rule an agent should follow when building or reviewing UI. Include prohibitions, requirements, and default choices. Exclude: philosophy/motivation prose, install/usage instructions, tool-specific mechanics, and duplicates.

For each rule:
- "id": short slug, unique within this file (e.g. "no-eyebrow")
- "rule": ONE self-contained sentence, imperative voice, rewritten in your own words (never copy source sentences verbatim)
- "severity": "floor" (never ship if violated) | "reflex" (default; needs explicit reason to override) | "finish" (craft detail, non-blocking) | "guidance" (direction, not checkable)
- "scope": array of tags from [color, type, layout, motion, a11y, copy, imagery, code, process]
- "evidence": best proof type if this rule were disputed: "screenshot" | "recording" | "audit" | "none"
- "mechanizable": true if a deterministic linter could check it in HTML/CSS/JS source

Consolidate near-identical rules. Skip nothing load-bearing.`;

const SHAPE = `{"rules":[{"id":"slug","rule":"sentence","severity":"floor|reflex|finish|guidance","scope":["tag"],"evidence":"screenshot|recording|audit|none","mechanizable":true}]}`;

function validate(obj, file) {
  if (!Array.isArray(obj?.rules)) return 'missing rules[]';
  const seen = new Set();
  for (const r of obj.rules) {
    if (!r.id || !r.rule || !r.severity || !Array.isArray(r.scope)) return `bad rule entry: ${JSON.stringify(r).slice(0, 120)}`;
    if (seen.has(r.id)) return `dup id ${r.id}`;
    seen.add(r.id);
  }
  return true;
}

function sourceFiles(name) {
  const lock = readJSON(FILES.lock);
  const up = lock.upstreams.find((u) => u.name === name);
  if (!up) throw new Error(`upstream ${name} not in lock (run sync first)`);
  const root = path.join(DIRS.upstream, name);
  const files = [];
  for (const inc of up.includePaths) {
    const abs = path.join(root, inc);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      files.push(...walk(abs, (p) => /\.(md|mdx|txt)$/i.test(p) && !/(LICENSE|NOTICE|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT|AUTHORS)/i.test(path.basename(p))));
    } else if (fs.existsSync(abs)) {
      files.push(abs);
    }
  }
  return { up, root, files: [...new Set(files)] };
}

export async function extractOne(name, { force = false } = {}) {
  const { up, root, files } = sourceFiles(name);
  const outFile = path.join(DIRS.extracted, `${name}.yml`);
  const prev = fs.existsSync(outFile) ? (await import('./lib/util.js')).readYAML(outFile) : null;
  if (!force && prev?.source?.sha === up.sha) {
    log(`extract: ${name} already at ${up.sha.slice(0, 8)}, skip`);
    return false;
  }

  const rules = [];
  for (const f of files) {
    const rel = path.relative(root, f);
    const text = fs.readFileSync(f, 'utf8');
    const chunks = [];
    for (let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));
    for (let i = 0; i < chunks.length; i++) {
      const label = `extract:${name}:${rel}${chunks.length > 1 ? `#${i + 1}` : ''}`;
      log(`${label} (${chunks[i].length} chars)`);
      const { rules: got } = await chatJSON({
        label,
        system: SYSTEM,
        user: `File: ${up.repo}/${rel}\n\n${chunks[i]}`,
        shapeDesc: SHAPE,
        validate: (o) => validate(o, rel),
      });
      for (const r of got) rules.push({ ...r, origin: rel, chunk: chunks.length > 1 ? i + 1 : undefined });
    }
  }

  // dedupe within upstream by normalized text; keep first
  const seen = new Map();
  for (const r of rules) {
    r.hash = ruleHash(r.rule);
    if (!seen.has(r.hash)) seen.set(r.hash, r);
  }
  const final = [...seen.values()].map((r, i) => ({ ...r, localId: r.id, id: `${name.slice(0, 6)}-${String(i + 1).padStart(3, '0')}` }));

  writeYAML(outFile, {
    source: { repo: up.repo, sha: up.sha, includePaths: up.includePaths },
    model: process.env.OMLX_MODEL,
    extractedAt: new Date().toISOString(),
    rules: final,
  });
  log(`extract: ${name} -> ${final.length} rules (${rules.length - final.length} dups removed)`);
  return true;
}

export async function extract(names = null, opts = {}) {
  const lock = readJSON(FILES.lock);
  const targets = names ?? lock.upstreams.map((u) => u.name);
  const done = [];
  for (const n of targets) {
    if (await extractOne(n, opts)) done.push(n);
  }
  return done;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const names = args.filter((a) => !a.startsWith('--'));
  await extract(names.length ? names : null, { force });
}
