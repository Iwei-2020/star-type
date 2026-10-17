'use strict';

/**
 * 云函数入口：computeResult（薄壳）
 *
 * 本文件只做「事件 → 参数 → handler」的转接，业务逻辑全在 server/lib/handlers.js。
 * 部署形态：抖音云函数服务；产物由 `node tools/gen-cloud-functions.js` 打包为自包含单文件
 * （build/cloud-functions/computeResult.js）后覆盖云端同名平铺文件，调用路径即文件名。
 *
 * TODO(D-1)：云函数为多实例，store 必须换成平台数据库实现并保证跨实例可见；
 *   当前内存实现仅用于本地与集成测试，**不适用于生产**。
 */

const { createStore } = require('../../lib/store.js');
const { computeResult } = require('../../lib/handlers.js');

const store = createStore();

/**
 * 入口签名对齐平台契约（已与线上函数服务核对）：`params` 即 HTTP 请求体本身，
 * 返回值作为 Response Body；调用路径 = 文件名，即 `/computeResult`。
 */
module.exports = async function main(params) {
  return computeResult(params || {}, { store, now: Date.now });
};
