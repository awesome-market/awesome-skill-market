// decide.js — decisions/*.yml 写盘（reason 必填 / supersedes 自动 / fingerprint 关联）
// 与管线 pipeline/decide.js 不变量一致；decisions 是唯一手写（或经命令）的真理源
import fs from 'node:fs';
import path from 'node:path';
import { readYAML, writeYAML } from '../../pipeline/lib/util.js';

export const decisionsDir = (hub) => path.join(hub, 'decisions');

export function loadDecisions(hub) {
  const dir = decisionsDir(hub);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.yml')).sort()
    .map((f) => readYAML(path.join(dir, f))).filter(Boolean);
}

// activeMap: fingerprint → decision（latest active wins；overturn 链追 supersedes）
export function activeDecisions(hub) {
  const map = new Map();
  for (const d of loadDecisions(hub)) {
    if (d.status !== 'active') continue;
    map.set(d.fingerprint, d);
  }
  return map;
}

// decide(hub, conflict, {resolution, custom, reason, by}) → decision obj
// resolution: keep-a | keep-b | merge | dismissed；reason 必填（AGENTS 不变量）
export function decide(hub, conflict, { resolution, custom = null, reason, by = 'human' }) {
  if (!reason) throw new Error('decision requires reason');
  const dir = decisionsDir(hub);
  fs.mkdirSync(dir, { recursive: true });
  // 同 fingerprint 已有 active → 本次为推翻，记 supersedes
  const prior = activeDecisions(hub).get(conflict.fingerprint);
  const d = {
    id: conflict.id, fingerprint: conflict.fingerprint, status: 'active',
    resolution, custom, reason,
    alternatives_rejected: [], trigger: 'manual', decided_at: new Date().toISOString(),
    decided_by: by, supersedes: prior ? prior.decided_at : null,
  };
  // 单文件=fingerprint 最新决策；supersedes 记时间戳链（与管线同构）
  writeYAML(path.join(dir, `${conflict.id}.yml`), d);
  return d;
}
