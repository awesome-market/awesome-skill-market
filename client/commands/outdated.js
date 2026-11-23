// outdated — 离线对比 state/upstream.yml vs 本地，只读报告；有更新 exit4
import path from 'node:path';
import fs from 'node:fs';
import { readUpstream } from '../lib/state.js';
import { gitTreeHash } from '../lib/githash.js';
import { table, info, warn } from '../lib/render.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const up = readUpstream(ctx.hub);
  const rows = [];
  let outdated = 0;
  const all = ctx.library.skills || {};
  const entries = ctx.args.length ? ctx.args.map((n) => [n, all[n]]).filter(([n, s]) => s ? true : warn(L(`没纳入管理: ${n}`, `not managed: ${n}`))) : Object.entries(all);
  for (const [name, s] of entries) {
    const u = up.skills?.[name];
    const localDir = path.join(ctx.hub, 'skills', name);
    if (!u) {
      rows.push({ name, status: s.source?.registry === 'adopted' || s.source?.registry === 'local' ? L('本地收的，无上游', 'n/a (no upstream)') : L('没查过——先跑 skillmkt update', 'never checked — run update') });
      continue;
    }
    const localTree = fs.existsSync(localDir) ? gitTreeHash(localDir) : null;
    if (localTree && u.tree_hash && localTree !== u.tree_hash) {
      outdated++;
      rows.push({ name, status: L(`上游有更新 (${u.ref?.slice(0, 6)})——跑 upgrade 应用`, `upstream changed (${u.ref?.slice(0, 6)}) — run upgrade to apply`) });
    } else {
      rows.push({ name, status: L('已是最新', 'up to date') });
    }
  }
  if (ctx.flags.json) { console.log(JSON.stringify({ outdated, rows })); }
  else {
    if (rows.length) table(rows, [{ key: 'name', title: 'skill' }, { key: 'status', title: L('状态', 'status') }]);
    if (!Object.keys(up.skills || {}).length) warn(L('还没拉过远端信息——先跑 skillmkt update', 'no upstream data yet — run skillmkt update first'));
    else info(L(`上次刷新: ${up.refreshed_at ?? '未知'}（skillmkt update 再拉一次）`, `last refresh: ${up.refreshed_at ?? 'unknown'} (skillmkt update to refresh)`));
  }
  return outdated ? 4 : 0;
}
