// targets — list / add <harness> / add --path <dir> <name> / remove <id>
//          <skill> [add|remove <id>…] —— 单个 skill 的投影目标
import path from 'node:path';
import { table, ok, fail, info } from '../lib/render.js';
import { readConfig, writeConfig, expandHome } from '../lib/hub.js';
import { projectSkill, setSkillTargets, targetDirFor } from '../lib/project.js';
import { updateLock } from '../lib/hub.js';
import { readSkillDir } from '../lib/package.js';
import { maybeHandoff } from '../lib/daemon.js';
import fs from 'node:fs';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const [sub, ...rest] = ctx.args;
  const flags = ctx.flags.raw;

  // ── per-skill：targets <skill> [add|remove <id>…]
  if (sub && ctx.library.skills?.[sub]) {
    const name = sub;
    const s = ctx.library.skills[name];
    const verb = rest[0];
    if (!verb) {                                   // 只看这个 skill 的目标
      const rows = (s.targets || []).map((t) => ({ target: t, dir: targetDirFor(ctx, t, name) || '—' }));
      if (!rows.length) info(L(`${name}: 没有投影目标（只在 hub 仓库里）`, `${name}: no targets — hub only`));
      else table(rows, [{ key: 'target', title: L('目标', 'target') }, { key: 'dir', title: L('目录', 'dir') }]);
      return 0;
    }
    if (!['add', 'remove', 'rm'].includes(verb)) {
      fail(L(`用法: targets ${name} [add|remove <id>…]`, `usage: targets ${name} [add|remove <id>…]`));
      return 1;
    }
    const ids = rest.slice(1);
    if (!ids.length) { fail(L(`用法: targets ${name} ${verb} <id>`, `usage: targets ${name} ${verb} <id>`)); return 1; }
    const toId = (id) => {                          // harness id 或登记的自定义目标名
      if (ctx.harnesses.some((h) => h.id === id)) return id;
      const c = ctx.config.targets[id];
      if (c) return `custom:${path.resolve(expandHome(c.path))}`;   // 同 resolveTargets 的落库格式
      return null;
    };
    const bad = ids.filter((id) => !toId(id));
    if (bad.length) { fail(L(`未知目标: ${bad.join(', ')}`, `unknown target: ${bad.join(', ')}`)); return 1; }
    const next = new Set(s.targets || []);
    for (const id of ids) { const tid = toId(id); if (verb === 'add') next.add(tid); else next.delete(tid); }
    const rs = setSkillTargets(ctx, name, [...next], { dryRun: ctx.flags.dryRun });
    const actZh = { removed: '已删', copied: '已装', skipped: '已在', absent: '本来没有', 'would-remove': '将删', 'would-create': '将装', 'would-update': '将更新', 'unknown-target': '未知目标', conflict: '冲突' };
    for (const r of rs) info(`${r.t} → ${L(actZh[r.action] ?? r.action, r.action)} ${r.target || ''}`);
    ok(L(`${name} 目标已更新`, `${name} targets updated`));
    return 0;
  }


  if ((!sub || sub === 'list') && !ctx.flags.json && await maybeHandoff(ctx, '/#skills')) return 0;

  if (!sub || sub === 'list') {
    const stZh = { installed: '已装', available: '可装', likely: '疑似', absent: '没有', custom: '自定义' };
    const rows = ctx.harnesses.map((h) => ({
      id: h.id, state: L(stZh[h.state] ?? h.state, h.state),
      dir: h.dirs.map((d) => d.path).join(', '),
      default: ctx.config.default_targets.includes(h.id) ? '●' : '',
    }));
    const customs = Object.entries(ctx.config.targets).map(([n, t]) => ({ id: n, state: L('自定义', 'custom'), dir: expandHome(t.path), default: ctx.config.default_targets.includes(n) ? '●' : '' }));
    if (ctx.flags.json) { console.log(JSON.stringify({ harnesses: rows, custom: customs }, null, 2)); return 0; }
    table([...rows, ...customs], [
      { key: 'id', title: L('目标', 'target') }, { key: 'state', title: L('状态', 'state') },
      { key: 'dir', title: L('目录', 'dir') }, { key: 'default', title: L('默认', 'def') },
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
