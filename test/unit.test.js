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

test('assertSafeTar rejects traversal and link members', async () => {
  const { assertSafeTar } = await import('../client/lib/package.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmkt-tar-'));
  const good = path.join(tmp, 'good'), gdir = path.join(good, 'pkg');
  fs.mkdirSync(gdir, { recursive: true });
  fs.writeFileSync(path.join(gdir, 'SKILL.md'), 'x');
  const goodTar = path.join(tmp, 'good.tar.gz');
  execFileSync('tar', ['czf', goodTar, '-C', good, 'pkg']);
  assertSafeTar(goodTar);
  const evil = path.join(tmp, 'evil'), edir = path.join(evil, 'pkg');
  fs.mkdirSync(edir, { recursive: true });
  fs.symlinkSync('/etc/passwd', path.join(edir, 'leak'));
  const evilTar = path.join(tmp, 'evil.tar.gz');
  execFileSync('tar', ['czf', evilTar, '-C', evil, 'pkg']);
  assert.throws(() => assertSafeTar(evilTar), /unsafe member type/);
});

// ── 安全校验器（audit-round-2 新增面的回归防线）──────────────────────
test('insideDir rejects sibling-prefix escape', async () => {
  const { insideDir } = await import('../client/lib/package.js');
  assert.ok(insideDir('/h/evidence', '/h/evidence/x.png'));
  assert.ok(insideDir('/h/evidence', '/h/evidence'));
  assert.ok(!insideDir('/h/evidence', '/h/evidence-evil/x'));   // 上轮的真 bug
  assert.ok(!insideDir('/h/evidence', '/h/ev/x'));
  assert.ok(!insideDir('/pub', '/etc/passwd'));
});

test('isSafeHost / isSafeRel gate page-supplied values', async () => {
  const { isSafeHost, isSafeRel } = await import('../client/lib/package.js');
  assert.ok(isSafeHost('https://uizze.sh'));
  assert.ok(!isSafeHost('http://uizze.sh') && !isSafeHost('https://169.254.169.254'));
  assert.ok(!isSafeHost('https://u:p@evil.com') && !isSafeHost('not a url'));
  for (const ok of ['SKILL.md', 'a/b/c.txt', 'x_y.z']) assert.ok(isSafeRel(ok), ok);
  for (const bad of ['../x', 'a/../b', '/etc/passwd', 'a//b', 'a/./b', 'a\\b', '%2e%2e/x', 'a b']) assert.ok(!isSafeRel(bad), bad);
});

test('fetchToFile writes bounded downloads, rejects errors and oversize', async () => {
  const { fetchToFile } = await import('../client/lib/package.js');
  const http = await import('node:http');
  const srv = http.createServer((req, res) => {
    if (req.url === '/ok') { res.end('payload'); return; }
    if (req.url === '/big') { res.end('x'.repeat(2e6)); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmkt-ftf-'));
  try {
    await fetchToFile(`${base}/ok`, path.join(tmp, 'a'), { maxBytes: 1e6 });
    assert.equal(fs.readFileSync(path.join(tmp, 'a'), 'utf8'), 'payload');
    await assert.rejects(() => fetchToFile(`${base}/big`, path.join(tmp, 'b'), { maxBytes: 1e6 }), /exceeds|too large/);
    await assert.rejects(() => fetchToFile(`${base}/nf`, path.join(tmp, 'c')), /fetch 404/);
  } finally { srv.close(); }
});

test('walk/copyDir skip symlinks (no secret-content exfil)', async () => {
  const { walk, copyDir } = await import('../client/lib/package.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmkt-ln-'));
  const src = path.join(tmp, 's'), dst = path.join(tmp, 'd');
  fs.mkdirSync(src); fs.writeFileSync(path.join(src, 'a.txt'), 'real');
  fs.symlinkSync('/etc/hosts', path.join(src, 'leak.txt'));
  assert.deepEqual([...walk(src)].map((p) => path.basename(p)), ['a.txt']);   // leak 不进清单
  copyDir(src, dst);
  assert.ok(fs.existsSync(path.join(dst, 'a.txt')) && !fs.existsSync(path.join(dst, 'leak.txt')));
});

// ── 核心不变量 ──────────────────────────────────────────────────
test('conflictFingerprint is side-order-insensitive, whitespace-insensitive', async () => {
  const { conflictFingerprint } = await import('../pipeline/lib/util.js');
  const a = conflictFingerprint([{ text: 'Use A' }, { text: 'Use B' }]);
  const b = conflictFingerprint([{ text: '  use   b ' }, { text: 'use a' }]);
  assert.equal(a, b);   // 同一对规则换个顺序/空白——指纹必须一致（防重复开战）
});

test('decide requires reason; overturn records supersedes', async () => {
  const { decide } = await import('../client/lib/decide.js');
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmkt-dec-'));
  const c = { id: 'c-t1', fingerprint: 'fp1' };
  assert.throws(() => decide(hub, c, { resolution: 'keep-a' }), /reason/);
  const d1 = decide(hub, c, { resolution: 'keep-a', reason: 'A 更具体' });
  assert.equal(d1.supersedes, null);
  const d2 = decide(hub, { ...c, id: 'c-t2' }, { resolution: 'merge', custom: 'x', reason: '其实能合' });
  assert.equal(d2.supersedes, d1.decided_at);   // 同 fingerprint 再决 → 记推翻链
});

test('registerSkill rejects unsafe names at write boundary', async () => {
  const { registerSkill } = await import('../client/lib/hub.js');
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmkt-reg-'));
  assert.throws(() => registerSkill(hub, '../evil', {}), /unsafe/);
  assert.doesNotThrow(() => registerSkill(hub, '测试-skill_1.0', {}));
});

test('hub state files written 0600', async () => {
  const { writeYAMLFile } = await import('../client/lib/hub.js');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'skillmkt-perm-')), 'x.yml');
  writeYAMLFile(f, { a: 1 });
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});

test('encryptSecret/decryptSecret roundtrip; tampered payload fails', async () => {
  const { encryptSecret, decryptSecret, resolveKeyRef } = await import('../client/lib/llm.js');
  const enc = encryptSecret('sk-test-123');
  assert.match(enc, /^enc:v1:/);
  assert.equal(decryptSecret(enc), 'sk-test-123');
  assert.equal(decryptSecret(enc.slice(0, -4) + 'AAAA'), null);   // 篡改 → 解不开
  assert.equal(resolveKeyRef('plain-value', {}), 'plain-value');
});

test('resolveKeyRef env: reads cwd/hub .env then process.env', async () => {
  const { resolveKeyRef } = await import('../client/lib/llm.js');
  const hub = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmkt-env-'));
  fs.writeFileSync(path.join(hub, '.env'), 'MY_TEST_KEY=from-hub\n');
  assert.equal(resolveKeyRef('env:MY_TEST_KEY', { hub, cwd: '/nonexistent' }), 'from-hub');
  assert.equal(resolveKeyRef('env:NOPE_NOPE_KEY', { hub, cwd: '/nonexistent' }), '');
});

test('treeHash rename-stable, content-sensitive', async () => {
  const { treeHash } = await import('../client/lib/package.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmkt-th-'));
  const a = path.join(tmp, 'alpha'), b = path.join(tmp, 'beta');
  fs.mkdirSync(a); fs.mkdirSync(b);
  fs.writeFileSync(path.join(a, 'f.md'), 'same');
  fs.writeFileSync(path.join(b, 'f.md'), 'same');
  assert.equal(treeHash(a), treeHash(b));              // 目录名不参与
  fs.writeFileSync(path.join(b, 'f.md'), 'different');
  assert.notEqual(treeHash(a), treeHash(b));
});

test('verdictOf thresholds: clean→suspicious→malicious', async () => {
  const { verdictOf } = await import('../client/lib/audit.js');
  assert.equal(verdictOf([], []), 'clean');
  assert.equal(verdictOf([{ rule: 'egress-cmd', doc: true }], []), 'clean');      // doc 语境不定罪
  assert.equal(verdictOf([{ rule: 'egress-cmd' }], []), 'suspicious');
  assert.equal(verdictOf([{ rule: 'pii-harvest' }], []), 'malicious');
  assert.equal(verdictOf([{ rule: 'secret-pattern' }, { rule: 'egress-cmd' }], []), 'malicious');
});

test('stripFilter excludes stripped top dirs and exact rels', async () => {
  const { stripFilter } = await import('../client/lib/audit.js');
  const f = stripFilter(['scripts/x.sh', 'evil.exe']);
  assert.ok(!f('scripts/x.sh') && !f('scripts/other.sh') && !f('evil.exe'));
  assert.ok(f('SKILL.md') && f('docs/a.md'));
});

test('parseFrontmatter + readSkillDir pick meta.name, fall back to dirname', async () => {
  const { readSkillDir } = await import('../client/lib/package.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmkt-fm-'));
  fs.writeFileSync(path.join(tmp, 'SKILL.md'), '---\nname: real-name\nversion: 1.2.3\n---\nbody');
  const pkg = readSkillDir(tmp);
  assert.equal(pkg.name, 'real-name');
  assert.equal(pkg.version, '1.2.3');
  const bare = path.join(tmp, 'dir-skill'); fs.mkdirSync(bare);
  fs.writeFileSync(path.join(bare, 'SKILL.md'), 'no frontmatter');
  assert.equal(readSkillDir(bare).name, 'dir-skill');
  assert.equal(readSkillDir(path.join(tmp, 'nope')), null);
});

test('parseRef: github/url/tree/registry/local/named', async () => {
  const { parseRef } = await import('../client/lib/ref.js');
  const p = (s) => parseRef(s, {}, {});
  assert.deepEqual({ kind: p('o/r').kind, o: p('o/r').owner }, { kind: 'github', o: 'o' });
  assert.equal(p('o/r/sub/dir@v1').ref, 'v1');
  assert.equal(p('https://github.com/o/r/tree/main/pkgs/x').path, 'pkgs/x');
  assert.equal(p('https://github.com/o/r.git#v2').ref, 'v2');
  assert.equal(parseRef('corp:my.skill', {}, { registries: [{ name: 'corp' }] }).registry, 'corp');
  assert.equal(p('barename').kind, 'named');
});

test('parseArgv: --k=v, --k v, -- separator, flag values never swallow flags', async () => {
  const { parseArgv } = await import('../client/lib/ctx.js');
  const { flags, positional } = parseArgv(['install', '--hub', '/x', '--to=v2', '--', '--weird']);
  assert.equal(flags.hub, '/x');
  assert.equal(flags.raw.to, 'v2');
  assert.deepEqual(positional, ['install', '--weird']);
  const { flags: f2 } = parseArgv(['switch', '--to', '--force', 'name']);   // --to 后紧跟 flag → 不吞
  assert.equal(f2.raw.to, true);
  assert.equal(f2.raw.force, true);
});
