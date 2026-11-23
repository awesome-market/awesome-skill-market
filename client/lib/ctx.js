// ctx.js — 全局 flag 解析 + 命令上下文构造
import { hubPath, readConfig, readLibrary, readLock, expandHome } from './hub.js';
import { detectHarnesses, detectProject } from './scanner.js';
import { resolveLLM } from './llm.js';

const VALUE_FLAGS = new Set(['hub', 'base-url', 'model', 'api-key-env', 'from', 'to', 'target', 'scope', 'path', 'registry', 'name', 'resolution', 'reason', 'custom', 'port', 'project', 'type', 'url', 'token', 'out', 'limit']);
const BOOL_FLAGS = new Set(['json', 'verbose', 'no-llm', 'dry-run', 'ui', 'cli', 'no-ui', 'yes', 'y', 'help', 'h', 'version', 'V', 'force', 'all', 'llm', 'semantic', 'raw', 'files', 'rules', 'audit-only', 'purge', 'link', 'remote', 'local', 'wait', 'stop', 'daemon', 'keep-scripts', 'report', 'check', 'once']);

export function parseArgv(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('-')) { positional.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq > 0 ? a.slice(0, eq) : a).replace(/^--?/, '');
    if (eq > 0) flags[camel(key)] = a.slice(eq + 1);
    else if (VALUE_FLAGS.has(key) && i + 1 < argv.length && !argv[i + 1].startsWith('-')) flags[camel(key)] = argv[++i];
    else flags[camel(key)] = true;
  }
  return { flags: normalizeFlags(flags), positional };
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function normalizeFlags(f) {
  return {
    json: !!f.json,
    hub: f.hub ? expandHome(f.hub) : null,
    verbose: !!f.verbose,
    noLlm: !!f.noLlm,
    dryRun: !!f.dryRun,
    ui: f.ui ? 'force' : (f.cli || f.noUi) ? 'off' : 'auto',
    yes: !!(f.yes || f.y),
    baseUrl: f.baseUrl || null,
    model: f.model || null,
    apiKeyEnv: f.apiKeyEnv || null,
    raw: f,
  };
}

export function makeCtx(argv, { wantProject = true } = {}) {
  const { flags, positional } = parseArgv(argv);
  const hub = hubPath(flags.hub);
  const config = readConfig(hub);
  const cwd = process.cwd();
  const ctx = {
    flags,
    positional,
    hub,
    config,
    llm: null,
    tty: !!process.stdout.isTTY,
    ci: !!process.env.CI,
    cwd,
    project: wantProject ? detectProject(cwd) : null,
  };
  ctx.llm = resolveLLM(ctx);
  return ctx;
}

export function withState(ctx) {
  ctx.library = readLibrary(ctx.hub);
  ctx.lock = readLock(ctx.hub);
  ctx.harnesses = detectHarnesses();
  return ctx;
}
