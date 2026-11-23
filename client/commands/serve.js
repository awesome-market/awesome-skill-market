// serve — 本地 daemon：node:http + token + SSE + 静态 SPA；--daemon 内部模式 / --stop / --wait
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { daemonFile, readDaemon } from '../lib/daemon.js';
import { loadConflicts } from '../lib/conflicts.js';
import { loadDecisions, decide } from '../lib/decide.js';
import { readLibrary, readLock, readConfig, writeConfig, registerSkill, updateLock, ensureHub } from '../lib/hub.js';
import { readUpstream } from '../lib/state.js';
import { readYAML } from '../../pipeline/lib/util.js';
import { detectHarnesses } from '../lib/scanner.js';
import { probeEndpoints, chat, upsertEnvFile, resolveKeyRef } from '../lib/llm.js';
import { projectSkill, unproject, targetDirFor } from '../lib/project.js';
import { treeHash } from '../lib/package.js';
import { ok, info } from '../lib/render.js';

const PUB = path.join(new URL('.', import.meta.url).pathname, '../public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

// startServer — 可复用：serve 命令与 CLI 接管共用。返回 {port, token, server, emit, shutdown}
export async function startServer(ctx, { quiet = false, port = 0 } = {}) {
  ensureHub(ctx.hub);
  const flags = ctx.flags.raw;
  const token = crypto.randomBytes(16).toString('hex');
  const sse = new Set();
  const emit = (type, data) => { for (const res of sse) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
  let lastActive = Date.now();
  const idleMs = (ctx.config.daemon?.idle_minutes ?? 30) * 60e3;

  const harnesses = ctx.harnesses ?? detectHarnesses();   // bareRun/init 路径 ctx 可能没 withState
  const state = () => ({
    hub: ctx.hub,
    initialized: (() => { const r = readConfig(ctx.hub)._raw; return !!(r.ui || r.llm || r.default_targets); })(),
    library: readLibrary(ctx.hub), lock: readLock(ctx.hub),
    upstream: readUpstream(ctx.hub), conflicts: loadConflicts(ctx.hub),
    decisions: loadDecisions(ctx.hub), harnesses,
    scans: fs.existsSync(path.join(ctx.hub, 'scans'))
      ? fs.readdirSync(path.join(ctx.hub, 'scans')).sort().map((f) => readYAML(path.join(ctx.hub, 'scans', f))).filter(Boolean)
      : [],
  });

  const routes = {
    'GET /api/state': () => state(),
    'GET /api/conflicts': () => loadConflicts(ctx.hub),
    'GET /api/decisions': () => loadDecisions(ctx.hub),
    'GET /api/config': () => readConfig(ctx.hub)._raw,
    'GET /api/probe': async () => probeEndpoints(400, { extraBases: [readConfig(ctx.hub).llm?.base_url] }),
  };
  const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => r(b || '{}')); });

  const server = http.createServer(async (req, res) => {
    lastActive = Date.now();
    const t0 = Date.now();
    if (!quiet) res.on('finish', () => console.log(`  ${req.method} ${req.url.replace(/token=[^&\s]+/g, 'token=***')} → ${res.statusCode} ${Date.now() - t0}ms`));
    const u = new URL(req.url, 'http://x');
    // auth：Bearer header 或 ?token=（SSE/img 用 query，服务端不下发 cookie）
    const authed = req.headers.authorization === `Bearer ${token}` || u.searchParams.get('token') === token;
    if (u.pathname === '/api/events') {                       // SSE
      if (!authed) { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      sse.add(res);
      req.on('close', () => sse.delete(res));
      return;
    }
    if (u.pathname.startsWith('/api/')) {
      if (!authed) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"unauthorized"}'); }
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST') {
        let b;
        try { b = JSON.parse(await body(req)); }
        catch { res.writeHead(400); return res.end('{"error":"bad json"}'); }
        try {
          if (u.pathname === '/api/decide') {
            const c = loadConflicts(ctx.hub).find((x) => x.id === b.id);
            if (!c) { res.writeHead(404); return res.end('{"error":"not found"}'); }
            if (!b.reason?.trim()) { res.writeHead(400); return res.end('{"error":"reason required"}'); }
            decide(ctx.hub, c, { resolution: b.resolution, custom: b.custom || null, reason: b.reason, by: 'web-ui' });
            c.status = 'resolved';
            const { writeConflict } = await import('../lib/conflicts.js');
            writeConflict(ctx.hub, c);
            emit('decide', { id: c.id });
            return res.end('{"ok":true}');
          }
          if (u.pathname === '/api/config') {                         // init：合并写 config
            const raw = readConfig(ctx.hub)._raw;
            let keyEnv = false;
            if (b.llm !== undefined) {
              if (b.llm.api_key && !String(b.llm.api_key).startsWith('env:')) {
                upsertEnvFile(path.join(ctx.hub, '.env'), 'SKILLMKT_LLM_KEY', b.llm.api_key);
                b.llm.api_key = 'env:SKILLMKT_LLM_KEY';               // config.yml 只留引用
                keyEnv = true;
              }
              raw.llm = b.llm;
            }
            if (b.ui !== undefined) raw.ui = b.ui;
            if (b.default_targets !== undefined) raw.default_targets = b.default_targets;
            if (b.policy) raw.policy = b.policy;
            writeConfig(ctx.hub, raw);
            emit('config', {});
            return res.end(JSON.stringify({ ok: true, key_env: keyEnv }));
          }
          if (u.pathname === '/api/llm-smoke') {                      // init 冒烟
            const key = resolveKeyRef(b.api_key, ctx);                // env: 引用走 hub/.env 等解析链
            const r = await chat({ base_url: b.base_url, model: b.model, api_key: key, timeout_ms: 15000 }, { user: 'Reply with exactly: OK', maxTokens: 8 });
            return res.end(JSON.stringify({ ok: true, reply: r.trim().slice(0, 80) }));
          }
          if (u.pathname === '/api/targets') {                        // web 改投影目标
            const name = b.name, targets = b.targets || [];
            const lib = readLibrary(ctx.hub);
            const s = lib.skills?.[name];
            if (!s) { res.writeHead(404); return res.end('{"error":"not found"}'); }
            const dest = path.join(ctx.hub, 'skills', name);
            const lockTargets = {};
            // 取消勾选的目标：删掉已复制的副本（否则孤儿文件遗留且 drift 检不出）
            for (const t of s.targets || []) {
              if (targets.includes(t)) continue;
              const dir = targetDirFor(ctx, t, name);
              if (dir) unproject(name, dir);
            }
            for (const t of targets) {
              const dir = targetDirFor(ctx, t, name);
              if (!dir) continue;
              const r = projectSkill(dest, name, dir, { mode: 'copy' });
              lockTargets[t] = { hash: r.hash, projected_at: new Date().toISOString(), mode: 'copy' };
            }
            registerSkill(ctx.hub, name, { ...s, targets });
            updateLock(ctx.hub, name, treeHash(dest), lockTargets);
            emit('targets', { name });
            return res.end('{"ok":true}');
          }
        } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
        res.writeHead(404); return res.end('{"error":"not found"}');
      }
      const h = routes[`${req.method} ${u.pathname}`];
      if (h) {
        try { return res.end(JSON.stringify(await h())); }
        catch (e) { res.writeHead(500); return res.end(JSON.stringify({ error: e.message })); }
      }
      res.writeHead(404); return res.end('{"error":"not found"}');
    }
    // 静态：public/ 公开；/evidence/ 需鉴权且锁死在 hub/evidence 内（防 ../ 穿越读 config.yml 等）
    const p = u.pathname === '/' ? '/index.html' : u.pathname;
    let file;
    if (p.startsWith('/evidence/')) {
      if (!authed) { res.writeHead(401); return res.end(); }
      const evDir = path.join(ctx.hub, 'evidence');
      file = path.join(evDir, p.slice('/evidence/'.length));
      if (!path.resolve(file).startsWith(path.resolve(evDir))) { res.writeHead(403); return res.end(); }
    } else {
      file = path.join(PUB, p);
      if (!path.resolve(file).startsWith(PUB)) { res.writeHead(403); return res.end(); }
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });

  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const realPort = server.address().port;
  fs.writeFileSync(daemonFile(ctx.hub), JSON.stringify({ pid: process.pid, port: realPort, token, started: new Date().toISOString() }));
  const idle = setInterval(() => { if (Date.now() - lastActive > idleMs) { server.close(); process.exit(0); } }, 60e3);
  idle.unref();

  const shutdown = () => {
    clearInterval(idle);
    fs.rmSync(daemonFile(ctx.hub), { force: true });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 800).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { server, port: realPort, token, emit, shutdown };
}

export async function run(ctx) {
  const flags = ctx.flags.raw;
  if (flags.stop) {
    const d = readDaemon(ctx.hub);
    if (d) { try { process.kill(d.pid); } catch { /* dead */ } fs.rmSync(daemonFile(ctx.hub), { force: true }); ok('daemon stopped'); }
    else info('no daemon');
    return 0;
  }
  // 已有前台/分离实例在跑 → 不重复起，报地址
  const existing = readDaemon(ctx.hub);
  if (existing && existing.pid !== process.pid) {
    try { process.kill(existing.pid, 0); info(`已在跑: http://127.0.0.1:${existing.port}/?token=${existing.token}（--stop 停掉）`); return 0; } catch { /* stale */ }
  }
  const d = await startServer(ctx, { quiet: !!flags.daemon, port: flags.port || 0 });
  if (flags.daemon) { console.log(`daemon ready :${d.port}`); await new Promise(() => {}); }
  console.log(`serve: http://127.0.0.1:${d.port}/?token=${d.token}`);
  console.log(`  前台运行 — Ctrl-C 退出（idle ${ctx.config.daemon?.idle_minutes ?? 30}m 自退）`);
  await new Promise(() => {});
  return 0;
}
