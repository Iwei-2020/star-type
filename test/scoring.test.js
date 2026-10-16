'use strict';

/**
 * 计分与原型映射单测
 * 覆盖：《测试资产-验收用例与测试计划.md》TC-SC-01～08；《技术资产》§3.1 自检用例 U-1～U-5。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REQUIRED_ANSWER_COUNT,
  ARCHETYPES,
  ERROR_CODES,
} = require('../shared/constants.js');
const { scoreArchetype, resolveArchetype, scoreBreakdown } = require('../server/lib/scoring.js');

/** 按 Q1…Q10 顺序，由 10 个字母构造答案表。 */
function answersFrom(seq) {
  assert.equal(seq.length, REQUIRED_ANSWER_COUNT, '序列长度应为 10');
  const out = {};
  for (let i = 0; i < seq.length; i++) out[`Q${i + 1}`] = seq[i];
  return out;
}

/** 全选同一端点。 */
function allSame(ch) {
  return answersFrom(ch.repeat(REQUIRED_ANSWER_COUNT));
}

test('U-1 / TC-SC-01：全选 A → AAAA 曜日型', () => {
  const code = scoreArchetype(allSame('A'));
  assert.equal(code, 'AAAA');
  assert.equal(resolveArchetype(code).name, '曜日型');
});

test('U-2 / TC-SC-02：全选 B → BBBB 夜幕型', () => {
  const code = scoreArchetype(allSame('B'));
  assert.equal(code, 'BBBB');
  assert.equal(resolveArchetype(code).name, '夜幕型');
});

test('U-3 / TC-SC-03：题库资产 §四 自检链路 → ABAB 双星型', () => {
  // Q1A Q2B Q3A Q4B Q5A Q6B Q7A Q8B Q9A Q10B
  const code = scoreArchetype(answersFrom('ABABABABAB'));
  assert.equal(code, 'ABAB');
  assert.equal(resolveArchetype(code).name, '双星型');
});

test('U-4 / TC-SC-04：D3 同分（Q3B + Q7A）取 A 端（理性）', () => {
  const answers = answersFrom('ABABABABAB');
  answers.Q3 = 'B';
  answers.Q7 = 'A'; // D3: Q3=B(感性 1) / Q7=A(理性 1) → 同分
  const breakdown = scoreBreakdown(answers);
  const d3 = breakdown.find((d) => d.dim === 'D3');
  assert.equal(d3.tied, true, 'D3 应判定为同分');
  assert.equal(d3.lead, 'A');
  assert.equal(scoreArchetype(answers)[2], 'A');
});

test('U-5 / TC-SC-05：D4 同分（Q4B + Q8A）取 A 端（主动）', () => {
  const answers = answersFrom('AAAAAAAAAA');
  answers.Q4 = 'B';
  answers.Q8 = 'A'; // D4: Q4=B(随和 1) / Q8=A(主动 1) → 同分
  const breakdown = scoreBreakdown(answers);
  const d4 = breakdown.find((d) => d.dim === 'D4');
  assert.equal(d4.tied, true, 'D4 应判定为同分');
  assert.equal(d4.lead, 'A');
  assert.equal(scoreArchetype(answers)[3], 'A');
});

test('TC-SC-06：答案不完整（< 10 题）抛 ANSWER_INCOMPLETE，不生成结果', () => {
  assert.throws(
    () => scoreArchetype({ Q1: 'A', Q2: 'B', Q3: 'A' }),
    (err) => {
      assert.equal(err.code, ERROR_CODES.ANSWER_INCOMPLETE);
      assert.equal(err.codeName, 'ANSWER_INCOMPLETE');
      assert.match(err.message, /^ANSWER_INCOMPLETE/);
      return true;
    }
  );
});

test('TC-SC-06 补充：答案多于 10 题同样被拒绝（键数必须精确等于 10）', () => {
  const answers = answersFrom('AAAAAAAAAA');
  answers.Q11 = 'A';
  assert.throws(() => scoreArchetype(answers), (err) => err.code === ERROR_CODES.ANSWER_INCOMPLETE);
});

test('TC-SC-06 补充：选项取值非法抛 ANSWER_INVALID', () => {
  const answers = answersFrom('AAAAAAAAAA');
  answers.Q5 = 'C';
  assert.throws(
    () => scoreArchetype(answers),
    (err) => {
      assert.equal(err.code, ERROR_CODES.ANSWER_INVALID);
      assert.match(err.message, /ANSWER_INVALID/);
      return true;
    }
  );
});

test('TC-SC-07：确定性 —— 同一组答案重复调用结果一致', () => {
  const answers = answersFrom('ABBABABBAB');
  const first = scoreArchetype(answers);
  for (let i = 0; i < 20; i++) {
    assert.equal(scoreArchetype(answers), first);
  }
});

test('TC-SC-08：穷举 2^10 = 1024 组答案', () => {
  const seen = new Set();
  const tiedDims = new Set();
  let tiedCombos = 0;

  for (let n = 0; n < 1024; n++) {
    const seq = n
      .toString(2)
      .padStart(REQUIRED_ANSWER_COUNT, '0')
      .split('')
      .map((bit) => (bit === '0' ? 'A' : 'B'))
      .join('');
    const answers = answersFrom(seq);
    const code = scoreArchetype(answers);

    // ① 输出恒为 16 个合法码之一
    assert.match(code, /^[AB]{4}$/, `码形态非法：${code}`);
    assert.ok(ARCHETYPES[code], `码 ${code} 不在原型表内`);

    // ③ 同一组答案两次调用结果一致（无随机）
    assert.equal(scoreArchetype(answers), code);

    seen.add(code);

    // ② 出现同分的仅 D3、D4
    for (const d of scoreBreakdown(answers)) {
      if (d.tied) {
        tiedDims.add(d.dim);
        tiedCombos++;
      }
    }
  }

  assert.equal(seen.size, 16, '应恰好覆盖 16 个原型码');
  assert.deepEqual([...seen].sort(), Object.keys(ARCHETYPES).sort());
  assert.ok(tiedCombos > 0, '应存在同分组合');
  assert.deepEqual([...tiedDims].sort(), ['D3', 'D4'], '同分只可能出现在 D3 / D4');
});

test('原型映射：16 条逐一可解析且名称与常量表逐字一致', () => {
  for (const [code, entry] of Object.entries(ARCHETYPES)) {
    const resolved = resolveArchetype(code);
    assert.equal(resolved.name, entry.name);
    assert.equal(resolved.id, entry.id);
    assert.equal(resolved.symbolId, entry.symbolId);
  }
  assert.throws(
    () => resolveArchetype('AAAAA'),
    (err) => err.code === ERROR_CODES.ANSWER_INVALID
  );
});
