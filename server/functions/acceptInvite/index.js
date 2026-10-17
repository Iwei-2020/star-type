'use strict';

/**
 * 云函数入口：acceptInvite（薄壳）
 * 业务逻辑见 server/lib/handlers.js。部署形态见《技术资产》§6（产物 build/cloud-functions/<函数名>.js）。
 *
 * TODO(D-1)：store 需替换为平台数据库实现（多实例共享），内存实现仅用于本地与集成测试。
 */

const { createStore } = require('../../lib/store.js');
const { acceptInvite } = require('../../lib/handlers.js');

const store = createStore();

/**
 * 入口签名对齐平台契约（已与线上函数服务核对）：`params` 即 HTTP 请求体本身，
 * 返回值作为 Response Body；调用路径 = 文件名，即 `/acceptInvite`。
 */
module.exports = async function main(params) {
  return acceptInvite(params || {}, { store, now: Date.now });
};
