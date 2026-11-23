// evidence.js — 设计域冲突的可视证据：LLM 写 A/B fixture → playwright 截图
// 非设计域走 text A/B + ai_explanation（conflicts.js 默认 evidence:'text'）
// playwright 缺失/渲染同图 → inconclusive.txt 标记，不阻塞队列
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chat } from './llm.js';
import { writeConflict } from './conflicts.js';

const DESIGN_DOMAINS = new Set(['design', 'ui', 'ux', 'css', 'layout', 'color', 'motion', 'type', 'typography', 'frontend', 'a11y', 'visual', 'style', 'imagery']);
export const isDesignDomain = (d) => [...String(d || '').split(/[×x]/i)].some((x) => DESIGN_DOMAINS.has(x.trim()));
const evidenceDir = (hub, id) => path.join(hub, 'evidence', id);

const SYS = `You build minimal evidence fixtures for a UI-design rule dispute. Output ONE self-contained HTML per option: same fictional product & layout scaffold, ONLY the disputed rule applied differently. Difference visible at a glance in 1200x800 static screenshot (motion/hover → show triggered state or before/after pair). Inline <style> only, no external assets, short plausible copy. Caption bar bottom-left: "OPTION A — <5 words>". <200 lines. Reply ONLY JSON {"a_html":"…","b_html":"…","note":"what to look for"}`;

export async function makeEvidence(llm, hub, conflict) {
  const dir = evidenceDir(hub, conflict.id);
  fs.mkdirSync(dir, { recursive: true });
  const [A, B] = conflict.sides;
  const m = String(await chat(llm, {
    system: SYS,
    user: `OPTION A (${A.source}): ${A.text}\nOPTION B (${B.source}): ${B.text}\n${conflict.ai_explanation ? `Why they conflict: ${conflict.ai_explanation}` : ''}`,
    maxTokens: 12000,
  })).match(/```(?:json)?\s*([\s\S]*?)```/) || [];
  const o = JSON.parse((m[1] || '{}').trim() || '{}');
  if (!o.a_html?.includes('<') || !o.b_html?.includes('<')) throw new Error('fixture gen failed');
  fs.writeFileSync(path.join(dir, 'option-a.html'), o.a_html);
  fs.writeFileSync(path.join(dir, 'option-b.html'), o.b_html);
  fs.writeFileSync(path.join(dir, 'note.txt'), o.note || '');

  const files = [];
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    for (const opt of ['a', 'b']) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      await page.goto(`file://${path.join(dir, `option-${opt}.html`)}`);
      const png = path.join(dir, `option-${opt}.png`);
      await page.screenshot({ path: png });
      files.push(`option-${opt}.png`, `option-${opt}.html`);
      await page.close();
    }
    await browser.close();
    // 同图=证据无效
    const ha = crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, 'option-a.png'))).digest('hex');
    const hb = crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, 'option-b.png'))).digest('hex');
    if (ha === hb) { fs.writeFileSync(path.join(dir, 'inconclusive.txt'), 'A/B rendered identically'); }
    conflict.evidence = 'screenshot';
    conflict.evidence_files = files;
  } catch {
    conflict.evidence = 'text';   // playwright 未装 → 降级文本证据
    conflict.evidence_files = ['option-a.html', 'option-b.html'];
  }
  writeConflict(hub, conflict);
  return conflict;
}
