// resolve [id] — 交互裁决队列：[a][b][m 合并][e $EDITOR 编合并][d 误报][s 跳过][q]
// 非 TTY → 只列出队列退出 3（安全默认不裁决）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { loadConflicts, writeConflict } from '../lib/conflicts.js';
import { decide } from '../lib/decide.js';
import { ok, fail, info } from '../lib/render.js';

const edit = (seed) => {
  const f = path.join(os.tmpdir(), `skillmkt-merge-${Date.now()}.md`);
  fs.writeFileSync(f, seed);
  execFileSync(process.env.EDITOR || 'vi', [f], { stdio: 'inherit' });
  return fs.readFileSync(f, 'utf8').trim();
};

export async function run(ctx) {
  const queue = loadConflicts(ctx.hub, { pendingOnly: true });
  const target = ctx.args[0] ? queue.filter((c) => c.id === ctx.args[0]) : queue;
  if (!target.length) { info('无 pending 冲突'); return 0; }
  if (!process.stdin.isTTY || ctx.flags.raw.cli === false) { info(`${target.length} pending（非 TTY 不裁决）— skillmkt resolve 终端交互 / --ui 网页（M5）`); return 3; }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));
  let resolved = 0;
  for (const c of target) {
    console.log(`\n━━ ${c.id} [${c.domain}]`);
    console.log(`  A(${c.sides[0].source}): ${c.sides[0].text}`);
    console.log(`  B(${c.sides[1].source}): ${c.sides[1].text}`);
    for (;;) {
      const a = (await ask('  [a][b][m][e 编辑合并][d 误报][s 跳过][q] > ')).trim().toLowerCase();
      if (a === 'q') { rl.close(); return resolved ? 0 : 3; }
      if (a === 's') break;
      const res = { a: 'keep-a', b: 'keep-b', m: 'merge', e: 'merge', d: 'dismissed' }[a];
      if (!res) continue;
      let custom = null;
      if (a === 'm' || a === 'e') {
        custom = a === 'e' ? edit(`${c.sides[0].text}\n---\n${c.sides[1].text}\n`) : (await ask('  合并文本 > ')).trim();
        if (!custom) { info('空文本，跳过'); break; }
      }
      const reason = (await ask('  reason > ')).trim();
      if (!reason) { info('reason 必填'); continue; }
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
