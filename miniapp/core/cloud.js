'use strict';

/**
 * 云函数调用适配器
 *
 * 依据：《技术资产》§6（云函数接口契约与统一信封）、§3.4（失败退避重试）。
 *
 * 为什么要有这一层：服务端的**产品载体形态属 D-1 待平台侧复核**（技术资产 L39），
 * 官方 Serverless / 云托管 / 第三方云函数在「怎么调」上并不一致。若把调用方式散落到
 * P-04 / P-05 里，载体一变就要改页面。故此处把平台差异收敛成两点：
 *   1. **调用器（invoker）**：从宿主对象探测（tt.cloud.callFunction / tt.callFunction），
 *      或由外部注入（便于 Node 下单测，也能在选型确定后一行替换）；
 *   2. **信封解析**：服务端统一返回 `{ code, msg, data }`（server/lib/envelope.js），
 *      平台可能再包一层 `result`，此处归一，页面层只看到 `{ ok, code, msg, data }`。
 *
 * 无调用能力时 `available()` 为 false，页面与埋点各自降级（app.js 不接 transport、
 * P-04 直接进计算失败态），绝不抛出、绝不阻断渲染。
 */

const { ERROR_CODES } = require('../shared/client-constants.js');

/**
 * 从宿主对象解析可用的云函数调用器。
 * @param {object|null} host 抖音小程序为全局 tt
 * @returns {null | ((name:string, params:object) => any)}
 */
function resolveInvoker(host) {
  if (!host) return null;
  if (host.cloud && typeof host.cloud.callFunction === 'function') {
    return (name, params) => host.cloud.callFunction({ name, data: params });
  }
  if (typeof host.callFunction === 'function') {
    return (name, params) => host.callFunction({ name, data: params });
  }
  return null;
}

/**
 * 把平台返回归一成统一信封 `{ code, msg, data }`；形态不可识别时返回 null。
 * 兼容两种常见包裹：直接返回信封，或包一层 `result`。
 */
function unwrap(out) {
  const value = out && typeof out === 'object' && out.result !== undefined ? out.result : out;
  if (!value || typeof value !== 'object') return null;
  if (value.code === undefined || value.code === null) return null;
  return {
    code: value.code,
    msg: value.msg === undefined || value.msg === null ? '' : String(value.msg),
    data: value.data === undefined ? null : value.data,
  };
}

/**
 * @param {{host?:object, invoker?:Function|null}} [options]
 *   - host：宿主对象，默认由调用方传入全局 tt；
 *   - invoker：显式注入的调用器；显式传 null 表示「强制无能力」，用于测试降级路径。
 */
function createCloud(options) {
  const opts = options || {};
  const invoker = opts.invoker !== undefined ? opts.invoker : resolveInvoker(opts.host);

  /** 当前宿主是否具备真实调用能力；false 时各处须走降级分支。 */
  function available() {
    return typeof invoker === 'function';
  }

  /**
   * 调一次云函数。**永不抛出、永不 reject**——网络与平台异常一律收敛为失败结果。
   * @returns {Promise<{ok:boolean, code:(number|string), msg:string, data:*}>}
   */
  function call(name, params) {
    if (!available()) {
      return Promise.resolve({ ok: false, code: 'NO_INVOKER', msg: 'no_cloud_invoker', data: null });
    }

    let pending;
    try {
      pending = invoker(name, params || {});
    } catch (err) {
      return Promise.resolve({
        ok: false,
        code: ERROR_CODES.SERVER_ERROR,
        msg: err && err.message ? String(err.message) : 'invoke_threw',
        data: null,
      });
    }

    return Promise.resolve(pending).then(
      (out) => {
        const envelope = unwrap(out);
        if (!envelope) {
          return { ok: false, code: ERROR_CODES.SERVER_ERROR, msg: 'invalid_envelope', data: null };
        }
        return {
          ok: envelope.code === ERROR_CODES.OK,
          code: envelope.code,
          msg: envelope.msg,
          data: envelope.data,
        };
      },
      (err) => ({
        ok: false,
        code: ERROR_CODES.SERVER_ERROR,
        msg: err && err.message ? String(err.message) : 'invoke_failed',
        data: null,
      })
    );
  }

  // 六个云函数薄壳（见 server/functions/）。入参直接透传，语义校验在服务端。
  return {
    available,
    call,
    computeResult: (params) => call('computeResult', params),
    createInvite: (params) => call('createInvite', params),
    acceptInvite: (params) => call('acceptInvite', params),
    getPairStatus: (params) => call('getPairStatus', params),
    completePair: (params) => call('completePair', params),
    reportEvents: (params) => call('reportEvents', params),
  };
}

module.exports = { createCloud, resolveInvoker, unwrap };
