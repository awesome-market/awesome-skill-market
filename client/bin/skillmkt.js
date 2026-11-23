#!/usr/bin/env node
// skillmkt — local-first agent skill manager
import { makeCtx, withState } from '../lib/ctx.js';
import { hubExists } from '../lib/hub.js';

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

async function bareRun(ctx) {
  if (!hubExists(ctx.hub)) {
    if (!ctx.tty) {
      console.error("run 'skillmkt init' to get started");
      process.exit(1);
    }
    const mod = await import('../commands/init.js');
    return mod.run(ctx);
  }
  const { renderDashboard } = await import('../lib/dashboard.js');
  return renderDashboard(ctx);
}

async function main() {
  const ctx = makeCtx(process.argv.slice(2));
  const [cmd, ...args] = ctx.positional;
  ctx.args = args;

  if (ctx.flags.raw.help || ctx.flags.raw.h) { console.log(HELP); process.exit(0); }
  if (ctx.flags.raw.version || ctx.flags.raw.V) {
    const pkg = (await import('../../package.json', { with: { type: 'json' } })).default;
    console.log(pkg.version);
    process.exit(0);
  }

  if (!cmd) return bareRun(ctx);

  const name = COMMANDS[cmd];
  if (!name) {
    console.error(`unknown command: ${cmd}\n\n${HELP}`);
    process.exit(1);
  }

  let mod;
  try {
    mod = await import(`../commands/${name}.js`);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') {
      console.error(`${name}: not implemented yet`);
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
