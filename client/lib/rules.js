// rules.js — 任意 skill 静态抽规则候选（去固定域）：节标题 slug=动态域 + severity 词表
// 静态兜底版；LLM 精抽（自由 domain 标签）批次 6 替换 extractRules 内部
import fs from 'node:fs';
import path from 'node:path';
import { ruleHash } from '../../pipeline/lib/util.js';

const SEV = [
  [/never|must not|do not|禁止|绝不|不得|no exceptions|hard rule/i, 'floor'],
  [/prefer|recommend|should|建议|推荐|优先/i, 'standard'],
  [/can|may|consider|optional|可|酌情/i, 'reflex'],
];
const sevOf = (t) => SEV.find(([re]) => re.test(t))?.[1] || 'standard';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-').replace(/^-|-$/g, '').slice(0, 12) || 'misc';

// SKILL.md → [{id, source, domain, severity, text, hash}]：每节按 bullet/句子切，≤220 字符
export function extractRules(dir, sourceName) {
  const f = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(f)) return [];
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const rules = [];
  let domain = 'misc', i = 0;
  for (const line of lines) {
    const h = line.match(/^#{1,3}\s+(.+)/);
    if (h) { domain = slug(h[1]); continue; }
    if (/^#{4,}/.test(line) || /^(```|<!--|\s*$)/.test(line)) continue;
    const bullet = line.replace(/^\s*[-*•>\d.)\s]+/, '').trim();
    if (bullet.length < 12 || bullet.length > 500) continue;
    // 长段切句，每段最多取 3 条
    for (const sent of bullet.split(/(?<=[.。!！?？])\s+/).slice(0, 3)) {
      const text = sent.trim();
      if (text.length < 12 || text.length > 220) continue;
      rules.push({ id: `${sourceName.slice(0, 6)}-${String(++i).padStart(3, '0')}`, source: sourceName, domain, severity: sevOf(text), text, hash: ruleHash(text) });
    }
  }
  return rules;
}
