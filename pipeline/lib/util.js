import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

export const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

export function readJSON(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function readYAML(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

export function writeYAML(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, YAML.stringify(data, { lineWidth: 0 }));
}

export const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

/** Normalize rule text for hashing/similarity: lowercase, collapse punctuation/space. */
export const normText = (s) =>
  String(s || '').toLowerCase().replace(/[`*_#>\-–—()[\]{}"',.;:!?/\\|]+/g, ' ').replace(/\s+/g, ' ').trim();

export const ruleHash = (text) => sha1(normText(text));

export function conflictFingerprint(sides) {
  return sha1(sides.map((s) => s.text).map((t) => t.toLowerCase().replace(/\s+/g, ' ').trim()).sort().join('\n---\n'));
}

export function* walk(dir, filter = () => true) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, filter);
    else if (filter(p)) yield p;
  }
}

export const listYAMLFiles = (dir) => [...walk(dir, (p) => /\.(ya?ml)$/.test(p))];

const STOP = new Set(('the a an and or of to in for on with without never always use when be is are not do does must should can will every each all any it its that this from by at as into no your you we they'.split(' ')));

export function tokens(text) {
  return new Set(normText(text).split(' ').filter((t) => t.length > 2 && !STOP.has(t)));
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const t of a) if (b.has(t)) i++;
  return i / (a.size + b.size - i);
}

export function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', ...opts }).trim?.() ?? '';
}

export function git(args, opts = {}) {
  return sh('git', ['-C', opts.cwd || process.cwd(), ...args], { quiet: true, ...opts });
}

export function gitDirty(cwd) {
  return git(['status', '--porcelain'], { cwd }).length > 0;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Run fn over items with at most `n` in flight. Results in input order. */
export async function mapPool(items, fn, n = 3) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

export function nextId(dir, prefix) {
  let max = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(new RegExp(`^${prefix}-(\\d+)`));
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}
