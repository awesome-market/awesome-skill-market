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

export const LLM_PROBES = [
  { port: 8001, name: 'OMLX' },
  { port: 11434, name: 'Ollama', probe: '/api/version' },
  { port: 1234, name: 'LM Studio' },
  { port: 8000, name: 'vLLM' },
  { port: 8080, name: 'mlx-lm/llama.cpp' },
  { port: 1337, name: 'Jan' },
  { port: 5000, name: 'text-gen-webui' },
];

// 仅 init/config 使用——并发扫端口，能回 /v1/models 即可用端点
export async function probeEndpoints(timeoutMs = 300) {
  const results = await Promise.allSettled(LLM_PROBES.map(async ({ port, name, probe }) => {
    const base = `http://localhost:${port}/v1`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/models`, { signal: ctrl.signal });
      if (!res.ok) return null;
      const data = await res.json();
      return { name, port, base_url: base, models: (data.data || []).map((m) => m.id) };
    } catch {
      if (probe) { /* ollama 等特征端点降级可日后补 */ }
      return null;
    } finally { clearTimeout(t); }
  }));
  return results.map((r) => r.value).filter(Boolean);
}
