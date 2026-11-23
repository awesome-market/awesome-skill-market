// decide <id> --resolution keep-a|keep-b|merge|dismissed --reason "…" [--custom text]
import { loadConflicts, writeConflict } from '../lib/conflicts.js';
import { decide } from '../lib/decide.js';
import { ok, fail } from '../lib/render.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const [id] = ctx.args;
  const { resolution, reason, custom } = ctx.flags.raw;
  if (!id || !resolution || !reason) { fail('usage: skillmkt decide <conf-id> --resolution keep-a|keep-b|merge|dismissed --reason "…" [--custom text]'); return 1; }
  const c = loadConflicts(ctx.hub).find((x) => x.id === id);
  if (!c) { fail(`not found: ${id}`); return 1; }
  if (!['keep-a', 'keep-b', 'merge', 'dismissed'].includes(resolution)) { fail(`bad resolution: ${resolution}`); return 1; }
  if (resolution === 'merge' && !custom) { fail(L('resolution=merge 需要 --custom 提供合并文本', 'resolution=merge needs --custom with the merged text')); return 1; }
  decide(ctx.hub, c, { resolution, custom, reason, by: process.env.USER || 'cli' });
  c.status = 'resolved';
  writeConflict(ctx.hub, c);
  ok(`${id} → ${resolution}`);
  return 0;
}
