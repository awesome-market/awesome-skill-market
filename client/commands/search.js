// search (find/f/s) — npm 语义：默认只搜远端 skills.sh；--local 才查本地
import { scanAll } from '../lib/scanner.js';
import { searchRemote } from '../lib/registries/skillssh.js';
import { table, info, warn } from '../lib/render.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const query = ctx.args.join(' ').trim();
  if (!query) { warn(L('用法: skillmkt search <关键词> [--local] [--json]', 'usage: skillmkt search <query> [--local] [--json]')); return 1; }
  const flags = ctx.flags.raw;
  const q = query.toLowerCase();

  // npm 对齐：默认远端；--local 只查本地；--local --remote 两个都出
  const wantLocal = !!flags.local;
  const wantRemote = !flags.local || !!flags.remote;

  // LOCAL：已装+external（--local 时才扫）
  let local = [];
  if (wantLocal) {
    const rows = scanAll(ctx.hub, ctx.harnesses, ctx.library, ctx.project?.root);
    local = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.meta?.description || '').toLowerCase().includes(q));
  }

  let remote = { skills: [], base: null }, remoteErr = null;
  if (wantRemote) {
    try { remote = await searchRemote(query, ctx); }
    catch (e) { remoteErr = e.message; }
  }

  if (ctx.flags.json) {
    console.log(JSON.stringify({ local: local.map((r) => ({ name: r.name, where: r.where, state: r.state, path: r.path })), remote: remote.skills }, null, 2));
    return 0;
  }

  if (wantLocal) {
    info(L('本地', 'LOCAL'));
    if (local.length) {
      table(local.map((r) => ({ name: r.name, where: `${r.where}${r.state === 'external' ? ` ${L('（未管理）', '(external)')}` : ''}`, ver: r.version, desc: (r.description || '').slice(0, 50) })),
        [{ key: 'name', title: 'skill' }, { key: 'where', title: L('位置', 'where') }, { key: 'ver', title: 'ver' }, { key: 'desc', title: L('说明', 'desc') }]);
    } else info(L('  （本地没匹配到）', '  (no local match)'));
    if (wantRemote) info('');
  }

  if (wantRemote) {
    if (remoteErr) warn(L(`远端搜索失败: ${remoteErr}`, `remote search failed: ${remoteErr}`));
    else if (remote.skills.length) {
      table(remote.skills.slice(0, 15).map((s) => ({ name: s.name, id: s.slug, installs: s.installs })),
        [{ key: 'name', title: 'skill' }, { key: 'id', title: 'id' }, { key: 'installs', title: 'installs' }]);
      info(`→ skillmkt install ${remote.skills[0].slug.split('/').slice(0, 2).join('/')} --path ${remote.skills[0].slug.split('/').slice(2).join('/')}`);
    } else info(L('（远端没匹配到）', '(no remote match)'));
  }
  return 0;
}
