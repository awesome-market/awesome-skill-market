// llm.js — 端点解析链（flag > SKILLMKT_LLM_* > OMLX_* > config.llm > .env）
// 批次6 补：chatJSON 真调用、probeEndpoints、端口探测。铁律：非 init/config 零探测。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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

// upsert KEY=value 到 env 文件（600 权限）——web 保存明文密钥时落到 hub/.env，config.yml 只留 env: 引用
export function upsertEnvFile(file, key, value) {
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { /* 新文件 */ }
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const entry = `${key}=${value}`;
  if (idx >= 0) lines[idx] = entry; else lines.push(entry);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.filter(Boolean).join('\n') + '\n', { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* windows 无 mode */ }
}

// "env:VAR" → 真值（hub/.env + cwd/.env + 环境变量）；裸值原样返回
export function resolveKeyRef(keyRef, ctx) {
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
  // 解析链：hub/.env < cwd/.env < 真环境变量（后者覆盖前者）
  const env = { ...(ctx.hub ? loadDotEnv(path.join(ctx.hub, '.env')) : {}), ...loadDotEnv(path.join(ctx.cwd, '.env')), ...process.env };
  const cfg = ctx.config.llm || {};
  const base = ctx.flags.baseUrl || env.SKILLMKT_LLM_BASE_URL || env.OMLX_BASE_URL || cfg.base_url;
  const model = ctx.flags.model || env.SKILLMKT_LLM_MODEL || env.OMLX_MODEL || cfg.model;
  const keyRef = ctx.flags.apiKeyEnv || env.SKILLMKT_LLM_API_KEY || env.OMLX_API_KEY || cfg.api_key;
  if (!base || !model) return null;
  // api_key 形如 "env:VAR" → 取环境变量；裸值（不建议）原样用
  const key = keyRef?.startsWith('env:') ? env[keyRef.slice(4)] : keyRef;
  return {
    base_url: base.replace(/\/+$/, ''),
    model,
    api_key: key || '',
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
    return data.choices?.[0]?.message?.content ?? '';
  } finally { clearTimeout(t); }
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
  return 'OpenAI 兼容服务';
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
