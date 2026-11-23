// pack <name> — hub/local skill → <name>-<ver>.tar.gz（npm pack 语义）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { ok, fail, info } from '../lib/render.js';

export async function run(ctx) {
  const name = ctx.args[0];
  if (!name) { fail('usage: skillmkt pack <name>'); return 1; }
  const src = path.join(ctx.hub, 'skills', name);
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) { fail(`未受管: ${name}`); return 1; }
  const ver = ctx.library.skills?.[name]?.version || '0.0.0';
  const out = path.resolve(`${name}-${ver}.tar.gz`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmkt-pack-'));
  fs.mkdirSync(path.join(tmp, name), { recursive: true });
  execFileSync('cp', ['-R', src + '/', path.join(tmp, name)]);
  execFileSync('tar', ['czf', out, '-C', tmp, name]);
  fs.rmSync(tmp, { recursive: true, force: true });
  ok(`packed ${out} (${(fs.statSync(out).size / 1024).toFixed(1)} KB)`);
  return 0;
}
