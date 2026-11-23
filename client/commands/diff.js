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
  if (!name || ctx.args.length > 1) { fail(L('用法: skillmkt diff <名字> [--ref <tag|sha>] [--semantic]', 'usage: skillmkt diff <name> [--ref <tag|sha>] [--semantic]')); return 1; }
  const s = ctx.library.skills?.[name];
  if (!s) { fail(L(`没纳入管理: ${name}`, `not managed: ${name}`)); return 1; }
  const src = s.source || {};
  if (src.registry !== 'github' || !src.ref) { fail(L(`${name}: 无上游可比`, `${name}: no upstream to diff against`)); return 1; }

  const [owner, repo] = src.ref.split('/');
  const refArg = ctx.flags.raw.ref || null;          // --ref <tag/sha>：与任意上游版本比，默认 HEAD
  const localDir = path.join(ctx.hub, 'skills', name);
  const got = await fetchSkill({ owner, repo, ref: refArg, path: src.rpath || src.path || null, mirror: fetchMirror(ctx) });

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

  info(`${name}: pin ${src.pin?.slice(0, 7) ?? '-'} → ${L('上游', 'upstream')}${refArg ? `(${refArg.slice(0, 16)})` : ''} ${got.sha.slice(0, 7)}`);
  if (!refArg && src.pin && src.pin === got.sha) info(L('（pin 即上游当前版本——无差异属正常；要看旧版加 --ref <tag>）', '(pin equals upstream HEAD — empty diff expected; use --ref <tag> for older versions)'));
  info(`${L('文件', 'files')}: +${added.length} -${removed.length} ~${changed.length}`);
  if (refArg && !added.length && !removed.length && !changed.length) info(L('（repo 的 tag 是全仓快照——该 commit 变的是别的文件，这个 skill 子目录与本地一致）', '(repo tags are whole-repo snapshots — that commit changed other files; this skill subdir is identical to local)'));
  if (secAdded.length) info(`${L('新增小节', 'sections +')}: ${secAdded.join(' | ')}`);
  if (secRemoved.length) info(`${L('删掉的小节', 'sections -')}: ${secRemoved.join(' | ')}`);
  if (ctx.flags.raw.semantic) {
    if (!ctx.llm) { warn(L('--semantic 需要 LLM——先跑 skillmkt init；上面是结构 diff', '--semantic needs an LLM — run skillmkt init; structural diff shown above')); return 0; }
    const summary = await semanticDiff(ctx.llm, { name, added, removed, changed, secAdded, secRemoved }).catch(() => null);
    info(summary ? `semantic: ${summary}` : L('semantic: LLM 不可用——上面是结构 diff', 'semantic: LLM unavailable — structural diff above'));
  }
  return 0;
}
