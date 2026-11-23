// merge <a> <b> [more…] [--name n] — 抽规则→去重→检冲突→merged/rules.yml 中间态
import fs from 'node:fs';
import path from 'node:path';
import { extractRules } from '../lib/rules.js';
import { detectConflicts } from '../lib/conflicts.js';
import { tokens, jaccard, writeYAML } from '../../pipeline/lib/util.js';
import { ok, warn, fail, info } from '../lib/render.js';

export const mergedDir = (hub) => path.join(hub, 'merged');

export async function run(ctx) {
  const names = ctx.args.filter((a) => !a.startsWith('--'));
  if (names.length < 2) { fail('usage: skillmkt merge <a> <b> [more…] [--name n]'); return 1; }
  const outName = ctx.flags.raw.name || `merged-${names.length}skills`;

  const rules = [];
  for (const name of names) {
    const dir = path.join(ctx.hub, 'skills', name);
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) { fail(`未受管: ${name}`); return 1; }
    rules.push(...extractRules(dir, name));
  }
  // 去重（jaccard≥0.9 保留 first-seen）
  const dedup = [];
  for (const r of rules) {
    const t = tokens(r.text);
    if (dedup.some((d) => jaccard(tokens(d.text), t) >= 0.9)) continue;
    dedup.push(r);
  }
  const news = detectConflicts(ctx.hub, dedup);
  const dir = mergedDir(ctx.hub);
  fs.mkdirSync(dir, { recursive: true });
  writeYAML(path.join(dir, 'rules.yml'), { name: outName, sources: names, merged_at: new Date().toISOString(), rules: dedup });
  ok(`merged: ${dedup.length} rules（原始 ${rules.length}，去重 -${rules.length - dedup.length}）· 新冲突 ${news.length}`);
  if (news.length) info(`skillmkt conflicts 查看队列；decide/resolve 裁决后 build`);
  return news.length ? 3 : 0;
}
