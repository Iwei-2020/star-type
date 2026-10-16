'use strict';

/**
 * 云函数入口：computeResult（薄壳）
 *
 * 本文件只做「事件 → 参数 → handler」的转接，业务逻辑全在 server/lib/handlers.js。
 * 真实部署形态（运行时、依赖声明、超时与内存配额、数据库绑定）待 D-1 技术适配口径闭环后补齐，
 * 故本阶段不含任何部署配置。
 *
 * TODO(D-1)：云函数为多实例，store 必须换成平台数据库实现并保证跨实例可见；
 *   当前内存实现仅用于本地与集成测试，**不适用于生产**。
 */

const { createStore } = require('../../lib/store.js');
const { computeResult } = require('../../lib/handlers.js');

const store = createStore();

module.exports = async function main(event) {
  const params = event && event.params ? event.params : event;
  return computeResult(params, { store, now: Date.now });
};
