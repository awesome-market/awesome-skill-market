// registry — list / add --type <t> --url <u> [--token env:X] [--name n] / remove <name>
import { readConfig, writeConfig } from '../lib/hub.js';
import { table, ok, fail } from '../lib/render.js';

export async function run(ctx) {
  const [sub, ...rest] = ctx.args;
  const flags = ctx.flags.raw;
  const raw = readConfig(ctx.hub)._raw;
  raw.registries = raw.registries || [{ type: 'github', default: true }];

  if (!sub || sub === 'list') {
    if (ctx.flags.json) { console.log(JSON.stringify(raw.registries, null, 2)); return 0; }
    table(raw.registries.map((r) => ({ type: r.type, name: r.name || '-', url: r.url || '-', default: r.default ? '●' : '', auth: r.token ? '●' : '' })),
      [{ key: 'type', title: 'type' }, { key: 'name', title: 'name' }, { key: 'url', title: 'url' }, { key: 'default', title: 'def' }, { key: 'auth', title: 'auth' }]);
    return 0;
  }

  if (sub === 'add') {
    if (!flags.type) { fail(L('用法: registry add --type <github|rfc|clawhub|skillssh> [--url u] [--name n] [--token env:X]', 'usage: registry add --type <github|rfc|clawhub|skillssh> [--url u] [--name n] [--token env:X]')); return 1; }
    const entry = { type: flags.type };
    if (flags.url) entry.url = flags.url;
    if (flags.name) entry.name = flags.name;
    if (flags.token) entry.token = flags.token.startsWith('env:') ? flags.token : `env:${flags.token}`;
    raw.registries.push(entry);
    writeConfig(ctx.hub, raw);
    ok(L(`registry 已添加: ${flags.type}`, `registry added: ${flags.type}`) + `${flags.url ? ` ${flags.url}` : ''}${flags.name ? ` (${flags.name})` : ''}`);
    return 0;
  }

  if (sub === 'remove' || sub === 'rm') {
    const id = rest[0];
    const before = raw.registries.length;
    raw.registries = raw.registries.filter((r) => (r.name || r.type) !== id);
    if (raw.registries.length === before) { fail(L(`没找到: ${id}`, `not found: ${id}`)); return 1; }
    writeConfig(ctx.hub, raw);
    ok(L(`registry 已删: ${id}`, `registry removed: ${id}`));
    return 0;
  }

  fail(L('用法: registry [list] | add --type … | remove <名字>', 'usage: registry [list] | add --type … | remove <name>'));
  return 1;
}
