// state.js — state/upstream.yml 读写 + cache 索引 + history 快照
import fs from 'node:fs';
import path from 'node:path';
import { readYAMLFile, writeYAMLFile, historyDir } from './hub.js';
import { rmDir, treeHash } from './package.js';

export const readUpstream = (hub) => readYAMLFile(path.join(hub, 'state', 'upstream.yml'), { skills: {} });
export const writeUpstream = (hub, d) => writeYAMLFile(path.join(hub, 'state', 'upstream.yml'), d);

export function setUpstream(hub, name, entry) {
  const u = readUpstream(hub);
  u.skills[name] = { ...u.skills[name], ...entry, checked_at: new Date().toISOString() };
  writeUpstream(hub, u);
}

// download 缓存命中：cache/<name>-*/ 存在即返回
export function cacheLookup(hub, name) {
  const dir = path.join(hub, 'cache');
  try {
    const hit = fs.readdirSync(dir).find((d) => d.startsWith(`${name}-`) || d === name);
    return hit ? path.join(dir, hit) : null;
  } catch { return null; }
}

// —— 多版本留档：.history/<name>/<key>/ 永不删除；<name>.index.yml 记每份 version/pin/hash/时间 ——
const indexPath = (hub, name) => `${historyDir(hub, name)}.index.yml`;
const readIndex = (hub, name) => readYAMLFile(indexPath(hub, name), { versions: {} });

// 旧格式迁移：.history/<name>/SKILL.md（单副本时代）→ _prev/ + 收编 <name>.meta.yml
function migrateLegacy(hub, name) {
  const d = historyDir(hub, name);
  if (!fs.existsSync(path.join(d, 'SKILL.md'))) return;
  const prev = path.join(d, '_prev');
  rmDir(prev);
  fs.mkdirSync(prev, { recursive: true });
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === '_prev') continue;
    fs.renameSync(path.join(d, e.name), path.join(prev, e.name));
  }
  const meta = readYAMLFile(`${d}.meta.yml`, null);
  const idx = readIndex(hub, name);
  idx.versions._prev = { version: meta?.version || null, source: meta?.source || null, saved_at: null, legacy: true };
  writeYAMLFile(indexPath(hub, name), idx);
  const mf = `${d}.meta.yml`;
  if (fs.existsSync(mf)) fs.rmSync(mf);
}

export function historySnapshot(hub, name, entry = null) {
  const src = path.join(hub, 'skills', name);
  if (!fs.existsSync(src)) return false;
  migrateLegacy(hub, name);
  const key = entry?.source?.pin ? String(entry.source.pin).slice(0, 10) : `h${treeHash(src).replace(/^sha256:/, '').slice(0, 10)}`;
  const dst = path.join(historyDir(hub, name), key);
  if (!fs.existsSync(dst)) {   // 同 key 已有档——内容是同一份，不重复存
    fs.mkdirSync(dst, { recursive: true });
    copyDirFs(src, dst);
  }
  const idx = readIndex(hub, name);
  idx.versions[key] = { version: entry?.version || null, source: entry?.source || null, hash: treeHash(src), saved_at: new Date().toISOString() };
  writeYAMLFile(indexPath(hub, name), idx);
  return key;
}

// [{key, version, source, hash, saved_at}] 新→旧；[] 表示无留档
export function historyList(hub, name) {
  migrateLegacy(hub, name);
  const d = historyDir(hub, name);
  if (!fs.existsSync(d)) return [];
  const idx = readIndex(hub, name);
  return fs.readdirSync(d, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ key: e.name, ...(idx.versions?.[e.name] || {}) }))
    .sort((a, b) => String(b.saved_at || '').localeCompare(String(a.saved_at || '')));
}

export function historyRestore(hub, name, key) {
  const dst = path.join(historyDir(hub, name), key);
  const src = path.join(hub, 'skills', name);
  if (!fs.existsSync(dst)) return false;
  rmDir(src);
  copyDirFs(dst, src);
  return true;
}

function copyDirFs(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDirFs(s, d); else if (e.isFile()) fs.copyFileSync(s, d);   // 与 copyDir 一致：symlink/fifo 不跟随
  }
}
