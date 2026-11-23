// yamlls.js — 目录下所有 yml 读成数组
import fs from 'node:fs';
import path from 'node:path';
import { readYAMLFile } from './hub.js';

export function listYAML(dir) {
  try {
    return fs.readdirSync(dir)
      .filter((f) => /\.(ya?ml)$/.test(f))
      .sort()
      .map((f) => readYAMLFile(path.join(dir, f)))
      .filter(Boolean);
  } catch { return []; }
}
