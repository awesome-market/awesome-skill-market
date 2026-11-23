// show (view/info) — skill 详情卡：frontmatter+版本+审核+目标；--raw/--files/--audit
import fs from 'node:fs';
import path from 'node:path';
import { readSkillDir, parseFrontmatter } from '../lib/package.js';
import { scanAll } from '../lib/scanner.js';
import { readYAMLFile } from '../lib/hub.js';
import { info, fail } from '../lib/render.js';

export async function run(ctx) {
  const name = ctx.args[0];
  if (!name) { fail('usage: skillmkt show <name> [--raw|--files|--audit]'); return 1; }
  const flags = ctx.flags.raw;

  // 受管 → hub；否则 external 中找
  let dir = path.join(ctx.hub, 'skills', name);
  let entry = ctx.library.skills?.[name] ?? null;
  let where = 'hub';
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) {
    const ext = scanAll(ctx.hub, ctx.harnesses, ctx.library, ctx.project?.root)
      .find((r) => r.name === name && r.state === 'external');
    if (!ext) { fail(`not found: ${name}`); return 1; }
    dir = ext.path; where = `${ext.where} (external)`;
  }
  const pkg = readSkillDir(dir);

  if (flags.raw) { console.log(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')); return 0; }
  if (flags.files) { pkg.files.forEach((f) => console.log(f)); return 0; }
  if (flags.audit) {
    const scan = readYAMLFile(path.join(ctx.hub, 'scans', `${name}.yml`), null);
    if (ctx.flags.json) { console.log(JSON.stringify(scan)); return 0; }
    if (!scan) { info('no scan record'); return 0; }
    info(`verdict: ${scan.verdict} @ ${scan.scanned_at}`);
    (scan.static?.findings || []).forEach((f) => info(`  ${f.rule} ${f.file}:${f.line}`));
    return 0;
  }

  const card = {
    name: pkg.name, version: pkg.version, description: pkg.meta.description || '',
    where, path: dir, files: pkg.fileCount,
    ...(entry ? { source: entry.source, targets: entry.targets, audit: entry.audit, installed_at: entry.installed_at } : {}),
  };
  if (ctx.flags.json) { console.log(JSON.stringify(card, null, 2)); return 0; }
  info(`${card.name}  v${card.version}`);
  info(`${card.description}`);
  info(`where: ${card.where} · ${card.path}`);
  info(`files: ${card.files}`);
  if (entry) {
    info(`source: ${entry.source?.registry} ${entry.source?.ref || ''}${entry.source?.path ? ` (${entry.source.path})` : ''}${entry.source?.adopted_from ? ` adopted_from ${entry.source.adopted_from}` : ''}`);
    info(`targets: ${(entry.targets || []).join(', ') || 'hub only'} · audit: ${entry.audit}`);
  }
  return 0;
}
