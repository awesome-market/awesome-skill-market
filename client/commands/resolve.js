// resolve [id] — 交互裁决队列：[a][b][m 合并][e $EDITOR 编合并][d 误报][s 跳过][q]
// 非 TTY → 只列出队列退出 3（安全默认不裁决）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { loadConflicts, writeConflict } from '../lib/conflicts.js';
import { decide } from '../lib/decide.js';
import { autoArbitrate } from '../lib/autoarb.js';
import { maybeHandoff } from '../lib/daemon.js';
import { ok, fail, info, warn } from '../lib/render.js';
import { L } from '../lib/i18n.js';

const edit = (seed) => {
  const f = path.join(os.tmpdir(), `skillmkt-merge-${Date.now()}.md`);
  fs.writeFileSync(f, seed);
  execFileSync(process.env.EDITOR || 'vi', [f], { stdio: 'inherit' });
  return fs.readFileSync(f, 'utf8').trim();
};

export async function run(ctx) {
  // TTY 默认接管到 Web 裁决（--cli 留在终端；--auto/--evidence 先跑 CLI 部分）
  if (!ctx.flags.raw.auto && !ctx.flags.raw.evidence && !ctx.flags.raw.cli && await maybeHandoff(ctx, '/#conflicts')) return 0;
  let queue = loadConflicts(ctx.hub, { pendingOnly: true });
  // --auto：fresh-context 仲裁先吃掉确定项，剩余真价值权衡留人
  if (ctx.flags.raw.auto) {
    if (!ctx.llm) { fail(L('--auto 需要 LLM（config.llm 或 OMLX_*）', '--auto needs an LLM (config.llm or OMLX_*)')); return 1; }
    const r = await autoArbitrate(ctx.hub, ctx.llm, queue, { onProgress: (c, x) => info(`${c.id}: ${x ? `${x.verdict}@${x.confidence}` : 'parse-fail'}`) });
    ok(`auto-arbiter: ${r.auto} ${L('已决', 'decided')}，${r.human} ${L('留人', 'left for you')}，${r.errors} ${L('错误', 'errors')}`);
    queue = loadConflicts(ctx.hub, { pendingOnly: true });
    if (!queue.length) return 0;
  }
  // --evidence：设计域 pending 生成 A/B 截图（playwright 缺失降级 text）
  if (ctx.flags.raw.evidence) {
    const { makeEvidence, isDesignDomain } = await import('../lib/evidence.js');
    for (const c of queue.filter((x) => isDesignDomain(x.domain))) {
      if (!ctx.llm) { warn(L('--evidence 需要 LLM', '--evidence needs an LLM')); break; }
      try { await makeEvidence(ctx.llm, ctx.hub, c); info(`${c.id}: evidence ${c.evidence}`); }
      catch (e) { warn(`${c.id}: evidence failed — ${e.message.slice(0, 60)}`); }
    }
  }
  const target = ctx.args[0] ? queue.filter((c) => c.id === ctx.args[0]) : queue;
  if (!target.length) { info(L('无 pending 冲突', 'no pending conflicts')); return 0; }
  if (!process.stdin.isTTY || ctx.flags.raw.cli === false) { info(L(`${target.length} pending（非 TTY 不裁决）— skillmkt resolve 终端交互 / --ui 网页`, `${target.length} pending (not resolved without a TTY) — run skillmkt resolve interactively, or the web UI`)); return 3; }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));
  let resolved = 0;
  for (const c of target) {
    console.log(`\n━━ ${c.id} [${c.domain}]`);
    console.log(`  A(${c.sides[0].source}): ${c.sides[0].text}`);
    console.log(`  B(${c.sides[1].source}): ${c.sides[1].text}`);
    for (;;) {
      const a = (await ask(L('  [a][b][m][e 编辑合并][d 误报][s 跳过][q] > ', '  [a][b][m][e dit merge][d ismiss][s kip][q] > '))).trim().toLowerCase();
      if (a === 'q') { rl.close(); return resolved ? 0 : 3; }
      if (a === 's') break;
      const res = { a: 'keep-a', b: 'keep-b', m: 'merge', e: 'merge', d: 'dismissed' }[a];
      if (!res) continue;
      let custom = null;
      if (a === 'm' || a === 'e') {
        custom = a === 'e' ? edit(`${c.sides[0].text}\n---\n${c.sides[1].text}\n`) : (await ask(L('  合并文本 > ', '  merged text > '))).trim();
        if (!custom) { info(L('空文本，跳过', 'empty text — skipped')); break; }
      }
      const reason = (await ask('  reason > ')).trim();
      if (!reason) { info(L('reason 必填', 'reason is required')); continue; }
      decide(ctx.hub, c, { resolution: res, custom, reason, by: process.env.USER || 'cli' });
      c.status = 'resolved';
      writeConflict(ctx.hub, c);
      resolved++;
      break;
    }
  }
  rl.close();
  ok(`resolved ${resolved}/${target.length}`);
  return 0;
}
