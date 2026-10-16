'use strict';

/**
 * 领域错误
 *
 * 把常量表中的错误码包成 Error 子类，使抛错点与错误码表解耦：
 * 计算层只抛 `ANSWER_INCOMPLETE`，由 envelope.js 统一映射成响应信封。
 * `message` 保持为错误码语义名（与《技术资产》§3.1 伪代码的 `throw new Error('ANSWER_INCOMPLETE')` 一致），
 * 同时在 `err.code` 上挂数值码，供接口层使用。
 */

const { ERROR_CODES, ERROR_NAMES } = require('../../shared/constants.js');

class DomainError extends Error {
  /**
   * @param {number} code 数值错误码（见 ERROR_CODES）
   * @param {string} [detail] 附加说明，用于日志定位，不面向用户
   * @param {object} [meta] 附加结构化信息（如拒绝原因），供前端分支使用
   */
  constructor(code, detail, meta) {
    const name = ERROR_NAMES[code] || 'UNKNOWN_ERROR';
    super(detail ? `${name}: ${detail}` : name);
    this.name = 'DomainError';
    this.code = code;
    this.codeName = name;
    this.detail = detail === undefined ? null : detail;
    this.meta = meta === undefined ? null : meta;
  }
}

/** 按语义名构造错误的快捷入口，避免各处硬编码数值码。 */
const raise = Object.fromEntries(
  Object.entries(ERROR_CODES).map(([name, code]) => [
    name,
    (detail, meta) => new DomainError(code, detail, meta),
  ])
);

module.exports = { DomainError, raise };
