// hub.js — hub 路径、骨架、library/lock/config 原子读写、history/trash
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';
import { safeName } from './package.js';

export function expandHome(p) {
  return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

export function hubPath(flagHub) {
  return path.resolve(expandHome(flagHub || process.env.SKILLMKT_HOME || '~/.skillmkt'));
}

const SUBDIRS = [
  'skills', 'scans', 'conflicts', 'decisions', 'merged',
  'state', 'cache', '.history', '.trash', 'quarantine',
];

export function hubExists(hub) {
  return fs.existsSync(path.join(hub, 'library.yml'));
}

// "真正初始化过"：config.yml 里有完成标记，或含实质配置（web 保存路径只有后者可判）
export function isInitialized(hub) {
  const raw = readConfig(hub)._raw;
  if (!raw) return false;
  return !!(raw.initialized || raw.llm?.base_url || raw.default_targets?.length);
}

export function ensureHub(hub) {
  for (const d of SUBDIRS) fs.mkdirSync(path.join(hub, d), { recursive: true, mode: 0o700 });   // hub 整树只本用户——skill 内容+状态都不该跨用户可见
  if (!fs.existsSync(F(hub, 'library.yml'))) writeYAMLFile(F(hub, 'library.yml'), { version: 1, skills: {} });   // 让 hubExists 对"只初始化没装过"的 hub 也成立
  return hub;
}

export function readYAMLFile(file, fallback = null) {
  try { return YAML.parse(fs.readFileSync(file, 'utf8')) ?? fallback; }
  catch { return fallback; }
}

export function writeYAMLFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, YAML.stringify(data), { mode: 0o600 });   // hub 状态（config 含 enc:v1 密文）——只本用户可读
  fs.renameSync(tmp, file);           // 同目录原子替换
}

export function readJSONFile(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

export function writeJSONFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

const F = (hub, ...p) => path.join(hub, ...p);

export const readLibrary = (hub) => readYAMLFile(F(hub, 'library.yml'), { version: 1, skills: {} });
export const writeLibrary = (hub, d) => writeYAMLFile(F(hub, 'library.yml'), d);
export const readLock = (hub) => readYAMLFile(F(hub, 'lock.yml'), { version: 1, skills: {} });
export const writeLock = (hub, d) => writeYAMLFile(F(hub, 'lock.yml'), d);

export function registerSkill(hub, name, entry) {
  if (!safeName(name)) throw new Error(`unsafe skill name: ${name}`);   // 写入边界兜底——坏名永远进不了 library
  const lib = readLibrary(hub);
  lib.skills[name] = entry;
  writeLibrary(hub, lib);
}

export function unregisterSkill(hub, name) {
  const lib = readLibrary(hub);
  delete lib.skills[name];
  writeLibrary(hub, lib);
  const lock = readLock(hub);
  delete lock.skills[name];
  writeLock(hub, lock);
}

export function updateLock(hub, name, contentHash, targets) {
  const lock = readLock(hub);
  lock.skills[name] = { content_hash: contentHash, targets };
  writeLock(hub, lock);
}

export function readConfig(hub) {
  const cfg = readYAMLFile(F(hub, 'config.yml'), {}) || {};
  return {
    llm: cfg.llm || null,
    ui: { enabled: cfg.ui?.enabled ?? 'auto', lang: cfg.ui?.lang },
    policy: cfg.policy ?? 'balanced',
    default_targets: cfg.default_targets ?? [],
    targets: cfg.targets ?? {},
    registries: cfg.registries ?? [{ type: 'github', default: true }],
    daemon: { idle_minutes: cfg.daemon?.idle_minutes ?? 30 },
    _raw: cfg,
  };
}

export function writeConfig(hub, raw) {
  writeYAMLFile(F(hub, 'config.yml'), raw);
}

export function setConfigKey(raw, dotted, value) {
  const keys = dotted.split('.');
  if (keys.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype')) return raw;   // 原型链段拒绝——防 Object.prototype 污染
  let cur = raw;
  for (const k of keys.slice(0, -1)) cur = cur[k] ??= {};
  cur[keys.at(-1)] = value;
  return raw;
}

export function getConfigKey(raw, dotted) {
  return dotted.split('.').reduce((o, k) => o?.[k], raw);
}

export function trashPath(hub, name) {
  return F(hub, '.trash', `${name}-${Date.now()}`);
}

export function historyDir(hub, name) {
  return F(hub, '.history', name);
}

export function cacheDir(hub, name, hash) {
  return F(hub, 'cache', `${name}-${(hash || 'nohash').slice(7, 15)}`);
}

export function quarantinePath(hub, name) {
  return F(hub, 'quarantine', `${name}-${Date.now()}`);
}
