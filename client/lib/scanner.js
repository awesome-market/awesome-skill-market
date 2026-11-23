// scanner.js — harness 探测矩阵（每次运行活探）+ skill 目录扫描 + external 发现
import fs from 'node:fs';
import path from 'node:path';
import { expandHome } from './hub.js';
import { readSkillDir } from './package.js';

// §5 探测表——新增 harness = 加一行
export const HARNESSES = [
  { id: 'claude',   bins: ['claude'],   envs: ['CLAUDE_CONFIG_DIR'],
    dirs: ['~/.claude/skills'], projectDirs: ['.claude/skills'] },
  { id: 'codex',    bins: ['codex'],    envs: ['CODEX_HOME'],
    dirs: ['~/.agents/skills', '~/.codex/skills'], projectDirs: ['.agents/skills'] },
  { id: 'opencode', bins: ['opencode'], envs: ['OPENCODE_CONFIG_DIR'],
    dirs: ['~/.config/opencode/skills'], projectDirs: ['.opencode'] },
  { id: 'pi',       bins: ['pi', 'dsh'], envs: [],
    dirs: ['~/.pi/agent/skills'], projectDirs: ['.pi'] },
  { id: 'devin',    bins: ['devin'],    envs: ['DEVIN_CONFIG_DIR'],
    dirs: ['~/.config/devin/skills', '~/.agents/skills'], projectDirs: ['.devin/skills'] },
  { id: 'gemini',   bins: ['gemini'],   envs: ['GEMINI_HOME'],
    dirs: ['~/.gemini/skills'], projectDirs: ['.gemini'] },
  { id: 'cursor',   bins: ['cursor'],   envs: [],
    dirs: ['~/.cursor/skills'], projectDirs: ['.cursor'] },
  { id: 'windsurf', bins: ['windsurf'], envs: [],
    dirs: ['~/.codeium/windsurf'], projectDirs: [], detectOnly: true },
];

const EXE_EXT = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];

export function binInPath(bin) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of EXE_EXT) {
      const p = path.join(dir, bin + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* skip */ }
    }
  }
  return null;
}

// env override：值是 harness 根目录，skill 目录 = <root>/skills
function envDirs(h) {
  const out = [];
  for (const v of h.envs) {
    const val = process.env[v];
    if (val) out.push({ dir: path.join(expandHome(val), 'skills'), viaEnv: v });
  }
  return out;
}

// 四态：installed=bin∧dir / available=bin∧!dir / likely=dir∧!bin / absent=双无
export function detectHarnesses() {
  const seen = new Map(); // 共享目录去重：abs path → owners[]
  return HARNESSES.map((h) => {
    const bin = h.bins.map(binInPath).find(Boolean) || null;
    const dirs = [
      ...envDirs(h).map((d) => ({ path: expandHome(d.dir), viaEnv: d.viaEnv })),
      ...h.dirs.map((d) => ({ path: expandHome(d), viaEnv: null })),
    ].map((d) => {
      const exists = fs.existsSync(d.path);
      const owners = seen.get(d.path) || [];
      owners.push(h.id);
      seen.set(d.path, owners);
      return { ...d, exists };
    });
    const anyDir = dirs.some((d) => d.exists);
    const state = bin && anyDir ? 'installed' : bin ? 'available' : anyDir ? 'likely' : 'absent';
    return { id: h.id, bin, state, dirs, detectOnly: !!h.detectOnly, projectDirs: h.projectDirs };
  });
}

// 共享目录去重后的投影目标：[{harnessId, dir}]——一个物理目录一条
export function projectionDirs(harnesses, ids = null) {
  const out = [];
  const seen = new Set();
  for (const h of harnesses) {
    if (h.detectOnly || h.state === 'absent' || h.state === 'likely') continue;
    if (ids && !ids.includes(h.id)) continue;
    for (const d of h.dirs) {
      if (seen.has(d.path)) continue;
      seen.add(d.path);
      out.push({ harnessId: h.id, dir: d.path });
    }
  }
  return out;
}

export function scanSkillDir(dir) {
  const skills = [];
  if (!fs.existsSync(dir)) return skills;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    const s = readSkillDir(p);
    if (s) skills.push(s);
  }
  return skills;
}

// 全量库存：hub skills + 每个 harness 目录 + project——managed 判定留给调用方；按物理路径去重（共享目录只报一次）
export function scanAll(hub, harnesses, library, projectRoot = null) {
  const managed = new Set(Object.keys(library.skills || {}));
  const rows = [];
  const seen = new Set();
  const push = (s) => { if (!seen.has(s.path)) { seen.add(s.path); rows.push(s); } };
  const hubSkills = scanSkillDir(path.join(hub, 'skills'));
  for (const s of hubSkills) {
    push({ ...s, where: 'hub', state: managed.has(s.name) ? 'managed' : 'hub-untracked' });
  }
  for (const h of harnesses) {
    if (h.detectOnly) continue;
    for (const d of h.dirs) {
      if (!d.exists) continue;
      for (const s of scanSkillDir(d.path)) {
        push({ ...s, where: h.id, targetDir: d.path, state: managed.has(s.name) ? 'managed' : 'external' });
      }
    }
  }
  if (projectRoot) {
    for (const h of harnesses) {
      for (const pd of h.projectDirs || []) {
        const dir = path.join(projectRoot, pd);
        for (const s of scanSkillDir(dir)) {
          push({ ...s, where: 'project', targetDir: dir, state: managed.has(s.name) ? 'managed' : 'external' });
        }
      }
    }
  }
  return rows;
}

// harness 目录归属判定：absPath 是否位于某 harness skills dir 下
export function harnessDirOf(harnesses, absPath) {
  const target = path.resolve(absPath);
  for (const h of harnesses) {
    for (const d of h.dirs) {
      if (path.dirname(target) === path.resolve(d.path)) return { harnessId: h.id, dir: d.path };
    }
  }
  return null;
}

// cwd 向上找项目根（.git 或任一 harness projectDir）
export function detectProject(cwd) {
  let cur = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return { root: cur };
    for (const h of HARNESSES) {
      for (const pd of h.projectDirs) {
        if (fs.existsSync(path.join(cur, pd))) return { root: cur };
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}
