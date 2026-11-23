// targets — list / add <harness> / add --path <dir> <name> / remove <id>
import path from 'node:path';
import { table, ok, fail, info } from '../lib/render.js';
import { readConfig, writeConfig, expandHome } from '../lib/hub.js';
import { projectSkill } from '../lib/project.js';
import { updateLock } from '../lib/hub.js';
import { readSkillDir } from '../lib/package.js';
import fs from 'node:fs';

export async function run(ctx) {
  const [sub, ...rest] = ctx.args;
  const flags = ctx.flags.raw;

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
      if (!name) { fail('usage: targets add --path <dir> <name>'); return 1; }
      raw.targets = raw.targets || {};
      raw.targets[name] = { path: flags.path, transport: 'copy' };
      writeConfig(ctx.hub, raw);
      ok(`custom target registered: ${name} → ${flags.path}`);
      return 0;
    }
    // targets add <harness-id|custom-name>：写 default_targets + 立即投影全部
    const id = rest[0];
    if (!id) { fail('usage: targets add <id>'); return 1; }
    const h = ctx.harnesses.find((x) => x.id === id);
    const custom = ctx.config.targets[id];
    if (!h && !custom) { fail(`unknown target: ${id}`); return 1; }
    raw.default_targets = [...new Set([...(raw.default_targets || []), id])];
    writeConfig(ctx.hub, raw);
    ok(`${id} → default_targets`);

    const dirs = h ? h.dirs.map((d) => ({ dir: d.path, id })) : [{ dir: expandHome(custom.path), id: `custom:${expandHome(custom.path)}` }];
    for (const [name] of Object.entries(ctx.library.skills || {})) {
      const src = path.join(ctx.hub, 'skills', name);
      if (!fs.existsSync(src)) continue;
      for (const { dir, id: tid } of dirs) {
        const r = projectSkill(src, name, dir, { mode: 'copy', dryRun: ctx.flags.dryRun });
        info(`${name} → ${r.action} ${r.target}`);
      }
    }
    return 0;
  }

  if (sub === 'remove' || sub === 'rm') {
    const id = rest[0];
    const raw = readConfig(ctx.hub)._raw;
    if (raw.targets?.[id]) { delete raw.targets[id]; writeConfig(ctx.hub, raw); ok(`custom target removed: ${id}`); return 0; }
    raw.default_targets = (raw.default_targets || []).filter((t) => t !== id);
    writeConfig(ctx.hub, raw);
    ok(`${id} removed from default_targets（已投影副本保留——skillmkt sync 可清）`);
    return 0;
  }

  fail('usage: skillmkt targets [list] | add <id> | add --path <dir> <name> | remove <id>');
  return 1;
}
