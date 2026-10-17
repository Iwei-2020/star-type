'use strict';

/**
 * 云函数调用适配器
 *
 * 依据：《技术资产》§6（接口契约与统一信封）、§3.4（失败退避重试）；
 * 《平台规则检索记录》R-8（2026-10-17 检索：平台官方后端载体为**抖音云**，
 * 小程序侧调用形态为 `tt.createCloud` + `Cloud.callContainer`，登录由云托管服务端
 * 从请求 header 直接取得用户身份，即「免登录」）。
 *
 * 为什么要有这一层：载体形态一旦变化（抖音云函数服务 / 云托管 / 自建 HTTP 服务），
 * 「怎么调」就不一样。若把调用方式散落到 P-04 / P-05 里，换载体就要改页面。故此处收敛两点：
 *   1. **调用器（invoker）**：默认按平台官方形态构造 —— 宿主具备 `tt.createCloud` 且注入了
 *      `envID` 时，经 `cloud.callContainer({ path, init })` 调用，函数名即路径（约定 `/函数名`）；
 *      亦支持外部注入 invoker（Node 单测 / 自建服务端）。两者都不可用时视为无能力；
 *   2. **信封解析**：服务端统一返回 `{ code, msg, data }`（server/lib/envelope.js）。
 *      `Cloud.callContainer` 的 `data` 是 **JSON 字符串**（R-8），此处负责 parse 后归一，
 *      页面层只看到 `{ ok, code, msg, data }`。
 *
 * 平台**没有** `tt.cloud.callFunction` / `tt.callFunction` 形态（R-8 已比对官方原文），故不在此臆造；
 * 也不需要 `tt.login` + `code2Session` 置换身份 —— 云托管服务端可直接从 header 读到
 * `X-TT-OPENID` 等字段（免登录）。身份链路不在本适配器职责内，此处只透传业务参数。
 *
 * 无调用能力时 `available()` 为 false，页面与埋点各自降级（app.js 不接 transport、
 * P-04 直接进计算失败态），绝不抛出、绝不阻断渲染。
 */

const { ERROR_CODES } = require('../shared/client-constants.js');

/** 云托管路由约定：函数名 → `callContainer` 的 path（对应的服务端薄壳见 server/functions/）。 */
function pathOf(name) {
  return `/${name}`;
}

/**
 * 按平台官方形态构造调用器（抖音云，R-8）：`tt.createCloud({ envID, serviceID })`
 * → `Cloud.callContainer({ path, init })`；小程序最低基础库 2.70.0。
 * 宿主无 `createCloud`、未注入 envID、或实例不提供 `callContainer` 时返回 null
 * —— 视为无调用能力，由调用方走降级分支，绝不抛错。
 * @param {object|null} host 抖音小程序为全局 tt
 * @param {{envID?:string, serviceID?:string}} [config] 云托管接入配置（抖音云控制台取得）
 * @returns {null | ((name:string, params:object) => Promise<*|never>)}
 */
function resolveInvoker(host, config) {
  if (!host || typeof host.createCloud !== 'function') return null;
  const envID = (config && config.envID) || '';
  if (!envID) return null;

  let cloud;
  try {
    cloud = host.createCloud({ envID, serviceID: (config && config.serviceID) || '' });
  } catch (err) {
    return null;
  }
  if (!cloud || typeof cloud.callContainer !== 'function') return null;

  return (name, params) =>
    new Promise((resolve, reject) => {
      cloud.callContainer({
        path: pathOf(name),
        init: {
          method: 'POST',
          header: { 'content-type': 'application/json' },
          body: params || {},
        },
        success: (res) => resolve(res),
        fail: (err) => reject(new Error((err && err.errMsg) || 'callContainer_failed')),
      });
    });
}

/**
 * 依据平台运行时环境挑选云托管接入配置 —— 同一小程序有 dev / prod 两套云环境，须一次配置、自动切换。
 * 判据：`tt.getEnvInfoSync().microapp.envType`（基础库 ≥ 2.21.0；合法值 `production` 线上版 /
 * `development` 测试版 / `preview` 预览版）。
 * **取不到该能力、或取值不认识时一律按 prod 兜底**：宁可连线上，也绝不让线上流量误连测试环境。
 * @param {object|null} host 抖音小程序为全局 tt
 * @param {{dev?:object, prod?:object}} targets 环境名 → 接入配置（`{ envID, serviceID }`）
 * @returns {object|null} 命中的接入配置；targets 缺失 prod 时返回 null
 */
function resolveCloudEnv(host, targets) {
  if (!targets || typeof targets !== 'object') return null;
  const NON_PROD = ['development', 'preview'];

  let envType = '';
  if (host && typeof host.getEnvInfoSync === 'function') {
    try {
      const info = host.getEnvInfoSync() || {};
      // 官方为 microapp.envType；此处兼容扁平与历史小写写法，判据缺失即按 prod 兜底
      const app = info.microapp || info;
      envType = app.envType || app.envtype || '';
    } catch (err) {
      envType = '';
    }
  }

  if (NON_PROD.indexOf(envType) >= 0 && targets.dev) return targets.dev;
  return targets.prod || null;
}

/**
 * 把平台返回归一成统一信封 `{ code, msg, data }`；形态不可识别时返回 null。
 * 兼容三种包裹（R-8 与历史骨架共用一条解析路径）：
 *   1. 抖音云 `callContainer` 的原始返回 `{ statusCode, header, data }`——`data` 为 JSON 字符串；
 *   2. 直返信封；
 *   3. 包一层 `result`。
 */
function unwrap(out) {
  let value = out;
  if (value && typeof value === 'object' && value.statusCode !== undefined && value.data !== undefined) {
    if (typeof value.data !== 'string') {
      value = value.data;
    } else {
      try {
        value = JSON.parse(value.data);
      } catch (err) {
        return null;
      }
    }
  }
  if (value && typeof value === 'object' && value.result !== undefined) value = value.result;
  if (!value || typeof value !== 'object') return null;
  if (value.code === undefined || value.code === null) return null;
  return {
    code: value.code,
    msg: value.msg === undefined || value.msg === null ? '' : String(value.msg),
    data: value.data === undefined ? null : value.data,
  };
}

/**
 * @param {{host?:object, envID?:string, serviceID?:string, invoker?:Function|null}} [options]
 *   - host：宿主对象，默认由调用方传入全局 tt；
 *   - envID / serviceID：抖音云接入配置，用于按平台官方形态构造调用器（R-8）；
 *   - invoker：显式注入的调用器（优先于上述两者）；显式传 null 表示「强制无能力」，用于测试降级路径。
 */
function createCloud(options) {
  const opts = options || {};
  const invoker = opts.invoker !== undefined ? opts.invoker : resolveInvoker(opts.host, opts);

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

module.exports = { createCloud, resolveInvoker, resolveCloudEnv, unwrap };
