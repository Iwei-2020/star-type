'use strict';

/**
 * 云函数入口：completePair（薄壳）
 * 业务逻辑见 server/lib/handlers.js。部署形态见《技术资产》§6（产物 build/cloud-functions/star-type-api/<函数名>.js）。
 *
 * 注意：本接口入参**不含答案**，只读双方已落库的 archetype_code，
 * 因此不构成第二计分入口（《技术资产》§1.2 单一权威实现）。
 *
 * 已落地(D-1)：store 由 store-provider.js 按环境选择（云库优先，降级内存并告警）；
 *   云库无跨文档事务，幂等由 completePair 的「已完成即返回首结果」分支保证。
 */

const { createRuntimeStore } = require('../../lib/store-provider.js');
const { completePair } = require('../../lib/handlers.js');

let store = null;

/**
 * 入口签名对齐平台契约（已与线上函数服务核对）：`params` 即 HTTP 请求体本身，
 * 返回值作为 Response Body；调用路径 = 文件名，即 `/completePair`。
 */
module.exports = async function main(params, context) {
  if (!store) store = createRuntimeStore(context);
  return completePair(params || {}, { store, now: Date.now });
};
