// merge <a> <b> [more…] [--name n] — 抽规则→去重→检冲突→merged/rules.yml 中间态
import fs from 'node:fs';
import path from 'node:path';
import { extractRules } from '../lib/rules.js';
import { extractRulesLLM } from '../lib/ai.js';
import { detectConflicts } from '../lib/conflicts.js';
import { autoArbitrate } from '../lib/autoarb.js';
import { tokens, jaccard, writeYAML } from '../../pipeline/lib/util.js';
import { ok, warn, fail, info } from '../lib/render.js';
import { L } from '../lib/i18n.js';

export const mergedDir = (hub) => path.join(hub, 'merged');

export async function run(ctx) {
  const names = ctx.args.filter((a) => !a.startsWith('--'));
  if (names.length < 2) { fail(L('用法: skillmkt merge <a> <b> [更多…] [--name 名字]', 'usage: skillmkt merge <a> <b> [more…] [--name n]')); return 1; }
  const outName = ctx.flags.raw.name || `merged-${names.length}skills`;

  const useLlm = ctx.flags.raw.llm && ctx.llm;
  const rules = [];
  for (const name of names) {
    const dir = path.join(ctx.hub, 'skills', name);
    const f = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(f)) { fail(L(`没纳入管理: ${name}`, `not managed: ${name}`)); return 1; }
    let rs = null;
    if (useLlm) {
      try { rs = await extractRulesLLM(ctx.llm, fs.readFileSync(f, 'utf8'), name); } catch { /* 降级静态 */ }
    }
    rules.push(...(rs || extractRules(dir, name)));
  }
  // 去重（jaccard≥0.9 保留 first-seen）
  const dedup = [];
  for (const r of rules) {
    const t = tokens(r.text);
    if (dedup.some((d) => jaccard(tokens(d.text), t) >= 0.9)) continue;
    dedup.push(r);
  }
  const news = detectConflicts(ctx.hub, dedup);
  // --auto：仲裁直接吃确定项（fresh-context per conflict）
  if (ctx.flags.raw.auto && ctx.llm && news.length) {
    const r = await autoArbitrate(ctx.hub, ctx.llm, news, { onProgress: (c, x) => info(`${c.id}: ${x?.verdict ?? '?'}${L('（置信', ' (confidence ')}${x?.confidence ?? '?'})`) });
    info(`auto-arbiter: ${r.auto} ${L('已自动裁决', 'auto-decided')}，${r.human} ${L('留给你', 'left for you')}`);
  }
  const dir = mergedDir(ctx.hub);
  fs.mkdirSync(dir, { recursive: true });
  writeYAML(path.join(dir, 'rules.yml'), { name: outName, sources: names, merged_at: new Date().toISOString(), rules: dedup });
  ok(L(`合并完成：${dedup.length} 条规则（原始 ${rules.length} 条，去重 -${rules.length - dedup.length}）· 新冲突 ${news.length} 个`,
    `merged: ${dedup.length} rules (${rules.length} raw, deduped -${rules.length - dedup.length}) · new conflicts ${news.length}`));
  if (news.length) info(L(`skillmkt conflicts 看队列；decide/resolve 裁决后跑 build`, `skillmkt conflicts to review; decide/resolve then build`));
  return news.length ? 3 : 0;
}
