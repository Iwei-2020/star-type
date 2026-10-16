'use strict';

/**
 * 小程序入口
 *
 * 依据：《技术资产》§3.3（配对状态机）、§3.4（会话机与退避重试）、§4（前端工程结构与预下载策略）、
 * §6（云函数接口契约）、§7（埋点），实施计划 §4.4-④（落地路由）与 §五.5。
 *
 * 职责四件：
 *   1. 装配本地能力：存储 → 会话机 → 云函数适配器 → 埋点 SDK（依赖全部经适配器注入，便于 Node 下单测）；
 *   2. 解析落地路由：把启动 query 交给 core/route.js，得出应进入的页面与需挂起的配对码；
 *   3. 给页面提供统一的 page_view 上报入口 `reportPageView`；
 *   4. 提供对外的云函数适配器 `globalData.cloud`（页面经它调 computeResult 等，不直接摸平台 API）。
 *
 * 关于上报通道：`transport` 仅在宿主具备云函数调用能力时接上（core/cloud.js 的 available()）；
 * 取不到能力时保持 null，埋点事件留在队列内（core/tracker.js 的 no_transport 短路），
 * 与「不接真实端点」的骨架阶段行为一致。服务端载体形态属 D-1 待复核，见 core/cloud.js 顶部说明。
 */

const { createStorage } = require('./core/storage.js');
const { createSession } = require('./core/session.js');
const { createTracker } = require('./core/tracker.js');
const { createCloud } = require('./core/cloud.js');
const { resolveEntry } = require('./core/route.js');
const { questionIds } = require('./core/display.js');

/** 宿主 API：抖音小程序为全局 tt；在 Node 测试或编译期取到的是 null，此时存储降级为内存实现。 */
const HOST = typeof tt !== 'undefined' ? tt : null;

/** `getNetworkType` 为异步接口，启动时取一次并缓存，供埋点公共字段读取。 */
let networkType = 'unknown';

function primeNetworkType() {
  if (!HOST || typeof HOST.getNetworkType !== 'function') return;
  try {
    HOST.getNetworkType({
      success(res) {
        if (res && res.networkType) networkType = res.networkType;
      },
    });
  } catch (err) {
    /* 静默：取不到网络类型不阻断启动，埋点公共字段退化为 unknown（tracker 侧已有兜底） */
  }
}

App({
  globalData: {
    storage: null,
    session: null,
    tracker: null,
    /** core/cloud.js 的适配器：{ available, call, computeResult, createInvite, … } */
    cloud: null,
    /** core/route.js 的解析结果：{ page, params, pendingPairCode, entrySource, code } */
    entry: null,
  },

  onLaunch(options) {
    primeNetworkType();

    const storage = createStorage(HOST && typeof HOST.getStorageSync === 'function' ? HOST : null);
    const session = createSession(storage, { questionIds: questionIds() });
    const cloud = createCloud({ host: HOST });

    const tracker = createTracker({
      // 无云函数能力时保持 null：事件留在队列内（骨架阶段行为），不产生必然失败的空转请求
      transport: cloud.available() ? (events) => cloud.reportEvents({ events }) : null,
      getSessionId: () => session.status().session_id || '',
      getUserId: () => session.getUserId(),
      getNetwork: () => networkType,
    });

    const entry = resolveEntry({
      query: options && options.query,
      hasResult: session.hasResult(),
    });

    // 受邀落地但本人尚无结果：配对码挂起，待本人出结果后再取出并进入 P-05（实施计划 §4.4-④）
    if (entry.pendingPairCode) session.setPendingPair(entry.pendingPairCode);

    this.globalData.storage = storage;
    this.globalData.session = session;
    this.globalData.tracker = tracker;
    this.globalData.cloud = cloud;
    this.globalData.entry = entry;

    this.beginForeground();
  },

  /** 一次前台停留 = 一个埋点会话（onShow/onLaunch 起算，onHide 结算 duration_ms 与 page_count）。 */
  beginForeground() {
    this.foregroundAt = Date.now();
    this.pageCount = 0;
  },

  onShow() {
    this.beginForeground();
  },

  onHide() {
    const tracker = this.globalData.tracker;
    if (!tracker) return;
    tracker.track('session_end', {
      duration_ms: Math.max(0, Date.now() - (this.foregroundAt || Date.now())),
      page_count: Number(this.pageCount) || 0,
    });
    // 退后台时尽力刷一次队列（平台可能随时挂起，失败也无妨——事件仍在队列内）
    if (typeof tracker.flush === 'function') tracker.flush();
  },

  /**
   * 页面统一的 page_view 上报入口。
   * tracker 未就绪（如异常启动路径）时静默返回 false，绝不打断页面渲染。
   * @param {string} pageId 取自 core/route.js 的 PAGES
   * @param {object} [extra] 追加字段（page_view 无额外专属字段，保留扩展位）
   */
  reportPageView(pageId, extra) {
    this.pageCount = (Number(this.pageCount) || 0) + 1;

    const tracker = this.globalData.tracker;
    if (!tracker) return false;

    const entry = this.globalData.entry;
    const payload = {
      page_id: pageId,
      entry_source: (entry && entry.entrySource) || 'direct',
    };
    if (extra) {
      for (const key of Object.keys(extra)) payload[key] = extra[key];
    }
    return tracker.track('page_view', payload);
  },
});
