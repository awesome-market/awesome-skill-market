#!/usr/bin/env node
// validate.js — deterministic schema checks for CI. No LLM.
import path from 'node:path';
import { DIRS, FILES } from './lib/env.js';
import { readYAML, readJSON, listYAMLFiles } from './lib/util.js';

const SEV = new Set(['floor', 'reflex', 'finish', 'guidance']);
const EV = new Set(['screenshot', 'recording', 'audit', 'none']);
const SCOPE = new Set(['color', 'type', 'layout', 'motion', 'a11y', 'copy', 'imagery', 'code', 'process']);
const RES = new Set(['A', 'B', 'merge', 'custom']);

const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

// extracted/*
for (const f of listYAMLFiles(DIRS.extracted)) {
  const doc = readYAML(f) ?? {};
  const name = path.basename(f);
  if (!doc.source?.repo || !doc.source?.sha) err(name, 'missing source.repo/sha');
  const ids = new Set();
  for (const [i, r] of (doc.rules ?? []).entries()) {
    const at = `${name} rule[${i}]`;
    if (!r.id || ids.has(r.id)) err(at, 'missing/dup id');
    ids.add(r.id);
    if (!r.rule || typeof r.rule !== 'string') err(at, 'missing rule text');
    if (!SEV.has(r.severity)) err(at, `bad severity ${r.severity}`);
    if (!Array.isArray(r.scope) || r.scope.some((s) => !SCOPE.has(s))) err(at, `bad scope ${JSON.stringify(r.scope)}`);
    if (!EV.has(r.evidence)) err(at, `bad evidence ${r.evidence}`);
    if (typeof r.hash !== 'string' || !r.hash) err(at, 'missing hash');
  }
}

// conflicts/*
const confIds = new Map();
for (const f of listYAMLFiles(DIRS.conflicts)) {
  const c = readYAML(f) ?? {};
  const name = path.basename(f);
  if (!/^conf-\d{4}$/.test(c.id)) err(name, `bad id ${c.id}`);
  if (confIds.has(c.id)) err(name, `dup conflict id ${c.id}`);
  confIds.set(c.id, c);
  if (!['pending', 'decided'].includes(c.status)) err(name, `bad status ${c.status}`);
  if (!c.fingerprint) err(name, 'missing fingerprint');
  if (!Array.isArray(c.sides) || c.sides.length !== 2) err(name, 'sides must be 2');
  for (const s of c.sides ?? []) {
    if (!s.key || !s.text || !s.source) err(name, `bad side ${JSON.stringify(s).slice(0, 80)}`);
  }
}

// decisions/* — must reference an existing conflict; overturns need reason (enforced at decide.js too)
for (const f of listYAMLFiles(DIRS.decisions)) {
  const d = readYAML(f) ?? {};
  const name = path.basename(f);
  if (!d.id || !confIds.has(d.id)) err(name, `decision for unknown conflict ${d.id}`);
  if (!['active', 'superseded', 'stale'].includes(d.status)) err(name, `bad status ${d.status}`);
  if (d.status === 'active') {
    if (!RES.has(d.resolution)) err(name, `bad resolution ${d.resolution}`);
    if (!d.reason) err(name, 'active decision missing reason');
    if (['merge', 'custom'].includes(d.resolution) && !d.custom) err(name, 'merge/custom needs custom text');
  }
  if (d.supersedes && !d.reason) err(name, 'overturn must carry reason');
}

// merged/rules.yml sanity
const merged = readYAML(FILES.mergedRules);
if (merged?.rules) {
  const pending = new Set([...confIds.values()].filter((c) => c.status === 'pending').flatMap((c) => c.sides.map((s) => s.hash)));
  for (const r of merged.rules) {
    if (r.hash && pending.has(r.hash)) err('merged/rules.yml', `pending rule leaked: ${r.id}`);
  }
}

// upstream.lock sanity
const lock = readJSON(FILES.lock, { upstreams: [] });
for (const u of lock.upstreams) {
  if (!u.name || !u.repo || !u.sha) err('upstream.lock.json', `bad entry ${JSON.stringify(u)}`);
}

if (errors.length) {
  console.error(`validate: ${errors.length} error(s)\n` + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
console.log('validate: ok');
