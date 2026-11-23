// sync — 按 library+lock 重放全部投影；--dry-run 只报漂移 exit4；新 harness 交互询问
import fs from 'node:fs';
import path from 'node:path';
import { projectSkill, checkDrift, targetDirFor } from '../lib/project.js';
import { updateLock } from '../lib/hub.js';
import { confirm } from '../lib/prompt.js';
import { ok, warn, info } from '../lib/render.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const { library, lock } = ctx;

  if (ctx.flags.dryRun) {
    const drift = checkDrift(ctx);
    if (drift.length) {
      for (const d of drift) info(`${d.name} @ ${d.target}: ${d.issue === 'missing' ? L('目标里没了', 'missing') : L('内容不一致', 'content differs')}`);
      warn(L(`${drift.length} 处漂移——跑 skillmkt sync 修复`, `${drift.length} drift — run 'skillmkt sync' to repair`));
      return 4;
    }
    ok(L('投影一致，无需修复', 'projections in sync'));
    return 0;
  }

  // 新 available harness：交互询问纳入（非 TTY 不扩面）
  const avail = ctx.harnesses.filter((h) => h.state === 'available' && !h.detectOnly
    && !ctx.config.default_targets.includes(h.id));
  for (const h of avail) {
    if (await confirm(L(`检测到新 harness ${h.id}（available）——纳入默认投影目标?`, `New agent detected: ${h.id} (available) — add to default install locations?`), { defaultYes: false })) {
      const raw = ctx.config._raw;
      raw.default_targets = [...new Set([...(raw.default_targets || []), h.id])];
      const { writeConfig } = await import('../lib/hub.js');
      writeConfig(ctx.hub, raw);
      info(`${h.id} → ${L('加入默认目标', 'added to default targets')}`);
    }
  }

  let n = 0, repaired = 0;
  for (const [name, s] of Object.entries(library.skills || {})) {
    const src = path.join(ctx.hub, 'skills', name);
    if (!fs.existsSync(src)) { warn(L(`${name}: hub 副本缺失`, `${name}: hub copy missing`)); continue; }
    const lockTargets = {};
    for (const t of s.targets || []) {
      const dir = targetDirFor(ctx, t, name);
      if (!dir) { warn(`${name}: ${L(`未知目标 ${t}`, `unknown target ${t}`)}`); continue; }
      const r = projectSkill(src, name, dir, { mode: s.transport?.[t] === 'link' ? 'link' : 'copy', force: !!ctx.flags.raw.force });
      if (r.action === 'conflict') warn(`${name} @ ${t}: ${r.detail}${L('（手动改过的内容不覆盖——--force 强制重建，或改回后 sync）', ' (manual edits not overwritten — --force rebuilds, or revert then sync)')}`);
      else if (r.action !== 'skipped') { repaired++; info(`${name} → ${r.action === 'copied' ? L('已重建', 'rebuilt') : r.action} ${r.target}`); }
      lockTargets[t] = { hash: r.hash, projected_at: new Date().toISOString(), mode: r.mode };
      n++;
    }
    if (Object.keys(lockTargets).length) updateLock(ctx.hub, name, lock.skills?.[name]?.content_hash ?? 'sha256:', lockTargets);
  }
  ok(L(`sync 完成：检查了 ${n} 个目标，修了 ${repaired} 个`, `sync done: ${n} targets checked, ${repaired} (re)projected`));
  return 0;
}
