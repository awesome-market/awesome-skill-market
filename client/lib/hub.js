// hub.js — hub 路径、骨架、library/lock/config 原子读写、history/trash
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import YAML from 'yaml';

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

export function ensureHub(hub) {
  for (const d of SUBDIRS) fs.mkdirSync(path.join(hub, d), { recursive: true });
  return hub;
}

export function readYAMLFile(file, fallback = null) {
  try { return YAML.parse(fs.readFileSync(file, 'utf8')) ?? fallback; }
  catch { return fallback; }
}

export function writeYAMLFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, YAML.stringify(data));
  fs.renameSync(tmp, file);           // 同目录原子替换
}

export function readJSONFile(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

export function writeJSONFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const F = (hub, ...p) => path.join(hub, ...p);

export const readLibrary = (hub) => readYAMLFile(F(hub, 'library.yml'), { version: 1, skills: {} });
export const writeLibrary = (hub, d) => writeYAMLFile(F(hub, 'library.yml'), d);
export const readLock = (hub) => readYAMLFile(F(hub, 'lock.yml'), { version: 1, skills: {} });
export const writeLock = (hub, d) => writeYAMLFile(F(hub, 'lock.yml'), d);

export function registerSkill(hub, name, entry) {
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
    ui: { enabled: cfg.ui?.enabled ?? 'auto' },
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
