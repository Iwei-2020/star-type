'use strict';

/**
 * 运行时 store 选择
 *
 * 云函数为**多实例**，必须用云数据库才能保证跨实例可见；内存实现仅用于本地与集成测试。
 * 策略（《技术资产》§12、《待确认项台账》D-1）：
 *   1) **懒加载**官方 SDK `@open-dy/node-server-sdk`：本地 / 单测环境通常未安装该依赖，
 *      顶层 `require` 会让 `npm test` 直接挂掉；改为入口首次调用时再加载。
 *   2) 云数据库可用 → 用云库（store-cloud.js）。
 *   3) 不可用 → 降级为内存 store，并**显式告警**（禁止静默降级，避免线上丢状态无从察觉）。
 */

const { createStore } = require('./store.js');
const { createCloudStore } = require('./store-cloud.js');

/** 默认 SDK 加载器。外部依赖，打包器不改写；由云端 package.json 声明并由平台安装。 */
function loadDefaultSDK() {
  return require('@open-dy/node-server-sdk');
}

/** 取告警输出通道：优先平台运行时的 context.warn，回落到 console.warn。 */
function pickWarn(context) {
  if (context && typeof context.warn === 'function') return context.warn.bind(context);
  if (context && typeof context.log === 'function') return context.log.bind(context);
  return console.warn.bind(console);
}

/**
 * @param {object} [context] 云函数运行时上下文（仅供告警输出）
 * @param {()=>object} [loadSDK] SDK 加载器，默认官方 SDK；单测注入以模拟「可用 / 不可用」
 * @returns {object} store 实例（云库或内存）
 */
function createRuntimeStore(context, loadSDK = loadDefaultSDK) {
  try {
    const sdk = loadSDK();
    const dySDK = sdk.dySDK || sdk.default || sdk;
    if (!dySDK || typeof dySDK.database !== 'function') {
      throw new Error('SDK 未暴露 dySDK.database()');
    }
    return createCloudStore(dySDK);
  } catch (err) {
    pickWarn(context)(
      `[store] 云数据库不可用，已降级为内存 store（多实例下不保证一致，不适用于生产）：${err && err.message}`
    );
    return createStore();
  }
}

module.exports = { createRuntimeStore };
