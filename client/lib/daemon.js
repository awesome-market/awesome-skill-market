// daemon.js — 单例守护：daemon.json{pid,port,token,started} + spawn + openURL
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

export const daemonFile = (hub) => path.join(hub, 'daemon.json');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export function readDaemon(hub) {
  try { return JSON.parse(fs.readFileSync(daemonFile(hub), 'utf8')); } catch { return null; }
}

export async function ensureDaemon(ctx) {
  const d = readDaemon(ctx.hub);
  if (d && alive(d.pid)) return d;
  const bin = path.join(new URL('.', import.meta.url).pathname, '../bin/skillmkt.js');
  const child = spawn(process.execPath, [bin, 'serve', '--daemon'], {
    env: { ...process.env, SKILLMKT_HOME: ctx.hub },
    detached: true, stdio: 'ignore',
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const nd = readDaemon(ctx.hub);
    if (nd && alive(nd.pid)) return nd;
  }
  throw new Error('daemon 启动超时');
}

export function openURL(d, route = '/') {
  // token 必须进 ?search（location.search 可读）；#fragment 只带 tab 名
  const frag = route.includes('#') ? `#${route.split('#')[1]}` : '';
  const url = `http://127.0.0.1:${d.port}/?token=${d.token}${frag}`;
  try { execFileSync('open', [url]); } catch { /* linux: xdg-open */ try { execFileSync('xdg-open', [url]); } catch { /* noop */ } }
  return url;
}

// CLI 自动接管：TTY + 未禁 ui + daemon 可用 → 开浏览器返回 true；否则 false 走终端
export async function maybeHandoff(ctx, route = '/') {
  if (!process.stdout.isTTY || ctx.flags.raw.cli || ctx.flags.raw.noUi) return false;
  if (ctx.flags.raw.ui === false) return false;
  try {
    const d = await ensureDaemon(ctx);
    const url = openURL(d, route);
    console.log(`opened ${url}`);
    return true;
  } catch { return false; }
}
