import { CFG } from './env.js';
import { log } from './util.js';

/** Extract the first balanced JSON object/array from model output. */
export function extractJSON(text) {
  const start = text.search(/[{[]/);
  if (start === -1) throw new Error('no JSON in output');
  const stack = [];
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
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      const want = c === '}' ? '{' : '[';
      if (stack.pop() !== want) throw new Error('unbalanced JSON in output');
      if (stack.length === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced JSON in output');
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
    try {
      const raw = await chat([{ role: 'system', content: sys }, { role: 'user', content: u }], { temperature, maxTokens, thinking });
      const obj = extractJSON(raw);
      const verr = validate?.(obj);
      if (verr === true || verr === undefined || verr === null) return obj;
      err = String(verr);
    } catch (e) {
      err = e.message;
    }
    log(`${label}: attempt ${attempt + 1} failed (${err})`);
  }
  throw new Error(`${label}: model failed 3 attempts (${err})`);
}
