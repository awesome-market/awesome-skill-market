// state.js — state/upstream.yml 读写 + cache 索引 + history 快照
import fs from 'node:fs';
import path from 'node:path';
import { readYAMLFile, writeYAMLFile, historyDir } from './hub.js';
import { rmDir } from './package.js';

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

export function historySnapshot(hub, name, entry = null) {
  const src = path.join(hub, 'skills', name);
  const dst = historyDir(hub, name);
  if (!fs.existsSync(src)) return false;
  rmDir(dst);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  copyDirFs(src, dst);
  // 元数据同存——rollback 恢复文件时连 version/pin 一起还原，不留脏状态
  if (entry) writeYAMLFile(`${dst}.meta.yml`, { version: entry.version || null, source: entry.source || null });
  return true;
}

// 快照旁的元数据（version/pin）；无则 null（旧快照只有文件）
export const historyMeta = (hub, name) => readYAMLFile(`${historyDir(hub, name)}.meta.yml`, null);

export function historyRestore(hub, name) {
  const dst = historyDir(hub, name);
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
    if (e.isDirectory()) copyDirFs(s, d); else fs.copyFileSync(s, d);
  }
}
