'use strict';

/**
 * 计分与原型映射 —— **服务端唯一实现**
 *
 * 依据：《技术资产-研发侧技术方案预研.md》§3.1；《文案资产-10题题库与计分表.md》§1.2 / §1.3。
 *
 * 该函数不得在前端存在实现副本（技术资产 §1.2「单一权威实现」）；
 * 由 `tools/check-client-isolation.js` 自动拦截。
 */

const {
  DIM_QUESTIONS,
  DIM_ORDER,
  REQUIRED_ANSWER_COUNT,
  ARCHETYPES,
} = require('../../shared/constants.js');
const { raise } = require('./errors.js');

/** 合法的选项取值。 */
const OPTION_VALUES = ['A', 'B'];

/**
 * 由 10 题答案计算 4 位原型码。
 *
 * 规则：每题二选一，被选中的选项为其所属维度的对应端点 +1（权重恒为 1）；
 * 取各维度得分较高的一端为主导端；两端同分时取 A 端（PRD 3.5 全局唯一规则）。
 *
 * @param {Record<string, 'A'|'B'>} answers Map<题号, 'A'|'B'>，必须覆盖全部 10 题
 * @returns {string} 4 位原型码，如 'ABAB'
 * @throws {DomainError} ANSWER_INCOMPLETE（答案不完整）/ ANSWER_INVALID（选项非法）
 */
function scoreArchetype(answers) {
  if (answers === null || typeof answers !== 'object') {
    throw raise.ANSWER_INVALID('answers 必须为对象');
  }
  if (Object.keys(answers).length !== REQUIRED_ANSWER_COUNT) {
    throw raise.ANSWER_INCOMPLETE(
      `需要 ${REQUIRED_ANSWER_COUNT} 题，实际 ${Object.keys(answers).length} 题`
    );
  }

  return DIM_ORDER.map((dim) => {
    let a = 0;
    let b = 0;
    for (const q of DIM_QUESTIONS[dim]) {
      const value = answers[q];
      if (!OPTION_VALUES.includes(value)) {
        throw raise.ANSWER_INVALID(`题号 ${q} 的取值非法：${String(value)}`);
      }
      if (value === 'A') a++;
      else b++;
    }
    // 同分取 A 端：a >= b 已覆盖 a === b 的情形
    return a >= b ? 'A' : 'B';
  }).join('');
}

/**
 * 原型码 → 原型展示信息。
 * @param {string} code 4 位原型码
 * @returns {{code:string, id:string, name:string, symbolId:string}}
 * @throws {DomainError} ANSWER_INVALID（原型码非法）
 */
function resolveArchetype(code) {
  const entry = ARCHETYPES[code];
  if (!entry) throw raise.ANSWER_INVALID(`非法原型码：${String(code)}`);
  return { code, id: entry.id, name: entry.name, symbolId: entry.symbolId };
}

/**
 * 逐维度得分明细，用于自检与排查（不参与对外结果）。
 * @param {Record<string, 'A'|'B'>} answers
 * @returns {Array<{dim:string, a:number, b:number, lead:'A'|'B', tied:boolean}>}
 */
function scoreBreakdown(answers) {
  return DIM_ORDER.map((dim) => {
    let a = 0;
    let b = 0;
    for (const q of DIM_QUESTIONS[dim]) {
      if (answers[q] === 'A') a++;
      else b++;
    }
    return { dim, a, b, lead: a >= b ? 'A' : 'B', tied: a === b };
  });
}

module.exports = { scoreArchetype, resolveArchetype, scoreBreakdown, OPTION_VALUES };
