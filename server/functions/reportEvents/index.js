'use strict';

/**
 * 云函数入口：reportEvents（薄壳）
 * 业务逻辑见 server/lib/handlers.js。部署形态见《技术资产》§6（产物 build/cloud-functions/<函数名>.js）。
 *
 * 已落地(D-1)：store 由 store-provider.js 按环境选择（云库优先，降级内存并告警）；
 *   事件的 `_id` 即 event_id，服务端天然按 event_id 去重。真实埋点落库通道本阶段不接入。
 */

const { createRuntimeStore } = require('../../lib/store-provider.js');
const { reportEvents } = require('../../lib/handlers.js');

let store = null;

/**
 * 入口签名对齐平台契约（已与线上函数服务核对）：`params` 即 HTTP 请求体本身，
 * 返回值作为 Response Body；调用路径 = 文件名，即 `/reportEvents`。
 */
module.exports = async function main(params, context) {
  if (!store) store = createRuntimeStore(context);
  return reportEvents(params || {}, { store, now: Date.now });
};
