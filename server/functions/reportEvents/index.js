'use strict';

/**
 * 云函数入口：reportEvents（薄壳）
 * 业务逻辑见 server/lib/handlers.js。部署配置待 D-1 闭环后补齐。
 *
 * TODO(D-1)：store 需替换为平台数据库实现（多实例共享），内存实现仅用于本地与集成测试；
 *   真实埋点还需落库通道与上报端点，本阶段不接入（见计划第七节）。
 */

const { createStore } = require('../../lib/store.js');
const { reportEvents } = require('../../lib/handlers.js');

const store = createStore();

module.exports = async function main(event) {
  const params = event && event.params ? event.params : event;
  return reportEvents(params, { store, now: Date.now });
};
