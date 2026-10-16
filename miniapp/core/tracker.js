'use strict';

/**
 * 埋点 SDK
 *
 * 依据：《技术资产》§7（事件与专属字段映射表、上报策略）；PRD 第 9 章；本计划 §4.4-⑨。
 *
 * 设计要点：
 *   - 12 事件 + 7 个公共字段；公共字段由 SDK 自动补齐（`event_id` 客户端生成，作服务端去重键）
 *   - 队列满 `BATCH_SIZE`(10) 条或间隔 `FLUSH_INTERVAL_MS`(5s) 触发批量上报
 *   - 队列上限 `QUEUE_LIMIT`(200)，超出丢最旧
 *   - **上报失败静默**：不抛错、不阻塞主流程；失败的批次保留在队列头部等待下次重试
 *   - 队列为内存态；跨重启补传需持久化，留待第二阶段（本计划 §七「不做」）
 *
 * 事件专属字段取自《技术资产》§7 映射表。此表是客户端 SDK 自身的契约，
 * 不属于计分/同频度常量，故不进入 shared/constants.js（避免与「单一权威实现」的
 * 计分常量混淆；前端隔离门禁黑名单也只覆盖计分相关标识符）。
 */

const {
  EVENTS,
  EVENT_COMMON_FIELDS,
  REPORT_POLICY,
  PAGE_IDS,
  APP_VERSION,
  QUIZ_VERSION,
} = require('../shared/client-constants.js');
const { newId } = require('./id.js');

/** 每个事件的专属字段（《技术资产》§7）。 */
const EVENT_SPECIFIC_FIELDS = {
  page_view: ['page_id', 'entry_source'],
  test_start: ['entry_source'],
  answer_submit: ['question_id', 'option_id', 'question_index', 'elapsed_ms'],
  test_complete: ['archetype_id', 'total_duration_ms', 'answer_count'],
  result_view: ['archetype_id', 'is_revisit'],
  pair_invite_create: ['pair_code', 'archetype_id'],
  pair_invite_accept: ['pair_code'],
  pair_complete: ['pair_code', 'c_count', 'band_label', 'similarity_pct'],
  share_click: ['scene', 'channel'],
  ad_impression: ['ad_type', 'placement'],
  ad_reward: ['ad_type', 'placement', 'ad_scene'],
  session_end: ['duration_ms', 'page_count'],
};

/**
 * @param {object} [options]
 * @param {(events:object[]) => any} [options.transport] 上报通道；省略则 flush 直接跳过（队列保留）
 * @param {() => number} [options.now]
 * @param {(prefix?:string) => string} [options.uuid]
 * @param {() => string} [options.getSessionId]
 * @param {() => string} [options.getUserId]
 * @param {() => string} [options.getNetwork] 由宿主 `getNetworkType` 适配器提供，测试注入固定值
 * @param {{setInterval:Function, clearInterval:Function}} [options.timer]
 * @param {boolean} [options.autoFlush] 是否启用定时触发（默认启用）
 * @param {string} [options.appVersion]
 * @param {string} [options.quizVersion]
 */
function createTracker(options) {
  const opts = options || {};
  const transport = opts.transport || null;
  const now = opts.now || Date.now;
  const uuid = opts.uuid || (() => newId('evt'));
  const getSessionId = opts.getSessionId || (() => '');
  const getUserId = opts.getUserId || (() => '');
  const getNetwork = opts.getNetwork || (() => 'unknown');
  const timer = opts.timer || { setInterval, clearInterval };
  const autoFlush = opts.autoFlush !== false;
  const appVersion = opts.appVersion || APP_VERSION;
  const quizVersion = opts.quizVersion || QUIZ_VERSION;

  const queue = [];
  let dropped = 0;
  let rejected = 0;
  let sent = 0;
  let flushing = null;
  let intervalId = null;

  /** 取公共字段。任何 provider 抛错都降级为空值，绝不冒泡。 */
  function commonFields() {
    const safe = (fn, fallback) => {
      try {
        const value = fn();
        return value === undefined || value === null || value === '' ? fallback : value;
      } catch (err) {
        return fallback;
      }
    };
    return {
      event_id: uuid(),
      session_id: safe(getSessionId, ''),
      user_pseudo_id: safe(getUserId, ''),
      app_version: appVersion,
      quiz_version: quizVersion,
      ts: safe(now, 0),
      network: safe(getNetwork, 'unknown'),
    };
  }

  /** 校验事件名与专属字段。返回原因字符串或 null。 */
  function validate(name, payload) {
    if (!EVENTS.includes(name)) return 'UNKNOWN_EVENT';
    const required = EVENT_SPECIFIC_FIELDS[name] || [];
    for (const field of required) {
      const value = payload[field];
      if (value === undefined || value === null) return `MISSING_FIELD:${field}`;
    }
    if (name === 'page_view' && !PAGE_IDS.includes(payload.page_id)) return 'INVALID_PAGE_ID';
    return null;
  }

  function trim() {
    while (queue.length > REPORT_POLICY.QUEUE_LIMIT) {
      queue.shift();
      dropped++;
    }
  }

  /**
   * 记录一条事件。
   * @returns {boolean} true 表示已入队；false 表示被丢弃（事件名未知 / 字段缺失 / 页面非法）
   */
  function track(name, payload) {
    try {
      const data = payload || {};
      const reason = validate(name, data);
      if (reason) {
        rejected++;
        return false;
      }
      queue.push(Object.assign({ event_name: name }, commonFields(), data));
      trim();
      if (queue.length >= REPORT_POLICY.BATCH_SIZE) flush();
      return true;
    } catch (err) {
      // 埋点自身异常不得影响 UI
      rejected++;
      return false;
    }
  }

  /**
   * 批量上报。**永不抛错、永不 reject**。
   * @returns {Promise<{flushed:number, failed?:boolean, skipped?:string}>}
   */
  function flush() {
    if (!transport) return Promise.resolve({ flushed: 0, skipped: 'no_transport' });
    if (flushing) return flushing;
    if (queue.length === 0) return Promise.resolve({ flushed: 0 });

    const batch = queue.splice(0, REPORT_POLICY.BATCH_SIZE);
    let attempt;
    try {
      attempt = transport(batch);
    } catch (err) {
      // 同步抛错视为上报失败：批次原样退回队列头部，下次补传
      queue.unshift(...batch);
      trim();
      return Promise.resolve({ flushed: 0, failed: true });
    }

    flushing = Promise.resolve(attempt)
      .then((result) => {
        const failed = result === false || (result && typeof result === 'object' && Number(result.code) !== 0);
        if (failed) {
          // 失败批次保留在队列头部，下次启动或下次触发时补传
          queue.unshift(...batch);
          trim();
          return { flushed: 0, failed: true };
        }
        sent += batch.length;
        return { flushed: batch.length };
      })
      .catch(() => {
        queue.unshift(...batch);
        trim();
        return { flushed: 0, failed: true };
      })
      .then((outcome) => {
        flushing = null;
        return outcome;
      });

    return flushing;
  }

  function startTimer() {
    if (intervalId !== null) return intervalId;
    if (typeof timer.setInterval !== 'function') return null;
    intervalId = timer.setInterval(() => {
      flush();
    }, REPORT_POLICY.FLUSH_INTERVAL_MS);
    return intervalId;
  }

  function stopTimer() {
    if (intervalId === null) return;
    if (timer && typeof timer.clearInterval === 'function') timer.clearInterval(intervalId);
    intervalId = null;
  }

  function reset() {
    stopTimer();
    queue.length = 0;
    dropped = 0;
    rejected = 0;
    sent = 0;
    flushing = null;
  }

  if (autoFlush) startTimer();

  return {
    track,
    flush,
    /** 等待当前批次（含手动触发）落定，便于单测断言。 */
    flushNow: () => flush(),
    startTimer,
    stopTimer,
    reset,
    size: () => queue.length,
    pending: () => queue.slice(),
    stats: () => ({ queued: queue.length, sent, dropped, rejected }),
    eventSpec: EVENT_SPECIFIC_FIELDS,
  };
}

module.exports = { createTracker, EVENT_SPECIFIC_FIELDS };
