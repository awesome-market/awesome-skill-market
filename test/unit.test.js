import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { extractJSON } from '../pipeline/lib/llm.js';
import { tokens, jaccard, ruleHash, nextId, normText } from '../pipeline/lib/util.js';
import { conflictFingerprint } from '../pipeline/lib/util.js';
import { parseVote } from '../pipeline/poll.js';

test('extractJSON parses plain, fenced, and nested JSON', () => {
  assert.deepEqual(extractJSON('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJSON('sure!\n```json\n{"a":{"b":[1,2]}}\n```\ndone'), { a: { b: [1, 2] } });
  assert.deepEqual(extractJSON('[1,{"x":"y}]z"}]'), [1, { x: 'y}]z' }]);
  assert.throws(() => extractJSON('no json here'));
});

test('ruleHash is punctuation/case-insensitive', () => {
  assert.equal(ruleHash('Never use `transition: all`!'), ruleHash('never use transition all'));
  assert.notEqual(ruleHash('allow gradients'), ruleHash('ban gradients'));
});

test('jaccard similarity', () => {
  assert.equal(jaccard(tokens('use real photographs'), tokens('use real photographs')), 1);
  assert.ok(jaccard(tokens('never animate width'), tokens('never animate height')) < 0.6);
  assert.equal(jaccard(tokens('color tokens'), tokens('keyboard focus')), 0);
});

test('conflictFingerprint is order-insensitive', () => {
  const s1 = [{ text: 'Ban gradients' }, { text: 'Use gradient palettes' }];
  const s2 = [{ text: 'Use gradient palettes' }, { text: 'Ban gradients' }];
  assert.equal(conflictFingerprint(s1), conflictFingerprint(s2));
});

test('nextId sequences over existing files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-'));
  fs.writeFileSync(path.join(dir, 'conf-0003.yml'), 'x');
  fs.writeFileSync(path.join(dir, 'conf-0007.yml'), 'x');
  assert.equal(nextId(dir, 'conf'), 'conf-0008');
});

test('lint flags violations and passes clean files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-lint-'));
  const bad = path.join(dir, 'bad.css');
  fs.writeFileSync(bad, 'a { transition: all .2s; background: linear-gradient(red, blue); }\n');
  const good = path.join(dir, 'good.css');
  fs.writeFileSync(good, 'a { transition: opacity .2s; color: #333; }\n');
  const run = (f) => {
    try {
      const out = execFileSync('node', ['lint/run.mjs', f], { encoding: 'utf8' });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status, out: e.stdout ?? '' };
    }
  };
  const badRes = run(bad);
  assert.equal(badRes.code, 1);
  assert.match(badRes.out, /no-transition-all/);
  assert.match(badRes.out, /no-linear-gradient/);
  assert.equal(run(good).code, 0);
});

test('normText strips markdown noise', () => {
  assert.equal(normText('**Never** `transition: all` — it\'s sloppy'), 'never transition all it s sloppy');
});

test('parseVote accepts exact a/b votes and merge/custom text', () => {
  assert.deepEqual(parseVote('a'), { resolution: 'A', reason: null });
  assert.deepEqual(parseVote('  B '), { resolution: 'B', reason: null });
  assert.deepEqual(parseVote('a - gradients break print'), { resolution: 'A', reason: 'gradients break print' });
  assert.deepEqual(parseVote('A: 选这个'), { resolution: 'A', reason: '选这个' });
  assert.deepEqual(parseVote('merge use opacity only'), { resolution: 'merge', custom: 'use opacity only' });
  assert.deepEqual(parseVote('custom 自定义规则'), { resolution: 'custom', custom: '自定义规则' });
});

test('parseVote rejects non-votes and bare merge/custom', () => {
  for (const s of ['x', 'a b', 'hello a', 'I choose A because...', 'aaa', '']) {
    assert.equal(parseVote(s), null, s);
  }
  assert.ok(parseVote('merge').error);
  assert.ok(parseVote('custom').error);
});

test('safeName allows unicode names, rejects path traversal', async () => {
  const { safeName } = await import('../client/lib/package.js');
  for (const n of ['ui-taste', 'merge-test', '测试', 'skill_v2.1']) assert.ok(safeName(n), n);
  for (const n of ['../evil', 'a/b', 'a\\b', '..', '.hidden', '', 'x'.repeat(81), 'a b']) assert.ok(!safeName(n), JSON.stringify(n));
});
