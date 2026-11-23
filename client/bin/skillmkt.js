#!/usr/bin/env node
// skillmkt — local-first agent skill manager
import { makeCtx, withState, KNOWN_FLAGS } from '../lib/ctx.js';
import { hubExists, isInitialized } from '../lib/hub.js';
import { L } from '../lib/i18n.js';

const COMMANDS = {
  init: 'init', config: 'config', doctor: 'doctor',
  search: 'search', find: 'search', f: 'search', s: 'search',
  list: 'list', ls: 'list',
  show: 'show', view: 'show', info: 'show',
  install: 'install', i: 'install', add: 'install',
  remove: 'remove', uninstall: 'remove', un: 'remove', rm: 'remove',
  targets: 'targets', sync: 'sync', audit: 'audit',
  update: 'update', outdated: 'outdated', upgrade: 'upgrade',
  download: 'download', diff: 'diff', rollback: 'rollback',
  conflicts: 'conflicts', resolve: 'resolve', decide: 'decide',
  merge: 'merge', build: 'build',
  pack: 'pack', publish: 'publish', registry: 'registry', serve: 'serve',
};

const HELP = `skillmkt — local-first agent skill manager

usage: skillmkt <cmd> [args] [--json] [--hub <path>] [--dry-run] [--ui|--cli]

core:    init  config  doctor  search  list  show  install  remove  targets  sync
version: update  outdated  upgrade  download  diff  rollback
merge:   conflicts  resolve  decide  merge  build
dist:    audit  pack  publish  registry  serve

bare run = dashboard. docs: docs/CLI.md`;

const HELP_ZH = `skillmkt — 本地优先的 agent skill 管理器

用法: skillmkt <命令> [参数] [--json] [--hub <路径>] [--dry-run] [--ui|--cli]

核心:    init  config  doctor  search  list  show  install  remove  targets  sync
版本:    update  outdated  upgrade  download  diff  rollback
合并:    conflicts  resolve  decide  merge  build
分发:    audit  pack  publish  registry  serve

裸跑 = 仪表盘。文档: docs/CLI.md`;

async function bareRun(ctx) {
  if (!hubExists(ctx.hub) || !isInitialized(ctx.hub)) {
    if (!ctx.tty) {
      console.error(L("请先运行 'skillmkt init' 完成初始化", "run 'skillmkt init' to get started"));
      process.exit(1);
    }
    const mod = await import('../commands/init.js');
    withState(ctx);
    return mod.run(ctx);
  }
  const { renderDashboard } = await import('../lib/dashboard.js');
  withState(ctx);
  return renderDashboard(ctx);
}

async function main() {
  const ctx = makeCtx(process.argv.slice(2));
  const [cmd, ...args] = ctx.positional;
  ctx.args = args;

  // 打错的 flag 不静默吞——警告后继续（不硬失败，防误伤前向兼容）
  const kebab = (s) => s.replace(/([A-Z])/g, (_, c) => `-${c.toLowerCase()}`);
  for (const k of Object.keys(ctx.flags.raw)) {
    if (!KNOWN_FLAGS.has(k)) console.error(`${L('⚠ 未知 flag，已忽略', 'warning: unknown flag ignored')}: --${kebab(k)}`);
  }

  if (ctx.flags.raw.help || ctx.flags.raw.h) { console.log(L(HELP_ZH, HELP)); process.exit(0); }
  if (ctx.flags.raw.version || ctx.flags.raw.V) {
    const pkg = (await import('../../package.json', { with: { type: 'json' } })).default;
    console.log(pkg.version);
    process.exit(0);
  }

  if (!cmd) return bareRun(ctx);

  const name = COMMANDS[cmd];
  if (!name) {
    console.error(`${L('未知命令', 'unknown command')}: ${cmd}\n\n${L(HELP_ZH, HELP)}`);
    process.exit(1);
  }

  let mod;
  try {
    mod = await import(`../commands/${name}.js`);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') {
      console.error(`${name}: ${L('还没实现', 'not implemented yet')}`);
      process.exit(1);
    }
    throw e;
  }
  withState(ctx);
  const code = await mod.run(ctx);
  process.exit(typeof code === 'number' ? code : 0);
}

main().catch((e) => {
  console.error(`skillmkt: ${e.message}`);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
