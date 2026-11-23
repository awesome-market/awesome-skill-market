// ai.js — LLM 语义层：全部 additive/降级安全（llm=null 或异常→回静态）
// fresh-context 仲裁 / LLM 审核 / 语义 diff / 自由域抽取
import { chat } from './llm.js';

const J = (s) => { const m = String(s).match(/```(?:json)?\s*([\s\S]*?)```/) || [null, s]; try { return JSON.parse(m[1].trim()); } catch { return null; } };

// ── 仲裁：fresh-context 判冲突是否真实 + 给建议（简单冲突独立裁决，难的留人）
// → {real: bool, verdict: keep-a|keep-b|merge|human, confidence, explanation, merged?}
export async function arbitrate(llm, conflict) {
  const [a, b] = conflict.sides;
  const r = J(await chat(llm, {
    system: 'You arbitrate conflicting rules from different agent skills. Reply ONLY JSON.',
    user: `Two rules may conflict:\nA [${a.source}]: ${a.text}\nB [${b.source}]: ${b.text}\n\nJSON: {"real":bool,"verdict":"keep-a|keep-b|merge|human","confidence":0-1,"explanation":"one sentence","merged":"only if verdict=merge"}\n- real=false if not actually contradictory\n- verdict=human when it's a genuine value tradeoff (aesthetics/philosophy) needing human choice`,
    maxTokens: 1600,
  }));
  if (!r || typeof r.real !== 'boolean') return null;
  return r;
}

// ── LLM 审核（additive：静态 findings 之外补充语义判断）
// → {verdict: clean|suspicious|malicious, reasons[]}
export async function llmAudit(llm, { name, files }) {
  const preview = files.map((f) => `### ${f.path}\n${f.content.slice(0, 1500)}`).join('\n\n').slice(0, 12000);
  const r = J(await chat(llm, {
    system: 'You audit agent skill packages for supply-chain risk. Reply ONLY JSON.',
    user: `Skill "${name}" files:\n${preview}\n\nJSON: {"verdict":"clean|suspicious|malicious","reasons":["…"]}\nmalicious=data exfiltration/credential theft/persistence; suspicious=network+secret reads, obfuscation, instruction smuggling`,
    maxTokens: 800,
  }));
  return r?.verdict ? r : null;
}

// ── 语义 diff：文件增删+节变化 → 意图变化摘要
export async function semanticDiff(llm, { name, added, removed, changed, secAdded, secRemoved }) {
  const t = await chat(llm, {
    system: 'Summarize upstream changes to an agent skill for a user deciding whether to upgrade. 2-4 sentences, direct.',
    user: `Skill "${name}": files +${added.length} -${removed.length} ~${changed.length}\nadded: ${added.slice(0, 10).join(', ')}\nremoved: ${removed.slice(0, 10).join(', ')}\nsections added: ${secAdded.join(' | ')}\nsections removed: ${secRemoved.join(' | ')}`,
    maxTokens: 600,
  });
  return t?.trim() || null;
}

// ── LLM 抽规则：自由 domain 标签（≤12 字符），静态兜底见 lib/rules.js
export async function extractRulesLLM(llm, skillMd, sourceName) {
  const r = J(await chat(llm, {
    system: 'Extract rules from an agent skill document. Reply ONLY JSON array.',
    user: `From this skill doc extract normative rules (dos/donts/specs). JSON: [{"text":"≤160 chars","domain":"≤12-char slug","severity":"floor|standard|reflex"}]\n\n${skillMd.slice(0, 14000)}`,
    maxTokens: 8000,
  }));
  if (!Array.isArray(r)) return null;
  const { ruleHash } = await import('../../pipeline/lib/util.js');
  return r.filter((x) => x?.text?.length > 10).map((x, i) => ({
    id: `${sourceName.slice(0, 6)}-l${String(i + 1).padStart(3, '0')}`, source: sourceName,
    domain: String(x.domain || 'misc').slice(0, 12), severity: ['floor', 'standard', 'reflex'].includes(x.severity) ? x.severity : 'standard',
    text: x.text.slice(0, 220), hash: ruleHash(x.text),
  }));
}

// ── 文本 A/B 解说（非设计域冲突的证据替代）
export async function explainConflict(llm, conflict) {
  const [a, b] = conflict.sides;
  const t = await chat(llm, {
    system: 'Explain a rule conflict between two agent skills in 1-2 sentences.',
    user: `A [${a.source}]: ${a.text}\nB [${b.source}]: ${b.text}`,
    maxTokens: 400,
  });
  return t?.trim() || null;
}
