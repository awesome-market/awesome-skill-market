// audit.js — 静态审核闸门（无需模型）：scripts 剥离、密钥出口、外联指令、权限越权、PII 收割
import fs from 'node:fs';
import path from 'node:path';
import { walk } from './package.js';
import { writeYAMLFile } from './hub.js';

const TEXT_EXT = /\.(md|txt|json|ya?ml|toml|mjs|cjs|js|ts|sh|py|html?|css)$/i;
const DOC_EXT = /\.(md|markdown|txt|rst|adoc)$/i;
// 文档语境豁免只对"下载型"curl 生效——真危险的是这些（管道执行/反弹shell/编码绕过）
const EGRESS_DANGER = /\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\bnc\b\s+-|\/dev\/tcp\/|\bbase64\b/i;
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

// 人读的剥离摘要：按原因分组 → [{key:'dir:<顶层目录>'|'exec', files[]}]
export function stripSummary(stripped) {
  const groups = new Map();
  for (const rel of stripped) {
    const top = rel.split('/')[0];
    const key = STRIP_DIRS.test(top) ? `dir:${top}` : 'exec';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rel);
  }
  return [...groups.entries()].map(([key, files]) => ({ key, files }));
}

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
          // 文档里的"下载型"curl 降级为 doc——记录但不单独定罪（维护说明/用户手册常见）
          const doc = rule.id === 'egress-cmd' && DOC_EXT.test(base) && !EGRESS_DANGER.test(line);
          findings.push({ rule: rule.id, file: rel, line: i + 1, excerpt: line.trim().slice(0, 120), severe, ...(doc ? { doc: true } : {}) });
        }
      });
    }
  }

  const kept = strip ? stripped : [];   // strip:false(--keep-scripts)=用户已选择连脚本装——verdict 不该再拿剥离表定罪
  return { verdict: verdictOf(findings, kept), findings, stripped: kept };
}

// verdict 归并（代码判定，不是模型）。doc=文档语境误报，allowed=用户人工豁免——都不定罪但仍记录
export function verdictOf(findings, stripped = []) {
  const live = findings.filter((f) => !f.doc && !f.allowed);
  const has = (id) => live.some((f) => f.rule === id);
  const severe = live.some((f) => f.severe);
  const suspiciousCount = live.reduce((n, f) => n + (RULES.find((r) => r.id === f.rule)?.weight ?? 1), 0);
  if (has('pii-harvest') || severe || (has('secret-pattern') && has('egress-cmd')) || suspiciousCount >= 5) return 'malicious';
  if (live.length || stripped.length) return 'suspicious';
  return 'clean';
}

export const RULE_IDS = RULES.map((r) => r.id);

// 剥离：copy 时排除 stripped 相对路径
export function stripFilter(stripped) {
  const set = new Set(stripped);
  const tops = new Set(stripped.map((r) => r.split('/')[0].split('\\')[0]));
  return (rel) => !set.has(rel) && !tops.has(rel.split('/')[0]);
}

export function writeScan(hub, name, result, { llm = null, allow = [] } = {}) {
  writeYAMLFile(path.join(hub, 'scans', `${name}.yml`), {
    name,
    scanned_at: new Date().toISOString(),
    static: { findings: result.findings, stripped: result.stripped },
    verdict: result.verdict,
    ...(allow.length ? { allow } : {}),
    ...(llm ? { llm } : {}),
  });
}
