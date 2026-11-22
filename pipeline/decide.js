#!/usr/bin/env node
// decide.js — record a human arbitration: npm run decide -- conf-0001 --resolution A --reason "..."
//            overturn: same command, adds supersedes note + requires --reason.
import path from 'node:path';
import { DIRS } from './lib/env.js';
import { log, readYAML, writeYAML } from './lib/util.js';

const args = process.argv.slice(2).filter((a) => a !== '--');
const get = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};

const id = args[0];
const resolution = get('--resolution');
const reason = get('--reason');
const custom = get('--custom');

if (!id || !/^conf-\d+$/.test(id) || !['A', 'B', 'merge', 'custom'].includes(resolution)) {
  console.error('usage: npm run decide -- conf-0001 --resolution A|B|merge|custom [--custom "rule text"] --reason "..."');
  process.exit(1);
}
if (!reason) {
  console.error('--reason is required (prevents drive-by flips; write the evidence)');
  process.exit(1);
}
if ((resolution === 'merge' || resolution === 'custom') && !custom) {
  console.error('--custom "merged rule text" is required for merge/custom resolutions');
  process.exit(1);
}

const confFile = path.join(DIRS.conflicts, `${id}.yml`);
const conf = readYAML(confFile);
if (!conf) { console.error(`no conflict file ${confFile}`); process.exit(1); }

const decFile = path.join(DIRS.decisions, `${id}.yml`);
const prev = readYAML(decFile);

writeYAML(decFile, {
  id,
  status: 'active',
  resolution,
  custom: custom ?? null,
  reason,
  alternatives_rejected: prev?.alternatives_rejected ?? [],
  trigger: 'manual',
  decided_at: new Date().toISOString(),
  decided_by: process.env.GITHUB_REPO?.split('/')[0] ?? 'local',
  supersedes: prev ? { resolution: prev.resolution, reason: prev.reason, at: prev.decided_at } : null,
});

// flip conflict status so merge() applies the decision
conf.status = 'decided';
writeYAML(confFile, conf);
log(`decide: ${id} -> ${resolution}${prev ? ' (overturned previous)' : ''}`);
log('run `npm run build` or let the daemon rebuild.');
