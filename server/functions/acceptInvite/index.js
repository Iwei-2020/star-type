'use strict';

/**
 * 云函数入口：acceptInvite（薄壳）
 * 业务逻辑见 server/lib/handlers.js。部署配置待 D-1 闭环后补齐。
 *
 * TODO(D-1)：store 需替换为平台数据库实现（多实例共享），内存实现仅用于本地与集成测试。
 */

const { createStore } = require('../../lib/store.js');
const { acceptInvite } = require('../../lib/handlers.js');

const store = createStore();

module.exports = async function main(event) {
  const params = event && event.params ? event.params : event;
  return acceptInvite(params, { store, now: Date.now });
};
