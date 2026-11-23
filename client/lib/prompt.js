// prompt.js — TTY 确认/选择（非 TTY 一律安全默认）
import readline from 'node:readline';

export async function confirm(question, { defaultYes = false } = {}) {
  if (!process.stdin.isTTY) return defaultYes;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ans = await new Promise((res) => rl.question(`${question} [${defaultYes ? 'Y/n' : 'y/N'}] `, res));
  rl.close();
  const a = ans.trim().toLowerCase();
  return a === '' ? defaultYes : a === 'y' || a === 'yes';
}

export async function choose(question, options) {
  if (!process.stdin.isTTY) return options[0];
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  process.stderr.write(`${question}\n`);
  options.forEach((o, i) => process.stderr.write(`  ${i + 1}. ${o.label || o}\n`));
  const ans = await new Promise((res) => rl.question('> ', res));
  rl.close();
  const n = parseInt(ans, 10);
  return options[n - 1] ?? options[0];
}
