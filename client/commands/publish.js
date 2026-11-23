// publish <name> --to <registry> — 二期适配器；一期友好报错（clawhub POST /skills）
import { fail } from '../lib/render.js';

export async function run(ctx) {
  const name = ctx.args[0];
  const to = ctx.flags.raw.to;
  if (!name || !to) { fail('usage: skillmkt publish <name> --to <registry>'); return 1; }
  fail(`publish: '${to}' adapter 未实现（二期：clawhub POST /api/v1/skills / 企业 registry）——当前可用 skillmkt pack ${name} 出包手动分发`);
  return 1;
}
