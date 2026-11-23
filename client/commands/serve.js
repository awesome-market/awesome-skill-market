// serve — 本地 daemon：node:http + token + SSE + 静态 SPA；--daemon 内部模式 / --stop / --wait
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { daemonFile, readDaemon } from '../lib/daemon.js';
import { loadConflicts } from '../lib/conflicts.js';
import { loadDecisions, decide } from '../lib/decide.js';
import { readLibrary, readLock } from '../lib/hub.js';
import { readUpstream } from '../lib/state.js';
import { readYAML } from '../../pipeline/lib/util.js';
import { scanAll } from '../lib/scanner.js';
import { ok, info, fail } from '../lib/render.js';

const PUB = path.join(new URL('.', import.meta.url).pathname, '../public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

export async function run(ctx) {
  const flags = ctx.flags.raw;
  if (flags.stop) {
    const d = readDaemon(ctx.hub);
    if (d) { try { process.kill(d.pid); } catch { /* dead */ } fs.rmSync(daemonFile(ctx.hub), { force: true }); ok('daemon stopped'); }
    else info('no daemon');
    return 0;
  }

  const token = crypto.randomBytes(16).toString('hex');
  const sse = new Set();
  const emit = (type, data) => { for (const res of sse) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
  let lastActive = Date.now();
  const idleMs = (ctx.config.daemon?.idle_minutes ?? 30) * 60e3;

  const state = () => ({
    hub: ctx.hub, library: readLibrary(ctx.hub), lock: readLock(ctx.hub),
    upstream: readUpstream(ctx.hub), conflicts: loadConflicts(ctx.hub),
    decisions: loadDecisions(ctx.hub), harnesses: ctx.harnesses,
    scans: fs.existsSync(path.join(ctx.hub, 'scans')) ? fs.readdirSync(path.join(ctx.hub, 'scans')).map((f) => readYAML(path.join(ctx.hub, 'scans', f))).filter(Boolean) : [],
    scans_all: scanAll(ctx.hub, ctx.harnesses, readLibrary(ctx.hub), ctx.cwd),
  });

  const routes = {
    'GET /api/state': () => state(),
    'GET /api/conflicts': () => loadConflicts(ctx.hub),
    'GET /api/decisions': () => loadDecisions(ctx.hub),
  };

  const server = http.createServer(async (req, res) => {
    lastActive = Date.now();
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
      if (req.method === 'POST' && u.pathname === '/api/decide') {
        const body = JSON.parse(await new Promise((r) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => r(b || '{}')); }));
        const c = loadConflicts(ctx.hub).find((x) => x.id === body.id);
        if (!c) { res.writeHead(404); return res.end('{"error":"not found"}'); }
        try {
          decide(ctx.hub, c, { resolution: body.resolution, custom: body.custom || null, reason: body.reason || 'web decision', by: 'web-ui' });
          c.status = 'resolved';
          const { writeConflict } = await import('../lib/conflicts.js');
          writeConflict(ctx.hub, c);
          emit('decide', { id: c.id });
          return res.end('{"ok":true}');
        } catch (e) { res.writeHead(400); return res.end(JSON.stringify({ error: e.message })); }
      }
      const h = routes[`${req.method} ${u.pathname}`];
      if (h) return res.end(JSON.stringify(h()));
      res.writeHead(404); return res.end('{"error":"not found"}');
    }
    // 静态：public/ + evidence 文件（冲突截图）
    let p = u.pathname === '/' ? '/index.html' : u.pathname;
    let file = path.join(PUB, p);
    if (p.startsWith('/evidence/')) file = path.join(ctx.hub, p);
    if (!file.startsWith(PUB) && !file.startsWith(ctx.hub)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });

  await new Promise((r) => server.listen(flags.port || 0, '127.0.0.1', r));
  const port = server.address().port;
  fs.writeFileSync(daemonFile(ctx.hub), JSON.stringify({ pid: process.pid, port, token, started: new Date().toISOString() }));
  const idle = setInterval(() => { if (Date.now() - lastActive > idleMs) { server.close(); process.exit(0); } }, 60e3);
  idle.unref();
  if (flags.daemon) { console.log(`daemon ready :${port}`); await new Promise(() => {}); }
  console.log(`serve: http://127.0.0.1:${port}?token=${token}（idle ${ctx.config.daemon?.idle_minutes ?? 30}m 自退；--stop 停止）`);
  if (flags.wait !== false && !flags.daemon) await new Promise(() => {});
  return 0;
}
