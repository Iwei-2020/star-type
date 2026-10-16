'use strict';

/**
 * 同频度计算单测
 * 覆盖：《测试资产》TC-SM-01～07；PRD 3.5 五档表逐条对齐。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ARCHETYPES,
  BAND_BY_C,
  ERROR_CODES,
} = require('../shared/constants.js');
const { similarity, formatSimilarityPct, bandForCount } = require('../server/lib/similarity.js');

/** PRD 3.5 五档：C → 展示值（唯一权威）。 */
const PRD_PCT_BY_C = { 4: 100, 3: 91.7, 2: 83.3, 1: 75, 0: 66.7 };

/** PRD 3.5 五档：C → 标签（唯一权威）。 */
const PRD_BAND_BY_C = {
  4: '同频共振型',
  3: '高默契型',
  2: '均衡互补型',
  1: '差异互补型',
  0: '极致互补型',
};

test('TC-SM-01：ABAB / ABAB → C=4, P=0, 100%, 同频共振型', () => {
  const r = similarity('ABAB', 'ABAB');
  assert.equal(r.c, 4);
  assert.equal(r.p, 0);
  assert.equal(r.similarityPct, 100);
  assert.equal(r.band, '同频共振型');
});

test('TC-SM-02：ABAB / ABAA → C=3, P=1, 91.7%, 高默契型', () => {
  const r = similarity('ABAB', 'ABAA');
  assert.equal(r.c, 3);
  assert.equal(r.p, 1);
  assert.equal(r.similarityPct, 91.7);
  assert.equal(r.band, '高默契型');
});

test('TC-SM-03：ABAB / AABB → C=2, P=2, 83.3%, 均衡互补型', () => {
  const r = similarity('ABAB', 'AABB');
  assert.equal(r.c, 2);
  assert.equal(r.p, 2);
  assert.equal(r.similarityPct, 83.3);
  assert.equal(r.band, '均衡互补型');
});

test('C=1 → 75%（整数展示值，测试资产要求显式覆盖）', () => {
  // ABAB / BAAA：逐位 A≠B、B≠A、A=A、B≠A → 仅第 3 位相同 → C=1
  const r = similarity('ABAB', 'BAAA');
  assert.equal(r.c, 1);
  assert.equal(r.p, 3);
  assert.equal(r.similarityPct, 75, '75 为整数，不得出现 75.0');
  assert.equal(r.band, '差异互补型');
  assert.equal(formatSimilarityPct(r.similarityPct), '75%');
});

test('TC-SM-04：ABAB / BABA → C=0, P=4, 66.7%, 极致互补型', () => {
  const r = similarity('ABAB', 'BABA');
  assert.equal(r.c, 0);
  assert.equal(r.p, 4);
  assert.equal(r.similarityPct, 66.7);
  assert.equal(r.band, '极致互补型');
});

test('TC-SM-05：遍历 16 × 16 = 256 组配对', () => {
  const codes = Object.keys(ARCHETYPES);
  let checked = 0;

  for (const codeA of codes) {
    for (const codeB of codes) {
      const r = similarity(codeA, codeB);

      // C + P 恒为 4；C 等于逐位相同计数（测试自备口径，非生产副本）
      let expectedC = 0;
      for (let i = 0; i < 4; i++) if (codeA[i] === codeB[i]) expectedC++;
      assert.equal(r.c, expectedC, `${codeA}/${codeB} 一致项数不符`);
      assert.equal(r.p, 4 - expectedC);
      assert.equal(r.c + r.p, 4);

      // 展示值与标签严格按 C 映射
      assert.equal(r.similarityPct, PRD_PCT_BY_C[r.c], `${codeA}/${codeB} 展示值不符`);
      assert.equal(r.band, PRD_BAND_BY_C[r.c], `${codeA}/${codeB} 标签不符`);

      checked++;
    }
  }
  assert.equal(checked, 256, '应恰好校验 256 组配对');
});

test('TC-SM-06：同 C 必同标签（标签只由 C 决定，不由百分比排名）', () => {
  const codes = Object.keys(ARCHETYPES);
  const bandByC = new Map();
  for (const codeA of codes) {
    for (const codeB of codes) {
      const r = similarity(codeA, codeB);
      if (bandByC.has(r.c)) {
        assert.equal(r.band, bandByC.get(r.c), `C=${r.c} 出现两种标签`);
      } else {
        bandByC.set(r.c, r.band);
      }
    }
  }
  assert.equal(bandByC.size, 5, '应恰好出现 5 个 C 取值');
});

test('TC-SM-07：码长 ≠ 4 报错（语义名 CODE_INVALID，映射到 ANSWER_INVALID）', () => {
  assert.throws(
    () => similarity('ABA', 'ABAB'),
    (err) => {
      assert.equal(err.code, ERROR_CODES.ANSWER_INVALID);
      assert.match(err.message, /CODE_INVALID/);
      return true;
    }
  );
  assert.throws(() => similarity('ABAB', 'ABABC'), (err) => err.code === ERROR_CODES.ANSWER_INVALID);
  assert.throws(() => similarity('ABAX', 'ABAB'), (err) => err.code === ERROR_CODES.ANSWER_INVALID);
  assert.throws(() => similarity(undefined, 'ABAB'), (err) => err.code === ERROR_CODES.ANSWER_INVALID);
});

test('PRD 3.5 五档展示值与标签逐条对齐（BAND_BY_C 与表格一字不差）', () => {
  assert.equal(BAND_BY_C.length, 5);
  for (let c = 0; c <= 4; c++) {
    assert.equal(BAND_BY_C[c], PRD_BAND_BY_C[c], `C=${c} 标签不符`);
    const band = bandForCount(c);
    assert.equal(band.similarityPct, PRD_PCT_BY_C[c], `C=${c} 展示值不符`);
    assert.equal(band.p, 4 - c);
  }
});

test('展示值格式化：去尾零但保留 1 位小数', () => {
  assert.equal(formatSimilarityPct(100), '100%');
  assert.equal(formatSimilarityPct(91.7), '91.7%');
  assert.equal(formatSimilarityPct(83.3), '83.3%');
  assert.equal(formatSimilarityPct(75), '75%');
  assert.equal(formatSimilarityPct(66.7), '66.7%');
});
