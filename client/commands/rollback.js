// rollback — 快捷别名：切到最近一份留档（等价 switch --to <最新>；多版本浏览用 switch）
import { historyList } from '../lib/state.js';
import { applySwitch } from './switch.js';
import { ok, fail } from '../lib/render.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const name = ctx.args[0];
  if (!name || ctx.args.length > 1) { fail(L('用法: skillmkt rollback <名字>（多版本选择用 skillmkt switch）', 'usage: skillmkt rollback <name> (pick from all versions: skillmkt switch)')); return 1; }
  const s = ctx.library.skills?.[name];
  if (!s) { fail(L(`没纳入管理: ${name}`, `not managed: ${name}`)); return 1; }
  const vers = historyList(ctx.hub, name);
  if (!vers.length) { fail(L(`${name}: 无留档版本`, `${name}: no archived versions`)); return 1; }
  const pick = vers[0];
  if (!applySwitch(ctx, name, pick)) return 1;
  ok(`${ctx.flags.dryRun ? '[dry-run] ' : ''}${L(`已回滚 ${name} → ${pick.version || pick.key}`, `rolled back ${name} → ${pick.version || pick.key}`)}`);
  return 0;
}
