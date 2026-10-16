'use strict';

/**
 * 配对码：生成 / 归一化 / 展示分组
 *
 * 依据：《技术资产》§3.5 + 本计划 §4.4-⑤（用户决策：**明确拒绝**，不做模糊归一化）。
 *
 * 字母表 `ALPHABET` 已去除易混字符 I / L / O / 0 / 1。
 * 实测 `ALPHABET.length === 31`，故码空间为 31^8 ≈ 8.5e11
 * （《技术资产》§3.5 注释写作 32^8 ≈ 1.1e12，底数有误，此处以 ALPHABET.length 计算）。
 */

const crypto = require('crypto');
const {
  ALPHABET,
  CODE_LEN,
  CODE_RETRY_LIMIT,
  CODE_REJECT_REASONS,
} = require('../../shared/constants.js');
const { raise } = require('./errors.js');

/** 从字母表中反推「不在表内」的易混字符，供输入校验复用（与生成器同一套逻辑）。 */
const AMBIGUOUS_CHARS = ['I', 'L', 'O', '0', '1'].filter((ch) => !ALPHABET.includes(ch)).join('');

/** 码空间大小：31^8 ≈ 8.5e11。 */
const CODE_SPACE = ALPHABET.length ** CODE_LEN;

/**
 * 生成一个 8 位配对码。
 * @param {(max:number)=>number} [randomInt] 随机整数源，默认 crypto.randomInt；测试可注入固定序列
 * @returns {string}
 */
function generatePairCode(randomInt = crypto.randomInt) {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/**
 * 归一化用户输入的配对码。
 *
 * 策略（用户已决策）：只做 `trim + toUpperCase + 去空白与连字符`，随后**严格校验**。
 * 含 I / L / O / 0 / 1 等易混字符 → 明确拒绝（AMBIGUOUS_CHARS），不做 O→0、I→1 类模糊映射，
 * 因为 `1` 与 `0` 同时可能源自 `I` 与 `O`，模糊映射不唯一。
 *
 * @param {unknown} input
 * @returns {{ok:true, reason:null, value:string}
 *         | {ok:false, reason:'EMPTY'|'AMBIGUOUS_CHARS'|'INVALID_CODE', value:null, char?:string}}
 */
function normalizePairCode(input) {
  if (typeof input !== 'string') {
    return { ok: false, reason: CODE_REJECT_REASONS[0], value: null };
  }
  const compact = input.replace(/[\s-]/g, '').toUpperCase();
  if (compact === '') {
    return { ok: false, reason: 'EMPTY', value: null };
  }

  for (const ch of compact) {
    if (AMBIGUOUS_CHARS.includes(ch)) {
      return { ok: false, reason: 'AMBIGUOUS_CHARS', value: null, char: ch };
    }
  }
  if (compact.length !== CODE_LEN) {
    return { ok: false, reason: 'INVALID_CODE', value: null };
  }
  for (const ch of compact) {
    if (!ALPHABET.includes(ch)) {
      return { ok: false, reason: 'INVALID_CODE', value: null, char: ch };
    }
  }
  return { ok: true, reason: null, value: compact };
}

/**
 * 展示分组：存储与传输不带分隔符，仅展示时按 4-4 分组。
 * @param {string} code 8 位配对码（不带分隔符）
 * @returns {string} 如 'K7QX-2M9T'
 */
function formatPairCode(code) {
  if (typeof code !== 'string' || code.length !== CODE_LEN) {
    throw raise.ANSWER_INVALID(`配对码应为 ${CODE_LEN} 位，实际 ${String(code)}`);
  }
  const half = CODE_LEN / 2;
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/**
 * 生成一个在 `exists` 判定下未被占用的配对码。
 * 冲突重试上限 `CODE_RETRY_LIMIT`，超出即抛出 SERVER_ERROR（应由运维介入排查）。
 * @param {(code:string)=>boolean} exists 唯一性判定（通常查 pair_code 唯一索引）
 * @param {(max:number)=>number} [randomInt]
 * @returns {string}
 */
function generateUniquePairCode(exists, randomInt = crypto.randomInt) {
  for (let attempt = 0; attempt < CODE_RETRY_LIMIT; attempt++) {
    const code = generatePairCode(randomInt);
    if (!exists(code)) return code;
  }
  throw raise.SERVER_ERROR(`配对码生成连续 ${CODE_RETRY_LIMIT} 次冲突`);
}

module.exports = {
  AMBIGUOUS_CHARS,
  CODE_SPACE,
  generatePairCode,
  generateUniquePairCode,
  normalizePairCode,
  formatPairCode,
};
