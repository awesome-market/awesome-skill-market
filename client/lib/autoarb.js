// autoarb.js — fresh-context 自动仲裁：confidence≥阈值 且 verdict≠human → 自动落 decision
// 返回 {auto, human, errors}；LLM 异常→errors（不阻塞，pending 原样留队）
import { arbitrate } from './ai.js';
import { decide } from './decide.js';
import { writeConflict } from './conflicts.js';
import { mapPool } from '../../pipeline/lib/util.js';

export async function autoArbitrate(hub, llm, conflicts, { minConfidence = 0.85, onProgress = null } = {}) {
  const out = { auto: 0, human: 0, errors: 0 };
  await mapPool(conflicts, async (c) => {
    let r;
    try { r = await arbitrate(llm, c); } catch { out.errors++; return; }
    onProgress?.(c, r);
    if (!r || !r.real) {                                    // 误判/解析失败→留 pending 给人
      if (r && !r.real) { c.status = 'dismissed'; c.dismiss_reason = r.explanation || 'llm: not a real conflict'; writeConflict(hub, c); out.auto++; }
      return;
    }
    if (r.verdict === 'human' || (Number(r.confidence) || 0) < minConfidence) { out.human++; return; }
    decide(hub, c, { resolution: r.verdict, custom: r.merged || null, reason: `auto-arbiter: ${r.explanation || r.verdict}`, by: 'auto-arbiter' });
    c.status = 'resolved';
    if (r.explanation) c.ai_explanation = r.explanation;
    writeConflict(hub, c);
    out.auto++;
  }, 2);
  return out;
}
