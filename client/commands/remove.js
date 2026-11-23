// remove (uninstall/un/rm) — 删投影→.trash（--purge 直删）→除名；--scope project 仅删项目副本
import fs from 'node:fs';
import path from 'node:path';
import { unregisterSkill, trashPath } from '../lib/hub.js';
import { unproject, targetDirFor } from '../lib/project.js';
import { confirm } from '../lib/prompt.js';
import { ok, warn, fail, info } from '../lib/render.js';
import { rmDir } from '../lib/package.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const name = ctx.args[0];
  if (!name || ctx.args.length > 1) { fail(L('用法: skillmkt remove <名字> [--purge] [--scope project]（一次一个）', 'usage: skillmkt remove <name> [--purge] [--scope project] (one at a time)')); return 1; }
  const flags = ctx.flags.raw;
  if (flags.scope && !['project', 'global'].includes(flags.scope)) { fail(L(`--scope 只能是 project|global: ${flags.scope}`, `--scope must be project|global: ${flags.scope}`)); return 1; }
  const entry = ctx.library.skills?.[name];
  if (!entry) { fail(L(`没纳入管理: ${name}`, `not managed: ${name}`)); return 1; }

  const projectOnly = flags.scope === 'project';
  const targets = Object.entries(ctx.lock.skills?.[name]?.targets || {})
    .filter(([t]) => (projectOnly ? t.startsWith('project:') : true));

  for (const [t, lockT] of targets) {
    const dir = targetDirFor(ctx, t, name);
    if (!dir) continue;
    const r = unproject(name, dir, { dryRun: ctx.flags.dryRun });
    if (r.action !== 'absent') info(`${r.action === 'removed' ? L('已删', 'removed') : r.action === 'would-remove' ? L('将删', 'would remove') : r.action} ${r.target}`);
  }

  if (projectOnly) {
    info(L('已删项目内副本，hub 里的保留', 'project copy removed; hub copy kept'));
    return 0;
  }

  if (!ctx.flags.dryRun) {
    const hubDir = path.join(ctx.hub, 'skills', name);
    if (fs.existsSync(hubDir)) {
      if (flags.purge) { rmDir(hubDir); info(L(`已彻底删除 ${hubDir}`, `purged ${hubDir}`)); }
      else {
        const trash = trashPath(ctx.hub, name);
        rmDir(trash);
        fs.renameSync(hubDir, trash);
        info(L(`→ 移进 .trash（想恢复：mv 回 skills/，或重新 install）`, `→ moved to .trash (restore: mv back to skills/, or reinstall)`));
      }
    }
    unregisterSkill(ctx.hub, name);
  }
  ok(`${ctx.flags.dryRun ? '[dry-run] ' : ''}${L('已移除', 'removed')} ${name}${flags.purge ? L('（含 hub 副本）', ' (hub copy purged)') : ''}`);
  return 0;
}
