// download — apt download 语义：fetch+审核→cache/ 不装不投影；install 命中缓存复用
import path from 'node:path';
import { parseRef } from '../lib/ref.js';
import { fetchRef } from '../lib/registries/index.js';
import { auditDir, writeScan } from '../lib/audit.js';
import { readSkillDir, copyDir, rmDir } from '../lib/package.js';
import { ensureHub, cacheDir, quarantinePath } from '../lib/hub.js';
import { ok, warn, fail } from '../lib/render.js';
import { L } from '../lib/i18n.js';

export async function run(ctx) {
  const input = ctx.args[0];
  if (!input) { fail('usage: skillmkt download <ref>'); return 1; }
  const ref = parseRef(input, ctx.flags.raw, { harnesses: ctx.harnesses, registries: ctx.config.registries });
  ensureHub(ctx.hub);

  const got = ref.kind === 'local' || ref.kind === 'harness'
    ? { dir: ref.absPath, provenance: { registry: 'local', adopted_from: ref.absPath }, sha: null }
    : await fetchRef(ref, ctx);
  const pkg = readSkillDir(got.dir);
  if (!pkg) { fail(L(`不是合法 skill: ${input}`, `not a valid skill: ${input}`)); return 1; }
  const audit = auditDir(got.dir, { strip: !ctx.flags.raw.keepScripts });
  if (audit.verdict === 'malicious') {
    if (!ctx.flags.dryRun) { rmDir(quarantinePath(ctx.hub, pkg.name)); copyDir(got.dir, quarantinePath(ctx.hub, pkg.name)); writeScan(ctx.hub, pkg.name, audit); }
    warn(`malicious — quarantined: ${pkg.name}`);
    return 2;
  }
  const dest = cacheDir(ctx.hub, pkg.name, got.sha || pkg.contentHash);
  if (!ctx.flags.dryRun) {
    rmDir(dest);
    copyDir(got.dir, dest);
    writeScan(ctx.hub, pkg.name, audit);
  }
  ok(`${ctx.flags.dryRun ? '[dry-run] ' : ''}downloaded ${pkg.name} → cache (${pkg.fileCount} files, audit:${audit.verdict})`);
  return 0;
}
