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
  if (!name) { fail('usage: skillmkt remove <name> [--purge] [--scope project]'); return 1; }
  const flags = ctx.flags.raw;
  const entry = ctx.library.skills?.[name];
  if (!entry) { fail(L(`未受管: ${name}`, `not managed: ${name}`)); return 1; }

  const projectOnly = flags.scope === 'project';
  const targets = Object.entries(ctx.lock.skills?.[name]?.targets || {})
    .filter(([t]) => (projectOnly ? t.startsWith('project:') : true));

  for (const [t, lockT] of targets) {
    const dir = targetDirFor(ctx, t, name);
    if (!dir) continue;
    const r = unproject(name, dir, { dryRun: ctx.flags.dryRun });
    if (r.action !== 'absent') info(`${r.action} ${r.target}`);
  }

  if (projectOnly) {
    info(L('project copy removed; hub 不动', 'project copy removed; hub copy kept'));
    return 0;
  }

  if (!ctx.flags.dryRun) {
    const hubDir = path.join(ctx.hub, 'skills', name);
    if (fs.existsSync(hubDir)) {
      if (flags.purge) { rmDir(hubDir); info(`purged ${hubDir}`); }
      else {
        const trash = trashPath(ctx.hub, name);
        rmDir(trash);
        fs.renameSync(hubDir, trash);
        info(L(`→ .trash（恢复: mv 回 skills/ 或 skillmkt install <path>）`, `→ .trash (restore: mv back to skills/ or skillmkt install <path>)`));
      }
    }
    unregisterSkill(ctx.hub, name);
  }
  ok(`${ctx.flags.dryRun ? '[dry-run] ' : ''}removed ${name}${flags.purge ? ' (purged)' : ''}`);
  return 0;
}
