// install (alias: i, add) — fetch→审核闸门→strip→hub→投影→lock；harness 路径=收编
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureHub, registerSkill, updateLock, quarantinePath, cacheDir } from '../lib/hub.js';
import { parseRef } from '../lib/ref.js';
import { fetchRef } from '../lib/registries/index.js';
import { auditDir, stripFilter, writeScan } from '../lib/audit.js';
import { readSkillDir, copyDir, rmDir, walk, treeHash } from '../lib/package.js';
import { projectSkill, resolveTargets } from '../lib/project.js';
import { primaryDir } from '../lib/scanner.js';
import { cacheLookup } from '../lib/state.js';
import { confirm, multiChoose } from '../lib/prompt.js';
import { ok, warn, fail, info } from '../lib/render.js';

// 来源取证：.git remote → skills-lock.json → .market-skills.json → frontmatter
function recoverProvenance(dir, meta) {
  try {
    const remote = execFileSync('git', ['-C', dir, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const m = remote.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (m) {
      const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      return { registry: 'github', ref: `${m[1]}/${m[2]}`, pin: sha };
    }
  } catch { /* no .git */ }
  for (const f of ['skills-lock.json', '.market-skills.json']) {
    try {
      const lock = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const hit = lock.skills?.[path.basename(dir)] || lock[path.basename(dir)] || Object.values(lock.skills || lock)[0];
      const src = hit?.source || hit?.repo || hit?.id;
      if (src && src.includes('/')) {
        const [owner, repo, ...rest] = src.replace(/^https?:\/\/github\.com\//, '').split('/');
        return { registry: 'github', ref: `${owner}/${repo}`, path: rest.join('/') || null, pin: hit?.ref || hit?.version || null };
      }
    } catch { /* next file */ }
  }
  const home = meta?.homepage || meta?.repository;
  if (home?.includes('github.com')) {
    const m = home.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git|\/|$)/);
    if (m) return { registry: 'github', ref: `${m[1]}/${m[2]}`, pin: null };
  }
  return null;
}

// copy 目录但排除 stripped 相对路径
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
  const input = ctx.args[0];
  if (!input) { fail('usage: skillmkt install <ref|path|owner/repo>'); return 1; }
  const flags = ctx.flags.raw;

  const ref = parseRef(input, flags, { harnesses: ctx.harnesses, registries: ctx.config.registries });
  if (!ctx.flags.dryRun) ensureHub(ctx.hub);

  // ① 取得源目录
  let srcDir, provenance, tmp = null, adopted = null;
  if (ref.kind === 'local' || ref.kind === 'harness') {
    srcDir = ref.absPath;
    if (ref.kind === 'harness') {
      adopted = { from: ref.absPath, harnessId: ref.harnessId };
      provenance = recoverProvenance(ref.absPath, readSkillDir(ref.absPath)?.meta || {});
    }
    provenance = provenance || { registry: ref.kind === 'harness' ? 'adopted' : 'local', adopted_from: ref.absPath };
  } else {
    // download 缓存命中：cache/<name>-*/ 存在即复用不重复拉
    const cached = ref.kind === 'named' ? cacheLookup(ctx.hub, ref.name) : null;
    if (cached) {
      info(`cache hit: ${cached}`);
      srcDir = cached;
      provenance = { registry: 'cache', adopted_from: cached };
    } else {
      info(`fetching ${input} …`);
      const got = await fetchRef(ref, ctx);
      srcDir = got.dir; tmp = got.tmp;
      provenance = got.provenance;
    }
  }

  const pkg = readSkillDir(srcDir);
  if (!pkg) { fail(`不是合法 skill（缺 SKILL.md）: ${srcDir}`); return 1; }
  const name = pkg.name;

  // ② 审核闸门
  const audit = auditDir(srcDir, { strip: !flags.keepScripts });
  if (audit.verdict === 'malicious') {
    if (!ctx.flags.dryRun) {
      rmDir(quarantinePath(ctx.hub, name));
      copyDir(srcDir, quarantinePath(ctx.hub, name));
      writeScan(ctx.hub, name, audit);
    }
    fail(`malicious — quarantined: ${name}（${audit.findings.length} findings）`);
    return 2;
  }
  if (audit.verdict === 'suspicious' && ctx.config.policy !== 'permissive') {
    warn(`suspicious: ${audit.findings.length} findings${audit.stripped.length ? `, stripping ${audit.stripped.length} files` : ''}`);
    audit.findings.slice(0, 5).forEach((f) => info(`${f.rule} ${f.file}:${f.line} — ${f.excerpt.slice(0, 80)}`));
    // --yes 不放大 suspicious（安全默认）；strict 直接拒
    const proceed = ctx.config.policy === 'strict' ? false : await confirm(`继续安装 ${name}?`, { defaultYes: false });
    if (!proceed) { fail('install aborted'); return 2; }
  }

  // ③ 落 hub（stripped 过滤）
  const dest = path.join(ctx.hub, 'skills', name);
  const freshHash = () => treeHash(dest);
  const alreadyManaged = ctx.library.skills?.[name] && fs.existsSync(dest);
  if (alreadyManaged) {
    const keep = stripFilter(audit.stripped);
    // 与现有 hub 副本内容对比：相同则跳过 copy
    const srcFilteredHash = (() => { const t = path.join(ctx.hub, 'cache', `__probe_${process.pid}`); rmDir(t); copyFiltered(srcDir, t, keep); const h = treeHash(t); rmDir(t); return h; })();
    if (srcFilteredHash !== freshHash() && !flags.force) {
      warn(`${name} 已受管且内容不同——--force 覆盖，或 upgrade 流程`);
      return 1;
    }
  }
  if (!ctx.flags.dryRun) {
    rmDir(dest);
    copyFiltered(srcDir, dest, stripFilter(flags.keepScripts ? [] : audit.stripped));
    writeScan(ctx.hub, name, audit);
  }

  // ④ 投影目标：收编默认仅原 harness；其余 --to/--target/default_targets(空则全部 installed)
  let targets = adopted && !flags.target
    ? [{ id: adopted.harnessId, dir: path.dirname(adopted.from), mode: 'copy' }]
    : resolveTargets(ctx, { allowAdopted: ctx.harnesses.filter((h) => h.state === 'installed').map((h) => h.id) });

  // TTY 自选：未显式 --to/--target/--scope/--yes 且非收编 → 候选=解析结果∪全部可投影 agent，预勾选=解析结果
  if (ctx.tty && !ctx.flags.yes && !flags.to && !flags.target && !flags.scope && !adopted) {
    const pool = [...targets];
    const have = new Set(pool.map((t) => t.id));
    for (const h of ctx.harnesses) {
      if (h.detectOnly || h.state === 'absent' || have.has(h.id)) continue;
      const dir = primaryDir(h);
      if (dir) pool.push({ id: h.id, dir, mode: 'copy' });
    }
    if (pool.length) {
      const checked = pool.map((_, i) => i).slice(0, targets.length);
      const idx = await multiChoose(`装到哪些位置？`, pool.map((t) => `${t.id} → ${t.dir}`), { checked });
      targets = idx.map((i) => pool[i]);
    }
  }

  // ⑤ 投影 + lock
  const results = [];
  const lockTargets = {};
  for (const t of targets) {
    const lockT = ctx.lock.skills?.[name]?.targets?.[t.id];
    const r = projectSkill(dest, name, t.dir, {
      mode: t.mode, dryRun: ctx.flags.dryRun, force: !!flags.force,
      lockEntry: lockT ? { hash: lockT.hash } : null,
    });
    results.push({ ...r, id: t.id });
    if (r.action === 'conflict') warn(`${name} → ${t.dir}: ${r.detail}`);
    else lockTargets[t.id] = { hash: r.hash, projected_at: new Date().toISOString(), mode: r.mode };
  }

  if (!ctx.flags.dryRun) {
    registerSkill(ctx.hub, name, {
      source: {
        ...provenance,
        ...(adopted ? { registry: provenance?.registry === 'github' ? 'github' : 'adopted', adopted_from: adopted.from, adopted_at: new Date().toISOString() } : {}),
      },
      version: pkg.version,
      installed_at: new Date().toISOString(),
      targets: Object.keys(lockTargets),
      scope: flags.scope === 'project' ? 'project' : 'global',
      project_root: flags.scope === 'project' ? ctx.project?.root ?? null : null,
      audit: audit.stripped.length ? 'stripped' : audit.verdict === 'suspicious' ? 'suspicious' : 'clean',
      transport: Object.fromEntries(Object.keys(lockTargets).map((k) => [k, lockTargets[k].mode])),
    });
    if (Object.keys(lockTargets).length) updateLock(ctx.hub, name, treeHash(dest), lockTargets);
  }

  const mark = results.map((r) => `${r.id.split(':')[0]}(${r.action === 'copied' ? 'copy' : r.action === 'linked' ? 'sym' : r.action})`).join(' ');
  ok(`${ctx.flags.dryRun ? '[dry-run] ' : ''}installed ${name} → ${mark || 'hub only'} · audit:${audit.stripped.length ? 'stripped' : audit.verdict} · locked ${treeHash(dest).slice(7, 15)}`);
  return 0;
}
