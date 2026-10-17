'use strict';

/**
 * 配对码单测
 * 覆盖：字母表口径、生成、唯一性重试、归一化（明确拒绝策略）、展示分组。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALPHABET,
  CODE_LEN,
  CODE_RETRY_LIMIT,
  ERROR_CODES,
} = require('../shared/constants.js');
const {
  AMBIGUOUS_CHARS,
  CODE_SPACE,
  generatePairCode,
  generateUniquePairCode,
  normalizePairCode,
  formatPairCode,
} = require('../server/lib/codes.js');

/** 按序循环取值的随机整数源，用于制造确定性的配对码。 */
function sequenceRandomInt(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

/** 由字母表下标序列构造期望的配对码。 */
function codeFromIndices(indices) {
  return indices.map((n) => ALPHABET[n]).join('');
}

test('字母表口径：实测 31 个字符、无重复、不含易混字符', () => {
  assert.equal(ALPHABET.length, 31, 'ALPHABET 实为 31 字符（23 字母 + 2–9），技术资产 §3.5 注释的 32 有误');
  assert.equal(new Set(ALPHABET).size, ALPHABET.length, 'ALPHABET 不应有重复字符');
  for (const ch of ['I', 'L', 'O', '0', '1']) {
    assert.ok(!ALPHABET.includes(ch), `ALPHABET 不应包含易混字符 ${ch}`);
  }
  assert.equal(AMBIGUOUS_CHARS, 'ILO01');
  assert.equal(CODE_SPACE, 31 ** 8, '码空间应由 ALPHABET.length 计算，而非写死 32');
});

test('生成：长度 8、字符全部合法、可注入随机源（确定性）', () => {
  const code = generatePairCode(sequenceRandomInt([0, 1, 2, 3, 4, 5, 6, 7]));
  assert.equal(code.length, CODE_LEN);
  assert.equal(code, codeFromIndices([0, 1, 2, 3, 4, 5, 6, 7]));
  for (const ch of code) assert.ok(ALPHABET.includes(ch));
  assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
});

test('生成：默认随机源的产物形态合法（抽样 200 次）', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const code = generatePairCode();
    assert.equal(code.length, CODE_LEN);
    for (const ch of code) assert.ok(ALPHABET.includes(ch), `出现非法字符 ${ch}`);
    seen.add(code);
  }
  assert.ok(seen.size > 190, '200 次抽样不应大量碰撞');
});

test('唯一性重试：首次碰撞后取到未占用码', async () => {
  // 第一次生成 ABCDEFGH（下标 0–7），被占；第二次生成 JKMNPQRS（下标 8–15），空闲
  // 注意下标 10 是 M —— L 已被字母表排除
  const code = await generateUniquePairCode(
    (candidate) => candidate === 'ABCDEFGH',
    sequenceRandomInt([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  );
  assert.equal(code, 'JKMNPQRS');
  assert.equal(code, codeFromIndices([8, 9, 10, 11, 12, 13, 14, 15]));
});

test('唯一性重试：连续冲突达上限后抛 SERVER_ERROR', async () => {
  await assert.rejects(
    generateUniquePairCode(() => true, sequenceRandomInt([0])),
    (err) => {
      assert.equal(err.code, ERROR_CODES.SERVER_ERROR);
      assert.match(err.message, new RegExp(`连续 ${CODE_RETRY_LIMIT} 次冲突`));
      return true;
    }
  );
});

test('唯一性重试：exists 判定可为异步（云库查 _id 的路径）', async () => {
  let calls = 0;
  const code = await generateUniquePairCode(async (candidate) => {
    calls += 1;
    return candidate === 'ABCDEFGH';
  }, sequenceRandomInt([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]));
  assert.equal(code, 'JKMNPQRS');
  assert.equal(calls, 2, '异步判定应被逐码 await');
});

test('归一化：小写与带连字符输入可归一化（展示态 → 存储态）', () => {
  assert.deepEqual(normalizePairCode('k7qx-2m9t'), { ok: true, reason: null, value: 'K7QX2M9T' });
  assert.deepEqual(normalizePairCode(' K7QX 2M9T '), { ok: true, reason: null, value: 'K7QX2M9T' });
  assert.equal(normalizePairCode('K7QX-2M9T').value, 'K7QX2M9T');
});

test('归一化：含易混字符 → 明确拒绝 AMBIGUOUS_CHARS（不做模糊映射）', () => {
  const r1 = normalizePairCode('K7QXI9T2');
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'AMBIGUOUS_CHARS');
  assert.equal(r1.char, 'I');
  assert.equal(r1.value, null);

  const r2 = normalizePairCode('K7QX0M9T');
  assert.equal(r2.reason, 'AMBIGUOUS_CHARS');
  assert.equal(r2.char, '0');

  // 长度合法但含 1，同样是歧义而非长度问题
  const r3 = normalizePairCode('K7QX1M9T');
  assert.equal(r3.reason, 'AMBIGUOUS_CHARS');
});

test('归一化：长度不符或含字母表外字符 → INVALID_CODE', () => {
  assert.equal(normalizePairCode('K7QX2M9').reason, 'INVALID_CODE');
  assert.equal(normalizePairCode('K7QX2M9TX').reason, 'INVALID_CODE');
  const r = normalizePairCode('K7QX2M9@');
  assert.equal(r.reason, 'INVALID_CODE');
  assert.equal(r.char, '@');
});

test('归一化：空输入与非字符串 → EMPTY', () => {
  assert.equal(normalizePairCode('').reason, 'EMPTY');
  assert.equal(normalizePairCode('   ').reason, 'EMPTY');
  assert.equal(normalizePairCode('---').reason, 'EMPTY');
  assert.equal(normalizePairCode(null).reason, 'EMPTY');
  assert.equal(normalizePairCode(12345678).reason, 'EMPTY');
});

test('展示分组：4-4 分组，存储与传输不带分隔符', () => {
  assert.equal(formatPairCode('K7QX2M9T'), 'K7QX-2M9T');
  assert.equal(formatPairCode('ABCDEFGH'), 'ABCD-EFGH');
  // 往返：分组后的展示态仍可归一化回存储态
  assert.equal(normalizePairCode(formatPairCode('K7QX2M9T')).value, 'K7QX2M9T');
});

test('展示分组：位数不符抛错', () => {
  assert.throws(() => formatPairCode('K7QX2M9'), (err) => err.code === ERROR_CODES.ANSWER_INVALID);
  assert.throws(() => formatPairCode(null), (err) => err.code === ERROR_CODES.ANSWER_INVALID);
});
