// diff — lock pin vs 上游：默认结构 diff（文件/节增删）；--semantic 留待 LLM（批次6 接管）
import fs from 'node:fs';
import path from 'node:path';
import { fetchSkill } from '../lib/registries/github.js';
import { fetchMirror } from '../lib/registries/index.js';
import { walk, treeHash } from '../lib/package.js';
import { gitTreeHash } from '../lib/githash.js';
import { info, warn, fail } from '../lib/render.js';
import { semanticDiff } from '../lib/ai.js';
import { L } from '../lib/i18n.js';

function sectionsOf(dir) {
  const f = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter((l) => /^#{1,4}\s/.test(l)).map((l) => l.replace(/^#+\s*/, '').trim());
}

export async function run(ctx) {
  const name = ctx.args[0];
  const s = ctx.library.skills?.[name];
  if (!s) { fail(L(`未受管: ${name}`, `not managed: ${name}`)); return 1; }
  const src = s.source || {};
  if (src.registry !== 'github' || !src.ref) { fail(L(`${name}: 无上游可比`, `${name}: no upstream to diff against`)); return 1; }

  const [owner, repo] = src.ref.split('/');
  const localDir = path.join(ctx.hub, 'skills', name);
  const got = await fetchSkill({ owner, repo, ref: null, path: src.path || null, mirror: fetchMirror(ctx) });

  const localFiles = new Set([...walk(localDir)].map((p) => path.relative(localDir, p)));
  const remoteFiles = new Set([...walk(got.dir)].map((p) => path.relative(got.dir, p)));
  const added = [...remoteFiles].filter((f) => !localFiles.has(f));
  const removed = [...localFiles].filter((f) => !remoteFiles.has(f));
  const changed = [...remoteFiles].filter((f) => localFiles.has(f)).filter((f) => {
    try { return fs.readFileSync(path.join(localDir, f)).compare(fs.readFileSync(path.join(got.dir, f))) !== 0; } catch { return false; }
  });
  const lSec = sectionsOf(localDir), rSec = sectionsOf(got.dir);
  const secAdded = rSec.filter((x) => !lSec.includes(x));
  const secRemoved = lSec.filter((x) => !rSec.includes(x));

  const report = { name, sha: got.sha, files: { added, removed, changed }, sections: { added: secAdded, removed: secRemoved } };
  if (ctx.flags.json) { console.log(JSON.stringify(report, null, 2)); return 0; }

  info(`${name}: pin ${src.pin?.slice(0, 7) ?? '-'} → upstream ${got.sha.slice(0, 7)}`);
  info(`files: +${added.length} -${removed.length} ~${changed.length}`);
  if (secAdded.length) info(`sections +: ${secAdded.join(' | ')}`);
  if (secRemoved.length) info(`sections -: ${secRemoved.join(' | ')}`);
  if (ctx.flags.raw.semantic) {
    if (!ctx.llm) { warn(L('--semantic 需要 LLM（config.llm 或 OMLX_*）——以上为结构 diff', '--semantic needs an LLM (config.llm or OMLX_*) — structural diff shown above')); return 0; }
    const summary = await semanticDiff(ctx.llm, { name, added, removed, changed, secAdded, secRemoved }).catch(() => null);
    info(summary ? `semantic: ${summary}` : L('semantic: LLM 不可用——结构 diff 如上', 'semantic: LLM unavailable — structural diff above'));
  }
  return 0;
}
