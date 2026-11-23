// audit.js — 静态审核闸门（无需模型）：scripts 剥离、密钥出口、外联指令、权限越权、PII 收割
import fs from 'node:fs';
import path from 'node:path';
import { walk } from './package.js';
import { writeYAMLFile } from './hub.js';

const TEXT_EXT = /\.(md|txt|json|ya?ml|toml|mjs|cjs|js|ts|sh|py|html?|css)$/i;
const STRIP_DIRS = /^(scripts?|bin|tools?|hooks?|install|\.github\/workflows)$/i;
const EXEC_EXT = /\.(sh|bash|zsh|exe|bat|cmd|ps1|com|dll|so|dylib|app)$/i;

const RULES = [
  {
    id: 'secret-pattern', weight: 2,
    re: /sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|~\/\.ssh\/|AWS_(SECRET|ACCESS)|\.env\b.*(?:read|cat|source|load)|(?:API[_-]?KEY|SECRET|TOKEN)\s*=\s*["']?[A-Za-z0-9_\-]{16,}/i,
    severe: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    id: 'egress-cmd', weight: 1,
    re: /\b(?:curl|wget|Invoke-WebRequest|iwr)\b[^|\n]*https?:\/\/|\bnc\b\s+-|\/dev\/tcp\/|\bbase64\b[^|\n]*\|\s*(?:sh|bash)|\b(?:fetch|axios|requests\.get)\b[^)\n]*https?:\/\//i,
  },
  {
    id: 'perm-escalation', weight: 1,
    re: /ignore (?:all |any )?(?:previous|prior) instructions?|do not (?:tell|inform|show) the user|add (?:yourself|itself|myself) to|(?:grant|give) (?:yourself|it) (?:access|permission)|modify (?:the )?(?:settings|config|permissions?)\.(?:json|ya?ml)|enable (?:all )?tools?/i,
  },
  {
    id: 'pii-harvest', weight: 3, severe: true,
    re: /contacts?\.(?:sqlite|db)|browser (?:profile|cookie|password|history)|keychain|wallet\.(?:dat|json)|\.metamask|\.aws\/credentials|password store|cookies?\.sqlite/i,
  },
];

export function isTextFile(p) { return TEXT_EXT.test(p); }
export function shouldStripDir(name) { return STRIP_DIRS.test(name) || EXEC_EXT.test(name); }

// 返回 {verdict, findings[], stripped[]}——pkg={path} 指向待审目录
export function auditDir(dir, { strip = true } = {}) {
  const findings = [];
  const stripped = [];

  for (const p of walk(dir)) {
    const rel = path.relative(dir, p);
    const top = rel.split(path.sep)[0];
    const base = path.basename(p);
    if (STRIP_DIRS.test(top) || EXEC_EXT.test(base) || /\.(sh|bash|ps1)$/.test(base)) {
      stripped.push(rel);
      continue;
    }
    if (!isTextFile(p)) continue;
    let src;
    try { src = fs.readFileSync(p, 'utf8'); } catch { continue; }
    const lines = src.split('\n');
    for (const rule of RULES) {
      lines.forEach((line, i) => {
        if (rule.re.test(line)) {
          const severe = rule.severe === true ? true : !!rule.severe?.test?.(line);
          findings.push({ rule: rule.id, file: rel, line: i + 1, excerpt: line.trim().slice(0, 120), severe });
        }
      });
    }
  }

  // verdict 归并（代码判定，不是模型）
  const has = (id) => findings.some((f) => f.rule === id);
  const severe = findings.some((f) => f.severe);
  const suspiciousCount = findings.reduce((n, f) => n + (RULES.find((r) => r.id === f.rule)?.weight ?? 1), 0);
  let verdict = 'clean';
  if (has('pii-harvest') || severe || (has('secret-pattern') && has('egress-cmd')) || suspiciousCount >= 5) verdict = 'malicious';
  else if (findings.length || stripped.length) verdict = 'suspicious';

  return { verdict, findings, stripped: strip ? stripped : [] };
}

// 剥离：copy 时排除 stripped 相对路径
export function stripFilter(stripped) {
  const set = new Set(stripped);
  const tops = new Set(stripped.map((r) => r.split('/')[0].split('\\')[0]));
  return (rel) => !set.has(rel) && !tops.has(rel.split('/')[0]);
}

export function writeScan(hub, name, result, { llm = null } = {}) {
  writeYAMLFile(path.join(hub, 'scans', `${name}.yml`), {
    name,
    scanned_at: new Date().toISOString(),
    static: { findings: result.findings, stripped: result.stripped },
    verdict: result.verdict,
    ...(llm ? { llm } : {}),
  });
}
