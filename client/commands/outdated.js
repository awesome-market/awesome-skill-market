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
  for (const [name, s] of Object.entries(ctx.library.skills || {})) {
    const u = up.skills?.[name];
    const localDir = path.join(ctx.hub, 'skills', name);
    if (!u) {
      rows.push({ name, status: s.source?.registry === 'adopted' || s.source?.registry === 'local' ? L('n/a (无上游)', 'n/a (no upstream)') : 'never checked — run update' });
      continue;
    }
    const localTree = fs.existsSync(localDir) ? gitTreeHash(localDir) : null;
    if (localTree && u.tree_hash && localTree !== u.tree_hash) {
      outdated++;
      rows.push({ name, status: `upstream changed (${u.ref?.slice(0, 6)})${L(' — upgrade 应用', ' — run upgrade to apply')}` });
    } else {
      rows.push({ name, status: 'clean' });
    }
  }
  if (ctx.flags.json) { console.log(JSON.stringify({ outdated, rows })); }
  else {
    if (rows.length) table(rows, [{ key: 'name', title: 'skill' }, { key: 'status', title: 'status' }]);
    if (!Object.keys(up.skills || {}).length) warn(L('state/upstream.yml 为空——先跑 skillmkt update', 'state/upstream.yml is empty — run skillmkt update first'));
    else info(`last refresh: ${up.refreshed_at ?? 'unknown'}${L('（skillmkt update 刷新）', ' (skillmkt update to refresh)')}`);
  }
  return outdated ? 4 : 0;
}
