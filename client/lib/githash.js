// githash.js — git blob-sha1 风格 tree-hash：本地与远端 git/trees API 可等值对比
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { walk } from './package.js';

const blobSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

// 本地目录 → git tree 等值 hash（sha1(sorted "path\0blobsha\n")）
export function gitTreeHash(dir) {
  const entries = [];
  for (const p of walk(dir)) {
    const rel = path.relative(dir, p).split(path.sep).join('/');
    entries.push(`${rel}\0${blobSha(fs.readFileSync(p))}`);
  }
  entries.sort();
  return 'sha1:' + crypto.createHash('sha1').update(entries.join('\n')).digest('hex');
}

// 远端 git/trees 响应 → 同算法 hash（过滤 subtree）
// sub 定位与 fetchSkill 同策略：skills.sh slug 常省略 skills/ 前缀，多级候选回退
export function remoteTreeHash(tree, sub = null) {
  if (!sub) {
    const entries = (tree || []).filter((e) => e.type === 'blob').map((e) => `${e.path}\0${e.sha}`).sort();
    return 'sha1:' + crypto.createHash('sha1').update(entries.join('\n')).digest('hex');
  }
  const tops = new Set((tree || []).map((e) => e.path.split('/')[0]));
  const cands = [sub, `skills/${sub}`, ...[...tops].map((d) => `${d}/${sub}`)];
  let hit = cands.find((c) => tree.some((e) => e.path === `${c}/SKILL.md`));
  if (!hit) {
    // 插件仓布局更深（.claude/skills/<name>）——远端 tree 是全量路径，直接找父目录名===sub 的 SKILL.md
    const matches = (tree || [])
      .filter((e) => e.type === 'blob' && e.path.endsWith('/SKILL.md'))
      .map((e) => e.path.slice(0, -'/SKILL.md'.length))
      .filter((d) => d.split('/').pop() === sub);
    matches.sort((a, b) => a.split('/').length - b.split('/').length);
    hit = matches[0];
  }
  if (!hit) return 'sha1:' + crypto.createHash('sha1').digest('hex'); // 未命中→空树 hash（必然≠本地，outdated 会标 changed）
  const entries = (tree || [])
    .filter((e) => e.type === 'blob' && (e.path === hit || e.path.startsWith(`${hit}/`)))
    .map((e) => `${e.path.slice(hit.length + 1)}\0${e.sha}`)
    .sort();
  return 'sha1:' + crypto.createHash('sha1').update(entries.join('\n')).digest('hex');
}
