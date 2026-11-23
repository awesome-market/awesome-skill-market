// llm.js — 端点解析链（flag > SKILLMKT_LLM_* > OMLX_* > config.llm > .env）
// 批次6 补：chatJSON 真调用、probeEndpoints、端口探测。铁律：非 init/config 零探测。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { L } from './i18n.js';

function loadDotEnv(file) {
  try {
    const out = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch { return {}; }
}

// 机器码绑定密钥加密：config.yml 只存 enc:v1: 密文，文件离开本机解不开
let _machineId = null;
function machineId() {
  if (_machineId !== null) return _machineId;
  try {
    if (process.platform === 'darwin') {
      _machineId = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 3000 })
        .match(/"IOPlatformUUID" = "([0-9A-F-]+)"/)?.[1];
    } else if (process.platform === 'linux') {
      _machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim() || fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
    } else if (process.platform === 'win32') {
      _machineId = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8' })
        .match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1];
    }
  } catch { /* 走兜底 */ }
  if (!_machineId) _machineId = `${os.hostname()}:${os.userInfo().username}`;
  return _machineId;
}

const encKey = () => crypto.scryptSync(`skillmkt:${machineId()}`, 'skillmkt-secret-v1', 32);

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(payload) {
  const m = String(payload ?? '').match(/^enc:v1:([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(m[1], 'base64'));
    d.setAuthTag(Buffer.from(m[2], 'base64'));
    return Buffer.concat([d.update(Buffer.from(m[3], 'base64')), d.final()]).toString('utf8');
  } catch { return null; }        // 别的机器/篡改 → 解不开
}

// "env:VAR" → 真值（hub/.env + cwd/.env + 环境变量）；"enc:v1:…" → 本机解密；裸值原样返回
export function resolveKeyRef(keyRef, ctx) {
  if (keyRef?.startsWith('enc:')) return decryptSecret(keyRef) ?? '';
  if (!keyRef?.startsWith('env:')) return keyRef || '';
  const v = keyRef.slice(4);
  const env = {
    ...(ctx?.hub ? loadDotEnv(path.join(ctx.hub, '.env')) : {}),
    ...loadDotEnv(path.join(ctx?.cwd ?? '.', '.env')),
    ...process.env,
  };
  return env[v] ?? '';
}

export function resolveLLM(ctx) {
  if (ctx.flags.noLlm) return null;
  // 取值优先级：flag > 真环境变量 > cwd/.env > hub/.env > config.llm（via 记来源供展示）
  const envHub = ctx.hub ? loadDotEnv(path.join(ctx.hub, '.env')) : {};
  const envCwd = loadDotEnv(path.join(ctx.cwd, '.env'));
  const env = { ...envHub, ...envCwd, ...process.env };
  const cfg = ctx.config.llm || {};
  const pick = (flagV, names, cfgV) => {
    if (flagV) return [flagV, 'flag'];
    for (const n of names) {
      if (process.env[n]) return [process.env[n], `env ${n}`];
      if (envCwd[n]) return [envCwd[n], `${n}（cwd/.env）`];
      if (envHub[n]) return [envHub[n], `${n}（hub/.env）`];
    }
    return [cfgV, 'config'];
  };
  const [base, via] = pick(ctx.flags.baseUrl, ['SKILLMKT_LLM_BASE_URL', 'OMLX_BASE_URL'], cfg.base_url);
  const [model] = pick(ctx.flags.model, ['SKILLMKT_LLM_MODEL', 'OMLX_MODEL'], cfg.model);
  const [keyRef] = pick(ctx.flags.apiKeyEnv, ['SKILLMKT_LLM_API_KEY', 'OMLX_API_KEY'], cfg.api_key);
  if (!base || !model) return null;
  // api_key："env:VAR"→环境变量；"enc:v1:…"→本机解密；裸值（不建议）原样用
  const key = keyRef?.startsWith('env:') ? env[keyRef.slice(4)] : keyRef?.startsWith('enc:') ? decryptSecret(keyRef) : keyRef;
  return {
    base_url: base.replace(/\/+$/, ''),
    model,
    api_key: key || '',
    via: via === 'config' ? null : via,
    concurrency: +(cfg.concurrency ?? 2),
    timeout_ms: +(cfg.timeout_ms ?? 60000),
  };
}

// OpenAI 兼容 chat——返回文本内容或抛错（init 冒烟 + 后续 LLM 功能复用）
export async function chat(llm, { system = '', user, maxTokens = 64, temperature = 0 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), llm.timeout_ms);
  try {
    const res = await fetch(`${llm.base_url}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(llm.api_key ? { authorization: `Bearer ${llm.api_key}` } : {}) },
      body: JSON.stringify({
        model: llm.model,
        temperature,
        max_tokens: maxTokens,
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    llm.tokens = (llm.tokens || 0) + (data.usage?.total_tokens || 0);   // 累计消费量——进度条/日志用
    const msg = data.choices?.[0]?.message;
    return msg?.content ?? msg?.reasoning_content ?? '';   // 思考型模型可能只回 reasoning_content
  } finally { clearTimeout(t); }
}

// OpenAI 兼容 /models 列表（指定端点+密钥）——web 与 init 向导共用
export async function listModels(baseUrl, apiKey = '') {
  const r = await fetch(`${String(baseUrl || '').replace(/\/+$/, '')}/models`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`http ${r.status}`);
  const d = await r.json();
  return (d.data || []).map((m) => m.id);
}

export const LLM_PROBES = [8001, 11434, 1234, 8000, 8080, 1337, 5000];

// 本机所有 LISTEN 端口（lsof）——模型服务换任意端口都能被扫到；拿不到就只用固定列表
function listeningPorts() {
  try {
    const out = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 4000 });
    const ports = new Set();
    for (const line of out.split('\n')) {
      const m = line.match(/(?:127\.0\.0\.1|localhost|\*|\[?::1\]?):(\d+)/i);
      if (m) ports.add(+m[1]);
    }
    return [...ports];
  } catch { return []; }
}

const portOf = (base) => { try { return +(new URL(base).port || 0) || null; } catch { return null; } };

// 识别服务实现——有特征端点才冠名，认不出如实标"OpenAI 兼容服务"（oMLX 跑在 1234 时不该叫 LM Studio）
async function identifyImpl(port, timeoutMs) {
  const get = async (p) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try { const r = await fetch(`http://localhost:${port}${p}`, { signal: ctrl.signal }); return r.ok ? await r.json() : null; }
    catch { return null; } finally { clearTimeout(t); }
  };
  if ((await get('/api/version'))?.version) return 'Ollama';      // Ollama 原生 API
  if (await get('/api/v0/models')) return 'LM Studio API';        // 说 LM Studio 协议——也可能是 oMLX 等兼容实现
  return L('OpenAI 兼容服务', 'OpenAI-compatible service');
}

// 仅 init/config 使用——候选端口 = 常见端口 ∪ 本机全部监听端口 ∪ env/config 已知 base_url 端口，
// 并发试 /v1/models。响应里 data 不是数组则不算 LLM 端点（防止 dev server 等返回 200 被误收录）；
// 401/403 时用已知环境 key 重试，仍不通则标 needs_key 保留（别静默漏掉 oMLX 这类要 key 的本地服务）
export async function probeEndpoints(timeoutMs = 400, { extraBases = [] } = {}) {
  const candidates = new Set(LLM_PROBES);
  for (const p of listeningPorts()) candidates.add(p);
  for (const v of ['SKILLMKT_LLM_BASE_URL', 'OMLX_BASE_URL']) { const p = portOf(process.env[v]); if (p) candidates.add(p); }
  for (const b of extraBases) { const p = portOf(b); if (p) candidates.add(p); }
  const envKeys = ['SKILLMKT_LLM_API_KEY', 'OMLX_API_KEY'].map((v) => process.env[v]).filter(Boolean);
  const results = await Promise.allSettled([...candidates].map(async (port) => {
    const base = `http://localhost:${port}/v1`;
    const tryModels = async (key) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch(`${base}/models`, {
          signal: ctrl.signal,
          headers: key ? { authorization: `Bearer ${key}` } : {},
        });
      } catch { return null; } finally { clearTimeout(t); }
    };
    let res = await tryModels(null);
    if (!res) return null;
    if (res.status === 401 || res.status === 403) {
      for (const k of envKeys) { res = await tryModels(k); if (res?.ok) break; }
    }
    if (!res.ok) {
      // 只有 OpenAI 风格错误体（{"error":{...}}）才算"要 key 的 LLM 端点"——普通鉴权服务不误报
      const err = await res.json().catch(() => null);
      if (!err?.error) return null;
      const name = await identifyImpl(port, timeoutMs);
      return { name, port, base_url: base, models: [], needs_key: true };
    }
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data?.data)) return null;          // 200 但不是 OpenAI models 响应 → 非 LLM 端点
    const name = await identifyImpl(port, timeoutMs);
    return { name, port, base_url: base, models: data.data.map((m) => m.id) };
  }));
  return results.map((r) => r.value).filter(Boolean);
}
