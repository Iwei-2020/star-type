'use strict';

/**
 * 云函数入口：computeResult（薄壳）
 *
 * 本文件只做「事件 → 参数 → handler」的转接，业务逻辑全在 server/lib/handlers.js。
 * 部署形态：抖音云函数服务；产物由 `node tools/gen-cloud-functions.js` 打包为自包含单文件
 * （build/cloud-functions/star-type-api/computeResult.js）后覆盖云端同名平铺文件，调用路径即文件名。
 *
 * 已落地(D-1)：store 由 store-provider.js 按环境选择 —— 云库优先，不可用降级内存并**显式告警**
 *   （云函数为多实例，内存实现不保证跨实例可见，**不适用于生产**）。
 */

const { createRuntimeStore } = require('../../lib/store-provider.js');
const { computeResult } = require('../../lib/handlers.js');

// 懒初始化：首次调用时选 store（本地/单测无官方 SDK 时自动降级并告警）
let store = null;

/**
 * 入口签名对齐平台契约（已与线上函数服务核对）：`params` 即 HTTP 请求体本身，
 * 返回值作为 Response Body；调用路径 = 文件名，即 `/computeResult`。
 */
module.exports = async function main(params, context) {
  if (!store) store = createRuntimeStore(context);
  return computeResult(params || {}, { store, now: Date.now });
};
