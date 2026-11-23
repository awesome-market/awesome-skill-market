// audit [name|--all] — 重跑静态审核刷新 scans/；--llm 附加语义审（批次6 全量）
import path from 'node:path';
import fs from 'node:fs';
import { auditDir, writeScan } from '../lib/audit.js';
import { ok, warn, fail, info } from '../lib/render.js';

export async function run(ctx) {
  const flags = ctx.flags.raw;
  const skills = ctx.library.skills || {};
  const names = flags.all ? Object.keys(skills) : ctx.args;
  if (!names.length) { fail('usage: skillmkt audit <name|--all> [--llm]'); return 1; }
  let worst = 'clean';
  const order = { clean: 0, suspicious: 1, stripped: 1, malicious: 2 };
  for (const name of names) {
    const dir = path.join(ctx.hub, 'skills', name);
    if (!fs.existsSync(dir)) { warn(`未受管: ${name}`); continue; }
    const r = auditDir(dir, { strip: false });
    writeScan(ctx.hub, name, r);
    if (order[r.verdict] > order[worst]) worst = r.verdict;
    info(`${name}: ${r.verdict}${r.findings.length ? ` (${r.findings.length} findings)` : ''}`);
  }
  ok('audit done');
  return worst === 'malicious' ? 2 : 0;
}
