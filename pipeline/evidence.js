#!/usr/bin/env node
// evidence.js — for pending conflicts: LLM writes A/B fixtures, Playwright renders screenshots
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './lib/env.js';
import { log, readYAML, writeYAML, listYAMLFiles } from './lib/util.js';
import { chatJSON } from './lib/llm.js';

const FIXTURE_SYSTEM = `You build minimal evidence fixtures for a UI-design rule dispute. Output ONE self-contained HTML file per option:

- Same fictional product, same layout scaffold in both files — the ONLY difference is the disputed rule being applied vs. not applied (or applied two different ways).
- The difference must be visible at a glance in a 1200x800 viewport screenshot.
- Inline <style> only, no external assets, no real brand names, no lorem ipsum — short plausible copy.
- Include a small caption bar fixed to the bottom-left: "OPTION A — <5-word description>" (same for B).
- Keep each file under 200 lines. Plain CSS, no JS unless the rule requires it.`;

const FIXTURE_SHAPE = `{"a_html":"<!doctype html>...","b_html":"<!doctype html>...","note":"what a viewer should look for"}`;

async function makeEvidence(conf) {
  const dir = path.join(DIRS.evidence, conf.id);
  fs.mkdirSync(dir, { recursive: true });
  const aHtml = path.join(dir, 'option-a.html');
  const bHtml = path.join(dir, 'option-b.html');

  if (!fs.existsSync(aHtml) || !fs.existsSync(bHtml)) {
    const [A, B] = conf.sides;
    const { a_html, b_html, note } = await chatJSON({
      label: `evidence:${conf.id}`,
      system: FIXTURE_SYSTEM,
      user: `Disputed rules:\nOPTION A (${A.source}): ${A.text}\nOPTION B (${B.source}): ${B.text}\n\nWhy they conflict: ${conf.ai_explanation}\n\nBuild the two fixtures.`,
      shapeDesc: FIXTURE_SHAPE,
      validate: (o) => (o?.a_html?.includes('<') && o?.b_html?.includes('<')) || 'missing html',
      maxTokens: 16000,
    });
    fs.writeFileSync(aHtml, a_html);
    fs.writeFileSync(bHtml, b_html);
    fs.writeFileSync(path.join(dir, 'note.txt'), note ?? '');
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    for (const [opt, file] of [['a', aHtml], ['b', bHtml]]) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce' });
      await page.goto(`file://${file}`);
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(dir, `option-${opt}.png`) });
      await page.close();
    }
    // mobile width for layout-sensitive disputes
    const page = await browser.newPage({ viewport: { width: 390, height: 700 }, reducedMotion: 'reduce' });
    for (const [opt, file] of [['a', aHtml], ['b', bHtml]]) {
      await page.goto(`file://${file}`);
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(dir, `option-${opt}-mobile.png`) });
    }
    await page.close();
  } finally {
    await browser.close();
  }
  return { dir, files: ['option-a.png', 'option-b.png', 'option-a-mobile.png', 'option-b-mobile.png'] };
}

export async function evidence() {
  const made = [];
  for (const f of listYAMLFiles(DIRS.conflicts)) {
    const conf = readYAML(f);
    if (conf.status !== 'pending') continue;
    if (conf.evidence !== 'screenshot') {
      log(`evidence: ${conf.id} type=${conf.evidence}, skip`);
      continue;
    }
    if (conf.evidence_files?.length && fs.existsSync(path.join(DIRS.evidence, conf.id, 'option-a.png'))) {
      continue; // already generated
    }
    try {
      const { files } = await makeEvidence(conf);
      conf.evidence_files = files;
      writeYAML(f, conf);
      made.push(conf.id);
      log(`evidence: ${conf.id} rendered`);
    } catch (e) {
      log(`evidence: ${conf.id} failed: ${e.message}`);
    }
  }
  return made;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await evidence();
}
