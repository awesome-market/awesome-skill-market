// conflicts — 队列列表；pending>0 exit3；--json；TTY 下 pending 时接管 Web
import { loadConflicts } from '../lib/conflicts.js';
import { maybeHandoff } from '../lib/daemon.js';
import { table } from '../lib/render.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const all = loadConflicts(ctx.hub);
  if (!ctx.flags.json && all.some((c) => c.status === 'pending') && await maybeHandoff(ctx, '/#conflicts')) return 0;
  const pending = all.filter((c) => c.status === 'pending');
  if (ctx.flags.json) { console.log(JSON.stringify(all, null, 2)); return pending.length ? 3 : 0; }
  if (!all.length) { console.log(L('没有冲突记录——先跑 skillmkt merge <a> <b> 生成', 'no conflicts recorded — run: skillmkt merge <a> <b>')); return 0; }
  table(all.map((c) => ({ id: c.id, status: c.status, domain: c.domain || '-', A: `${c.sides[0].source}:${c.sides[0].hash}`, B: `${c.sides[1].source}:${c.sides[1].hash}` })),
    [{ key: 'id', title: 'id' }, { key: 'status', title: 'status' }, { key: 'domain', title: 'domain' }, { key: 'A', title: 'A' }, { key: 'B', title: 'B' }]);
  if (pending.length) console.log(L(`\n${pending.length} 个待裁决——跑 skillmkt resolve`, `\n${pending.length} pending — run skillmkt resolve`));
  return pending.length ? 3 : 0;
}
