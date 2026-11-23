// rollback — .history/<name>/ 换回 hub 副本 → 重投影 → 改 lock（一版深度）
import fs from 'node:fs';
import path from 'node:path';
import { historyRestore } from '../lib/state.js';
import { historyDir } from '../lib/hub.js';
import { projectSkill, targetDirFor } from '../lib/project.js';
import { updateLock } from '../lib/hub.js';
import { treeHash } from '../lib/package.js';
import { ok, fail } from '../lib/render.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const name = ctx.args[0];
  const s = ctx.library.skills?.[name];
  if (!s) { fail(L(`未受管: ${name}`, `not managed: ${name}`)); return 1; }
  if (!fs.existsSync(historyDir(ctx.hub, name))) { fail(L(`${name}: 无历史副本（upgrade 后才有一版深度）`, `${name}: no history copy (one version deep, only after upgrade)`)); return 1; }
  if (!ctx.flags.dryRun) {
    historyRestore(ctx.hub, name);
    const dest = path.join(ctx.hub, 'skills', name);
    const lockTargets = {};
    for (const t of s.targets || []) {
      const dir = targetDirFor(ctx, t, name);
      if (!dir) continue;
      const r = projectSkill(dest, name, dir, { mode: 'copy', force: true });
      lockTargets[t] = { hash: r.hash, projected_at: new Date().toISOString(), mode: 'copy' };
    }
    updateLock(ctx.hub, name, treeHash(dest), lockTargets);
  }
  ok(`${ctx.flags.dryRun ? '[dry-run] ' : ''}rolled back ${name}`);
  return 0;
}
