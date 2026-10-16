'use strict';

/**
 * 云函数入口：completePair（薄壳）
 * 业务逻辑见 server/lib/handlers.js。部署配置待 D-1 闭环后补齐。
 *
 * 注意：本接口入参**不含答案**，只读双方已落库的 archetype_code，
 * 因此不构成第二计分入口（《技术资产》§1.2 单一权威实现）。
 *
 * TODO(D-1)：store 需替换为平台数据库实现（多实例共享），内存实现仅用于本地与集成测试。
 */

const { createStore } = require('../../lib/store.js');
const { completePair } = require('../../lib/handlers.js');

const store = createStore();

module.exports = async function main(event) {
  const params = event && event.params ? event.params : event;
  return completePair(params, { store, now: Date.now });
};
