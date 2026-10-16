'use strict';

/**
 * 同频度计算 —— **服务端唯一实现**
 *
 * 依据：《技术资产》§3.2；PRD 3.5；《文案资产-5档相处模式解读.md》。
 *
 * 约束：
 *   - 展示值保留 1 位小数（11/12 = 91.666…% → 91.7%，8/12 = 66.666…% → 66.7%）
 *   - 标签**只由 C 决定**，百分比不得用于标签判定，也不得用于排序或优劣展示
 *   - 同频度计算不得在前端存在实现副本，由 `tools/check-client-isolation.js` 自动拦截
 */

const { W_SAME, W_COMP, FULL, BAND_BY_C } = require('../../shared/constants.js');
const { raise } = require('./errors.js');

const CODE_LENGTH = 4;
const VALID_ENDPOINTS = ['A', 'B'];

/** 校验原型码形态：长度 4 且每位为 A 或 B。 */
function assertCode(code, label) {
  if (typeof code !== 'string' || code.length !== CODE_LENGTH) {
    throw raise.ANSWER_INVALID(`CODE_INVALID: ${label} 应为 ${CODE_LENGTH} 位原型码，实际 ${String(code)}`);
  }
  for (const ch of code) {
    if (!VALID_ENDPOINTS.includes(ch)) {
      throw raise.ANSWER_INVALID(`CODE_INVALID: ${label} 含非法端点 ${ch}`);
    }
  }
}

/**
 * 双方原型码 → 同频度。
 *
 * @param {string} codeA 4 位原型码
 * @param {string} codeB 4 位原型码
 * @returns {{c:number, p:number, similarityPct:number, band:string, bandIndex:number}}
 *   c 一致项数、p 互补项数（恒有 c + p = 4）、similarityPct 展示值（1 位小数）、band 相处模式标签
 * @throws {DomainError} ANSWER_INVALID（原型码非法，语义名 CODE_INVALID）
 */
function similarity(codeA, codeB) {
  assertCode(codeA, 'codeA');
  assertCode(codeB, 'codeB');

  let c = 0;
  for (let i = 0; i < CODE_LENGTH; i++) {
    if (codeA[i] === codeB[i]) c++;
  }
  const p = CODE_LENGTH - c; // 恒有 C + P = 4
  const raw = ((c * W_SAME + p * W_COMP) / FULL) * 100;

  return {
    c,
    p,
    similarityPct: Math.round(raw * 10) / 10, // 保留 1 位小数
    band: BAND_BY_C[c], // 标签按 C 判定，不按百分比排名
    bandIndex: c,
  };
}

/**
 * 展示值格式化：保留 1 位小数并去掉无意义的尾零。
 * 例：100 → '100%'，91.7 → '91.7%'，75 → '75%'，66.7 → '66.7%'
 * @param {number} pct
 * @returns {string}
 */
function formatSimilarityPct(pct) {
  if (typeof pct !== 'number' || Number.isNaN(pct)) {
    throw raise.ANSWER_INVALID(`similarityPct 非法：${String(pct)}`);
  }
  const rounded = Math.round(pct * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}%`;
}

/** 单档查询：给定一致项数 C 返回该档信息（展示值由权重推得，非写死）。 */
function bandForCount(c) {
  if (!Number.isInteger(c) || c < 0 || c > CODE_LENGTH) {
    throw raise.ANSWER_INVALID(`一致项数 C 非法：${String(c)}`);
  }
  const p = CODE_LENGTH - c;
  return {
    c,
    p,
    similarityPct: Math.round(((c * W_SAME + p * W_COMP) / FULL) * 1000) / 10,
    band: BAND_BY_C[c],
  };
}

module.exports = { similarity, formatSimilarityPct, bandForCount, CODE_LENGTH };
