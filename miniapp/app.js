'use strict';

/**
 * 小程序入口（骨架）
 *
 * 依据：《技术资产》§3.4（会话机）、§4（前端工程结构与预下载策略）、§7（埋点），
 * 实施计划 §4.4-④（落地路由）与 §五.5（本阶段页面只做骨架，不含视觉还原）。
 *
 * 职责只有三件：
 *   1. 装配本地能力：存储 → 会话机 → 埋点 SDK（依赖全部经适配器注入，便于 Node 下单测）；
 *   2. 解析落地路由：把启动 query 交给 core/route.js，得出应进入的页面与需挂起的配对码；
 *   3. 给页面提供统一的 page_view 上报入口 `reportPageView`。
 *
 * 刻意不做（实施计划 §七）：真实上报通道（transport 留空）、视觉还原、云函数调用。
 */

const { createStorage } = require('./core/storage.js');
const { createSession } = require('./core/session.js');
const { createTracker } = require('./core/tracker.js');
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
    /** core/route.js 的解析结果：{ page, params, pendingPairCode, entrySource, code } */
    entry: null,
  },

  onLaunch(options) {
    primeNetworkType();

    const storage = createStorage(HOST && typeof HOST.getStorageSync === 'function' ? HOST : null);
    const session = createSession(storage, { questionIds: questionIds() });

    const tracker = createTracker({
      transport: null, // 上报通道留空：本阶段不接真实端点，事件留在队列内（实施计划 §七）
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
    this.globalData.entry = entry;
  },

  /**
   * 页面统一的 page_view 上报入口。
   * tracker 未就绪（如异常启动路径）时静默返回 false，绝不打断页面渲染。
   * @param {string} pageId 取自 core/route.js 的 PAGES
   * @param {object} [extra] 追加字段（本阶段未使用，保留给 P-04 的 is_revisit 等）
   */
  reportPageView(pageId, extra) {
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
