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
  if (names.length < 2) { fail('usage: skillmkt merge <a> <b> [more…] [--name n]'); return 1; }
  const outName = ctx.flags.raw.name || `merged-${names.length}skills`;

  const useLlm = ctx.flags.raw.llm && ctx.llm;
  const rules = [];
  for (const name of names) {
    const dir = path.join(ctx.hub, 'skills', name);
    const f = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(f)) { fail(L(`未受管: ${name}`, `not managed: ${name}`)); return 1; }
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
    const r = await autoArbitrate(ctx.hub, ctx.llm, news, { onProgress: (c, x) => info(`${c.id}: ${x?.verdict ?? '?'}@${x?.confidence ?? '?'}`) });
    info(`auto-arbiter: ${r.auto} ${L('已决', 'decided')}，${r.human} ${L('留人', 'left for you')}`);
  }
  const dir = mergedDir(ctx.hub);
  fs.mkdirSync(dir, { recursive: true });
  writeYAML(path.join(dir, 'rules.yml'), { name: outName, sources: names, merged_at: new Date().toISOString(), rules: dedup });
  ok(L(`merged: ${dedup.length} rules（原始 ${rules.length}，去重 -${rules.length - dedup.length}）· 新冲突 ${news.length}`,
    `merged: ${dedup.length} rules (${rules.length} raw, deduped -${rules.length - dedup.length}) · new conflicts ${news.length}`));
  if (news.length) info(L(`skillmkt conflicts 查看队列；decide/resolve 裁决后 build`, `skillmkt conflicts to review; decide/resolve then build`));
  return news.length ? 3 : 0;
}
