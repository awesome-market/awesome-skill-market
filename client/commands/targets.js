// targets — list / add <harness> / add --path <dir> <name> / remove <id>
import path from 'node:path';
import { table, ok, fail, info } from '../lib/render.js';
import { readConfig, writeConfig, expandHome } from '../lib/hub.js';
import { projectSkill } from '../lib/project.js';
import { updateLock } from '../lib/hub.js';
import { readSkillDir } from '../lib/package.js';
import { maybeHandoff } from '../lib/daemon.js';
import fs from 'node:fs';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const [sub, ...rest] = ctx.args;
  const flags = ctx.flags.raw;

  if ((!sub || sub === 'list') && !ctx.flags.json && await maybeHandoff(ctx, '/#skills')) return 0;

  if (!sub || sub === 'list') {
    const rows = ctx.harnesses.map((h) => ({
      id: h.id, state: h.state,
      dir: h.dirs.map((d) => d.path).join(', '),
      default: ctx.config.default_targets.includes(h.id) ? '●' : '',
    }));
    const customs = Object.entries(ctx.config.targets).map(([n, t]) => ({ id: n, state: 'custom', dir: expandHome(t.path), default: ctx.config.default_targets.includes(n) ? '●' : '' }));
    if (ctx.flags.json) { console.log(JSON.stringify({ harnesses: rows, custom: customs }, null, 2)); return 0; }
    table([...rows, ...customs], [
      { key: 'id', title: 'target' }, { key: 'state', title: 'state' },
      { key: 'dir', title: 'dir' }, { key: 'default', title: 'def' },
    ]);
    return 0;
  }

  if (sub === 'add') {
    const raw = readConfig(ctx.hub)._raw;
    // targets add --path <dir> <name>
    if (flags.path) {
      const name = rest[0];
      if (!name) { fail(L('用法: targets add --path <目录> <名字>', 'usage: targets add --path <dir> <name>')); return 1; }
      raw.targets = raw.targets || {};
      raw.targets[name] = { path: flags.path, transport: 'copy' };
      writeConfig(ctx.hub, raw);
      ok(L(`自定义目标已登记: ${name} → ${flags.path}`, `custom target registered: ${name} → ${flags.path}`));
      return 0;
    }
    // targets add <harness-id|custom-name>：写 default_targets + 立即投影全部
    const id = rest[0];
    if (!id) { fail(L('用法: targets add <id>', 'usage: targets add <id>')); return 1; }
    const h = ctx.harnesses.find((x) => x.id === id);
    const custom = ctx.config.targets[id];
    if (!h && !custom) { fail(L(`未知目标: ${id}`, `unknown target: ${id}`)); return 1; }
    raw.default_targets = [...new Set([...(raw.default_targets || []), id])];
    writeConfig(ctx.hub, raw);
    ok(L(`${id} → 已加入默认目标`, `${id} → added to default targets`));

    const dirs = h ? h.dirs.map((d) => ({ dir: d.path, id })) : [{ dir: expandHome(custom.path), id: `custom:${expandHome(custom.path)}` }];
    for (const [name] of Object.entries(ctx.library.skills || {})) {
      const src = path.join(ctx.hub, 'skills', name);
      if (!fs.existsSync(src)) continue;
      for (const { dir, id: tid } of dirs) {
        const r = projectSkill(src, name, dir, { mode: 'copy', dryRun: ctx.flags.dryRun });
        info(`${name} → ${r.action === 'copied' ? L('已装', 'copied') : r.action === 'skipped' ? L('已在', 'present') : r.action} ${r.target}`);
      }
    }
    return 0;
  }

  if (sub === 'remove' || sub === 'rm') {
    const id = rest[0];
    const raw = readConfig(ctx.hub)._raw;
    if (raw.targets?.[id]) { delete raw.targets[id]; writeConfig(ctx.hub, raw); ok(L(`自定义目标已删: ${id}`, `custom target removed: ${id}`)); return 0; }
    raw.default_targets = (raw.default_targets || []).filter((t) => t !== id);
    writeConfig(ctx.hub, raw);
    ok(L(`${id} 已从默认目标移除（装到各 agent 的副本还在——skillmkt sync 清理）`, `${id} removed from default targets (projected copies kept — skillmkt sync can clean)`));
    return 0;
  }

  fail(L('用法: skillmkt targets [list] | add <id> | add --path <目录> <名字> | remove <id>', 'usage: skillmkt targets [list] | add <id> | add --path <dir> <name> | remove <id>'));
  return 1;
}
