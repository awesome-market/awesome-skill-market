// decide <id> --resolution keep-a|keep-b|merge|dismissed --reason "…" [--custom text]
import { loadConflicts, writeConflict } from '../lib/conflicts.js';
import { decide } from '../lib/decide.js';
import { ok, fail } from '../lib/render.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const [id] = ctx.args;
  const { resolution, reason, custom } = ctx.flags.raw;
  if (!id || !resolution || !reason) { fail(L('用法: skillmkt decide <冲突id> --resolution keep-a|keep-b|merge|dismissed --reason "…" [--custom text]', 'usage: skillmkt decide <conf-id> --resolution keep-a|keep-b|merge|dismissed --reason "…" [--custom text]')); return 1; }
  const c = loadConflicts(ctx.hub).find((x) => x.id === id);
  if (!c) { fail(L(`没找到: ${id}`, `not found: ${id}`)); return 1; }
  if (!['keep-a', 'keep-b', 'merge', 'dismissed'].includes(resolution)) { fail(L(`resolution 只能是 keep-a/keep-b/merge/dismissed: ${resolution}`, `bad resolution: ${resolution}`)); return 1; }
  if (resolution === 'merge' && !custom) { fail(L('resolution=merge 需要 --custom 提供合并文本', 'resolution=merge needs --custom with the merged text')); return 1; }
  decide(ctx.hub, c, { resolution, custom, reason, by: process.env.USER || 'cli' });
  c.status = 'resolved';
  writeConflict(ctx.hub, c);
  ok(`${id} → ${L({ 'keep-a': '选了A', 'keep-b': '选了B', merge: '合并', dismissed: '不算冲突' }[resolution] ?? resolution, resolution)}`);
  return 0;
}
