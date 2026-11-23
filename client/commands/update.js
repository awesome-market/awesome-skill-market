// update — 刷新上游元数据入 state/upstream.yml；TTY 下查到过期会列出名单让你勾选升级
// （非 TTY / --yes 保持纯检查——serve 后台刷新、脚本都走这条路）
import path from 'node:path';
import fs from 'node:fs';
import { remoteTree } from '../lib/registries/github.js';
import { setUpstream, readUpstream, writeUpstream } from '../lib/state.js';
import { gitTreeHash } from '../lib/githash.js';
import { ok, warn, info, fail } from '../lib/render.js';
import { multiChoose } from '../lib/prompt.js';
import { run as upgradeRun } from './upgrade.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const skills = ctx.library.skills || {};
  if (ctx.flags.raw.all && ctx.args.length) { fail(L('--all 和指定名字只能二选一', '--all and specific names are mutually exclusive')); return 1; }
  const names = ctx.flags.raw.all || !ctx.args.length ? Object.keys(skills) : ctx.args;
  let n = 0, na = 0, errs = 0;
  for (const name of names) {
    const s = skills[name];
    if (!s) { warn(L(`没纳入管理: ${name}`, `not managed: ${name}`)); continue; }
    const src = s.source || {};
    if (src.registry !== 'github' || !src.ref) { na++; continue; }   // adopted/local/rfc 无远端可查（rfc 走 registry 适配后续）
    try {
      const [owner, repo] = src.ref.split('/');
      // 与 HEAD 比（null→默认分支头）：pin 是固定 sha，拿它当 ref 永远查不到"上游有新版"
      const remote = await remoteTree(owner, repo, null, src.path || null);
      const localDir = path.join(ctx.hub, 'skills', name);
      const localTree = fs.existsSync(localDir) ? gitTreeHash(localDir) : null;
      setUpstream(ctx.hub, name, {
        ref: remote.sha, tree_hash: remote.tree_hash,
        outdated: localTree !== null && localTree !== remote.tree_hash,
      });
      n++;
      if (localTree !== remote.tree_hash) info(`${name}: ${L('上游有更新', 'upstream changed')}`);
    } catch (e) {
      errs++;
      warn(`${name}: ${e.message.slice(0, 80)}`);
    }
  }
  const u = readUpstream(ctx.hub);
  u.refreshed_at = new Date().toISOString();
  writeUpstream(ctx.hub, u);
  ok(L(`update 完成：刷新了 ${n} 个${na ? `，${na} 个无上游可查（收编/私有源）` : ''}${errs ? `，${errs} 个失败` : ''}`, `update done: ${n} refreshed${na ? `, ${na} n/a (adopted/private-source)` : ''}${errs ? `, ${errs} errors` : ''}`));

  // 第二步：有过期的列出名单，TTY 下勾选升级（预勾全部；0=都不升）
  const outs = Object.entries(u.skills || {}).filter(([nm, x]) => x.outdated && skills[nm]).map(([nm]) => nm);
  if (!outs.length) return errs ? 1 : 0;
  if (process.stdin.isTTY && !ctx.flags.yes) {
    const opts = outs.map((nm) => ({ label: nm }));
    const idx = await multiChoose(
      L(`有 ${outs.length} 个 skill 可升级——选要升级的`, `${outs.length} skill(s) can be upgraded — pick which`),
      opts, { checked: opts.map((_, i) => i) });
    const pick = idx.map((i) => outs[i]);
    if (!pick.length) info(L('一个没选——稍后 skillmkt upgrade --all 再升', 'none picked — run skillmkt upgrade --all later'));
    else await upgradeRun({ ...ctx, args: pick, flags: { ...ctx.flags, raw: { ...ctx.flags.raw, all: false } } });
  } else {
    info(L(`${outs.length} 个有更新——skillmkt upgrade 应用`, `${outs.length} outdated — run skillmkt upgrade`));
  }
  return errs ? 1 : 0;
}
