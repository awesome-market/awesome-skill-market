// upgrade — apt upgrade：拉新→diff 摘要→重审→快照→重投影→改 lock；--dry-run 只演示
import fs from 'node:fs';
import path from 'node:path';
import { fetchSkill } from '../lib/registries/github.js';
import { readUpstream, setUpstream, historySnapshot } from '../lib/state.js';
import { auditDir, stripFilter, writeScan } from '../lib/audit.js';
import { readSkillDir, walk, rmDir, treeHash } from '../lib/package.js';
import { projectSkill, targetDirFor } from '../lib/project.js';
import { registerSkill, updateLock } from '../lib/hub.js';
import { fetchMirror } from '../lib/registries/index.js';
import { ok, warn, fail, info } from '../lib/render.js';

function copyFiltered(src, dst, keep) {
  fs.mkdirSync(dst, { recursive: true });
  for (const p of walk(src)) {
    const rel = path.relative(src, p).split(path.sep).join('/');
    if (!keep(rel)) continue;
    const d = path.join(dst, rel);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(p, d);
  }
}

export async function run(ctx) {
  const flags = ctx.flags.raw;
  const up = readUpstream(ctx.hub);
  const skills = ctx.library.skills || {};
  const names = flags.all ? Object.keys(skills) : ctx.args;
  if (!names.length) { fail('usage: skillmkt upgrade <name|--all>'); return 1; }

  let upgraded = 0;
  for (const name of names) {
    const s = skills[name];
    if (!s) { warn(`未受管: ${name}`); continue; }
    const u = up.skills?.[name];
    if (!u?.outdated && !flags.force) { info(`${name}: clean（update 先刷新）`); continue; }
    const src = s.source || {};
    if (src.registry !== 'github' || !src.ref) { warn(`${name}: 无上游可升级`); continue; }

    const [owner, repo] = src.ref.split('/');
    info(`${name}: fetching ${src.ref} …`);
    try {
      const got = await fetchSkill({ owner, repo, ref: null, path: src.path || null, mirror: fetchMirror(ctx) });
      const pkg = readSkillDir(got.dir);
      const audit = auditDir(got.dir, { strip: !flags.keepScripts });
      if (audit.verdict === 'malicious') { warn(`${name}: 新版审核 malicious——保留旧版（quarantine 不收新版）`); continue; }
      if (ctx.flags.dryRun) {
        info(`[dry-run] ${name}: ${pkg?.fileCount ?? '?'} files, audit:${audit.verdict}${audit.stripped.length ? `,strip ${audit.stripped.length}` : ''}`);
        continue;
      }
      historySnapshot(ctx.hub, name);
      const dest = path.join(ctx.hub, 'skills', name);
      rmDir(dest);
      copyFiltered(got.dir, dest, stripFilter(flags.keepScripts ? [] : audit.stripped));
      writeScan(ctx.hub, name, audit);
      // 重投影
      const lockTargets = {};
      for (const t of s.targets || []) {
        const dir = targetDirFor(ctx, t, name);
        if (!dir) continue;
        const r = projectSkill(dest, name, dir, { mode: 'copy' });
        lockTargets[t] = { hash: r.hash, projected_at: new Date().toISOString(), mode: 'copy' };
      }
      registerSkill(ctx.hub, name, { ...s, source: { ...src, pin: got.sha }, version: pkg?.version || s.version, installed_at: new Date().toISOString(), audit: audit.stripped.length ? 'stripped' : audit.verdict });
      updateLock(ctx.hub, name, treeHash(dest), lockTargets);
      setUpstream(ctx.hub, name, { ref: got.sha, outdated: false });
      upgraded++;
      ok(`${name} → ${got.sha.slice(0, 7)} audit:${audit.verdict}`);
    } catch (e) {
      warn(`${name}: upgrade failed — ${e.message.slice(0, 100)}`);
    }
  }
  ok(`upgrade done: ${upgraded} applied`);
  return 0;
}
