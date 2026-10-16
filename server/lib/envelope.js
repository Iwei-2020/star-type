'use strict';

/**
 * 通用响应信封（《技术资产》§6）
 *   { code: 0, msg: 'ok', data: {} }   // code === 0 为成功，非 0 见错误码表
 */

const { ERROR_CODES, ERROR_NAMES } = require('../../shared/constants.js');
const { DomainError } = require('./errors.js');

/** 成功信封。 */
function ok(data) {
  return { code: ERROR_CODES.OK, msg: 'ok', data: data === undefined ? {} : data };
}

/**
 * 失败信封。
 * @param {number} code 数值错误码
 * @param {string} [detail] 用于日志的附加说明；不面向用户
 * @param {object} [meta] 结构化附加信息，挂到 data 上供前端分支
 */
function fail(code, detail, meta) {
  const name = ERROR_NAMES[code] || 'UNKNOWN_ERROR';
  return {
    code,
    msg: detail ? `${name}: ${detail}` : name,
    data: meta === undefined ? null : meta,
  };
}

/**
 * 把任意异常收敛成失败信封。
 * 非 DomainError 一律归为 SERVER_ERROR（3001），避免把内部细节泄漏给前端。
 */
function fromError(err) {
  if (err instanceof DomainError) return fail(err.code, err.detail, err.meta);
  return fail(ERROR_CODES.SERVER_ERROR, err && err.message ? String(err.message) : undefined);
}

/** 判断信封是否成功。 */
function isOk(envelope) {
  return !!envelope && envelope.code === ERROR_CODES.OK;
}

module.exports = { ok, fail, fromError, isOk };
