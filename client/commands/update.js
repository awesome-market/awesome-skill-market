// update — apt update 语义：只刷新上游元数据入 state/upstream.yml，不碰已装
import path from 'node:path';
import fs from 'node:fs';
import { remoteTree } from '../lib/registries/github.js';
import { setUpstream, readUpstream, writeUpstream } from '../lib/state.js';
import { gitTreeHash } from '../lib/githash.js';
import { ok, warn, info } from '../lib/render.js';

export async function run(ctx) {
  const skills = ctx.library.skills || {};
  const names = ctx.args[0] === '--all' || !ctx.args[0] ? Object.keys(skills) : ctx.args;
  let n = 0, na = 0, errs = 0;
  for (const name of names) {
    const s = skills[name];
    if (!s) { warn(`未受管: ${name}`); continue; }
    const src = s.source || {};
    if (src.registry !== 'github' || !src.ref) { na++; continue; }   // adopted/local/rfc 无远端可查（rfc 走 registry 适配后续）
    try {
      const [owner, repo] = src.ref.split('/');
      const remote = await remoteTree(owner, repo, src.pin, src.path || null);
      const localDir = path.join(ctx.hub, 'skills', name);
      const localTree = fs.existsSync(localDir) ? gitTreeHash(localDir) : null;
      setUpstream(ctx.hub, name, {
        ref: remote.sha, tree_hash: remote.tree_hash,
        outdated: localTree !== null && localTree !== remote.tree_hash,
      });
      n++;
      if (localTree !== remote.tree_hash) info(`${name}: upstream changed`);
    } catch (e) {
      errs++;
      warn(`${name}: ${e.message.slice(0, 80)}`);
    }
  }
  const u = readUpstream(ctx.hub);
  u.refreshed_at = new Date().toISOString();
  writeUpstream(ctx.hub, u);
  ok(`update done: ${n} refreshed${na ? `, ${na} n/a(adopted/local)` : ''}${errs ? `, ${errs} errors` : ''}`);
  return errs ? 1 : 0;
}
