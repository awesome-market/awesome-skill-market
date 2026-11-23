// llm.js — 端点解析链（flag > SKILLMKT_LLM_* > OMLX_* > config.llm > .env）
// 批次6 补：chatJSON 真调用、probeEndpoints、端口探测。铁律：非 init/config 零探测。
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv(cwd) {
  try {
    const out = {};
    for (const line of fs.readFileSync(path.join(cwd, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch { return {}; }
}

export function resolveLLM(ctx) {
  if (ctx.flags.noLlm) return null;
  const env = { ...loadDotEnv(ctx.cwd), ...process.env };
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

// 仅 init/config 使用——并发扫端口。/v1/models 通了即收录；
// 401/403 时用已知环境 key 重试，仍不通则标 needs_key 保留（别静默漏掉 oMLX 这类要 key 的本地服务）
export async function probeEndpoints(timeoutMs = 400) {
  const envKeys = ['SKILLMKT_LLM_API_KEY', 'OMLX_API_KEY'].map((v) => process.env[v]).filter(Boolean);
  const results = await Promise.allSettled(LLM_PROBES.map(async (port) => {
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
    const name = await identifyImpl(port, timeoutMs);
    if (!res.ok) return { name, port, base_url: base, models: [], needs_key: true };
    const data = await res.json();
    return { name, port, base_url: base, models: (data.data || []).map((m) => m.id) };
  }));
  return results.map((r) => r.value).filter(Boolean);
}
