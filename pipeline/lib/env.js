import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch { /* tolerate malformed env file */ }
}

export const CFG = {
  baseUrl: (process.env.OMLX_BASE_URL || 'http://localhost:8001/v1').replace(/\/$/, ''),
  apiKey: process.env.OMLX_API_KEY || '',
  model: process.env.OMLX_MODEL || '',
  githubRepo: process.env.GITHUB_REPO || '',
  githubBranch: process.env.GITHUB_BRANCH || 'main',
  intervalMin: Number(process.env.DAEMON_INTERVAL_MIN || 30),
};

export const DIRS = {
  work: path.join(ROOT, 'work'),
  upstream: path.join(ROOT, 'work', 'upstream'),
  extracted: path.join(ROOT, 'extracted'),
  merged: path.join(ROOT, 'merged'),
  conflicts: path.join(ROOT, 'conflicts'),
  decisions: path.join(ROOT, 'decisions'),
  evidence: path.join(ROOT, 'evidence'),
  skill: path.join(ROOT, 'skill'),
  lint: path.join(ROOT, 'lint'),
  config: path.join(ROOT, 'config'),
};

export const FILES = {
  upstreams: path.join(DIRS.config, 'upstreams.json'),
  lock: path.join(ROOT, 'upstream.lock.json'),
  mergedRules: path.join(DIRS.merged, 'rules.yml'),
};
