// rfc.js — Cloudflare Agent Skills Discovery RFC v0.2（只读）：.well-known/index.json + sha256 校验
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export async function fetchIndex(reg) {
  const url = `${reg.url.replace(/\/+$/, '')}/.well-known/agent-skills/index.json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`rfc index ${res.status}: ${url}`);
  const idx = await res.json();
  return idx.skills || idx.entries || (Array.isArray(idx) ? idx : []);
}

export async function search(query, ctx, reg) {
  const entries = await fetchIndex(reg);
  const q = query.toLowerCase();
  return entries.filter((e) => (e.name || '').toLowerCase().includes(q) || (e.description || '').toLowerCase().includes(q))
    .map((e) => ({ name: e.name, slug: e.name, source: reg.url, installs: 0, url: e.url }));
}

export async function fetchSkill(ref, ctx, reg) {
  const entries = await fetchIndex(reg);
  const entry = entries.find((e) => e.name === ref.name);
  if (!entry) throw new Error(`rfc index 无此 skill: ${ref.name}`);
  const res = await fetch(entry.url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`rfc fetch ${res.status}: ${entry.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (entry.digest) {
    const want = entry.digest.replace(/^sha256[:=]/, '');
    const got = crypto.createHash('sha256').update(buf).digest('hex');
    if (got !== want) throw new Error(`digest mismatch: ${ref.name}（${want.slice(0, 12)} ≠ ${got.slice(0, 12)}）`);
  }
  // 落 tmp：tar.gz 解压或当 zip；单文件 SKILL.md 也可
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmkt-rfc-'));
  const tar = path.join(tmp, 'pkg');
  fs.writeFileSync(tar, buf);
  try { execFileSync('tar', ['xzf', tar, '-C', tmp]); } catch { /* 非 tar */ }
  const dir = fs.readdirSync(tmp).find((d) => fs.statSync(path.join(tmp, d)).isDirectory());
  return { dir: dir ? path.join(tmp, dir) : tmp, tmp, provenance: { registry: 'rfc', ref: reg.url, pin: entry.digest || null } };
}
