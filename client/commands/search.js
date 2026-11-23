// search (find/f/s) — 本地优先两级检索；--remote 走 skills.sh 官方 API
import { scanAll } from '../lib/scanner.js';
import { searchRemote } from '../lib/registries/skillssh.js';
import { table, info, warn } from '../lib/render.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const query = ctx.args.join(' ').trim();
  if (!query) { warn(L('用法: skillmkt search <关键词> [--local|--remote] [--json]', 'usage: skillmkt search <query> [--local|--remote] [--json]')); return 1; }
  const flags = ctx.flags.raw;
  const q = query.toLowerCase();

  // LOCAL：已装+external
  const rows = scanAll(ctx.hub, ctx.harnesses, ctx.library, ctx.project?.root);
  const local = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.meta?.description || '').toLowerCase().includes(q));

  // REMOTE：默认 TTY 附带；--remote 强制；--local 禁用
  let remote = { skills: [], base: null }, remoteErr = null;
  const wantRemote = flags.remote || (!flags.local && ctx.tty);
  if (wantRemote) {
    try { remote = await searchRemote(query, ctx); }
    catch (e) { remoteErr = e.message; }
  }

  if (ctx.flags.json) {
    console.log(JSON.stringify({ local: local.map((r) => ({ name: r.name, where: r.where, state: r.state, path: r.path })), remote: remote.skills }, null, 2));
    return 0;
  }

  info(L('本地', 'LOCAL'));
  if (local.length) {
    table(local.map((r) => ({ name: r.name, where: `${r.where}${r.state === 'external' ? ' (external)' : ''}`, ver: r.version })),
      [{ key: 'name', title: 'skill' }, { key: 'where', title: 'where' }, { key: 'ver', title: 'ver' }]);
  } else info(L('  （本地没匹配到）', '  (no local match)'));

  if (wantRemote) {
    info('');
    info(L(`远端 ${remote.base || ''}`, `REMOTE ${remote.base || ''}`));
    if (remoteErr) warn(L(`远端搜索失败: ${remoteErr}（本地结果仍可用）`, `remote search failed: ${remoteErr} (local results still shown)`));
    else if (remote.skills.length) {
      table(remote.skills.slice(0, 15).map((s) => ({ name: s.name, id: s.slug, installs: s.installs })),
        [{ key: 'name', title: 'skill' }, { key: 'id', title: 'id' }, { key: 'installs', title: 'installs' }]);
      info(`→ skillmkt install ${remote.skills[0].slug.split('/').slice(0, 2).join('/')} --path ${remote.skills[0].slug.split('/').slice(2).join('/')}`);
    } else info(L('  （远端没匹配到）', '  (no remote match)'));
  }
  return 0;
}
