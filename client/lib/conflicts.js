// conflicts.js — 候选对生成（同域 or jaccard≥0.15）+ 静态矛盾信号 + fingerprint 去重 + 队列 IO
// LLM 语义判定批次 6 插入 detectConflicts 的 filter 阶段；静态版用指令词/数值/否定不对称代理
import fs from 'node:fs';
import path from 'node:path';
import { tokens, jaccard, conflictFingerprint, nextId, readYAML, writeYAML } from '../../pipeline/lib/util.js';

export const conflictsDir = (hub) => path.join(hub, 'conflicts');

// 矛盾代理信号：相似主题 + (不同数值 | 不同引用词 | 否定不对称)
const NUMS = (t) => (t.match(/\d+(\.\d+)?\s*(px|em|rem|%|pt|ms|s|x)?/g) || []).join(',');
const QUOTED = (t) => (t.match(/["'`#][\w-]+["'`]?|#[0-9a-fA-F]{3,8}\b/g) || []).join(',');
const NEG = /never|must not|do not|no |禁止|绝不|不得|avoid|don't/i;
function contradicts(a, b) {
  if (a.domain === 'misc' && b.domain === 'misc') return false;      // 全域 misc 噪声大，要求更严信号
  const na = NUMS(a.text), nb = NUMS(b.text);
  if (na && nb && na !== nb) return true;
  const qa = QUOTED(a.text), qb = QUOTED(b.text);
  if (qa && qb && qa !== qb) return true;
  if (NEG.test(a.text) !== NEG.test(b.text)) return true;             // 一边禁止一边无禁→可疑
  return false;
}

// rules[]（跨 skill）→ 冲突候选（fingerprint 去重，已决不复活）
export function detectConflicts(hub, rules, { threshold = 0.15 } = {}) {
  const existing = loadConflicts(hub);
  const seenFp = new Set(existing.map((c) => c.fingerprint));
  const out = [];
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i], b = rules[j];
      if (a.source === b.source) continue;
      const sameDomain = a.domain === b.domain && a.domain !== 'misc';
      if (!sameDomain && jaccard(tokens(a.text), tokens(b.text)) < threshold) continue;
      if (!contradicts(a, b)) continue;
      const sides = [
        { key: 'A', source: a.source, rule_id: a.id, hash: a.hash, severity: a.severity, text: a.text },
        { key: 'B', source: b.source, rule_id: b.id, hash: b.hash, severity: b.severity, text: b.text },
      ];
      const fp = conflictFingerprint(sides);
      if (seenFp.has(fp)) continue;
      seenFp.add(fp);
      out.push({ status: 'pending', fingerprint: fp, detected_at: new Date().toISOString(), domain: a.domain === b.domain ? a.domain : `${a.domain}×${b.domain}`, sides, evidence: 'text' });
    }
  }
  // 写盘：续用现有 id 序列
  const dir = conflictsDir(hub);
  fs.mkdirSync(dir, { recursive: true });
  for (const c of out) {
    c.id = nextId(dir, 'conf');
    writeYAML(path.join(dir, `${c.id}.yml`), c);
  }
  return out;
}

export function loadConflicts(hub, { pendingOnly = false } = {}) {
  const dir = conflictsDir(hub);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.yml')).sort()
    .map((f) => readYAML(path.join(dir, f))).filter(Boolean)
    .filter((c) => !pendingOnly || c.status === 'pending');
}

export function writeConflict(hub, c) {
  writeYAML(path.join(conflictsDir(hub), `${c.id}.yml`), c);
}
