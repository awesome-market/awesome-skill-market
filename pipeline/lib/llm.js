import { CFG } from './env.js';
import { log } from './util.js';

/** Extract the first JSON object/array from model output. Salvages truncated output:
 * auto-closes dangling strings/brackets, and falls back to cutting at earlier comma
 * boundaries so a malformed tail element can't sink the whole response. */
export function extractJSON(text) {
  const start = text.search(/[{[]/);
  if (start === -1) throw new Error('no JSON in output');
  const stack = [];
  const commas = [];
  let inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) throw new Error(`unbalanced JSON at pos ${i}: ${JSON.stringify(text.slice(Math.max(0, i - 40), i + 40))}`);
      if (stack.length === 0) return JSON.parse(text.slice(start, i + 1));
    } else if (c === ',') commas.push(i);
  }
  // truncated or corrupted tail — build salvage candidates
  const closersFor = (s) => {
    const st = [];
    let str = false, e2 = false;
    for (const c of s) {
      if (str) { if (e2) e2 = false; else if (c === '\\') e2 = true; else if (c === '"') str = false; continue; }
      if (c === '"') str = true;
      else if (c === '{' || c === '[') st.push(c === '{' ? '}' : ']');
      else if (c === '}' || c === ']') st.pop();
    }
    return (str ? '"' : '') + st.reverse().join('');
  };
  const base = text.slice(start);
  const attempts = [base + closersFor(base)];
  for (let k = commas.length - 1; k >= 0 && attempts.length < 60; k--) {
    const pre = base.slice(0, commas[k] - start);
    attempts.push(pre + closersFor(pre));
  }
  for (const cand of attempts) {
    try { return JSON.parse(cand); } catch { /* next boundary */ }
  }
  throw new Error(`unclosed JSON (${stack.length} open) tail: ${JSON.stringify(text.slice(-120))}`);
}

async function chat(messages, { temperature = 0, maxTokens = 8192, thinking = false } = {}) {
  const body = {
    model: CFG.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (!thinking) body.chat_template_kwargs = { enable_thinking: false };
  const res = await fetch(`${CFG.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${CFG.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const choice = data.choices?.[0];
  const out = choice?.message?.content;
  if (!out) throw new Error(`empty LLM response (finish=${choice?.finish_reason ?? '?'})`);
  return out;
}

/**
 * Ask the model for a JSON object matching `shapeDesc` (shown in prompt).
 * Validates with `validate(obj)` -> true|string-error. Retries with the error fed back.
 */
export async function chatJSON({ system, user, shapeDesc, validate, temperature = 0, maxTokens = 8192, thinking = false, label = 'llm' }) {
  const sys = `${system}\n\nRespond with ONE JSON object only. No markdown fences, no commentary.\nShape:\n${shapeDesc}`;
  let err = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const u = attempt === 0 ? user : `${user}\n\nPrevious response was invalid: ${err}. Return corrected JSON only.`;
    let raw;
    try {
      raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: u }], { temperature, maxTokens, thinking });
      const obj = extractJSON(raw);
      const verr = validate?.(obj);
      if (verr === true || verr === undefined || verr === null) return obj;
      err = String(verr);
      raw = null; // validated objects are fine; only dump on parse errors
    } catch (e) {
      err = e.message;
      if (attempt === 2 && raw) {
        try {
          const { writeFileSync, mkdirSync } = await import('node:fs');
          const { join } = await import('node:path');
          const dir = join(process.cwd(), 'work');
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, `llm-raw-${label.replace(/[^\w-]/g, '_')}.txt`), raw);
        } catch { /* diagnostics are best-effort */ }
      }
    }
    log(`${label}: attempt ${attempt + 1} failed (${err})`);
  }
  throw new Error(`${label}: model failed 3 attempts (${err})`);
}
