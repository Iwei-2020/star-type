'use strict';

/**
 * P-04 结果页
 *
 * 依据：《美术资产-全流程视觉P01-P06线稿说明》§5（结果卡元素清单 5.2 / 状态变体 5.4）。
 * 位于分包 packageQuiz（app.json 声明）。结果数据一律来自**服务端** computeResult 落库后由本地
 * `st_result` 缓存读取（技术资产 §3.4：结果页重入以缓存为准），前端不做任何计分或同频度计算
 * —— 见技术资产 §1.2「单一权威实现」。
 *
 * 三态状态机（美术资产 §5.4）：
 *   loading  无本地结果缓存时先呈现「计算中」
 *   failed   占位时长内仍无结果则转「计算失败」，给出重新生成入口
 *   result   本地已缓存结果，直接呈现结果卡
 *
 * 本阶段边界（实施计划 §七）：云函数 computeResult 未接入（app.js 的 transport 为 null），
 * 故「计算中」是固定占位时长、**不会真正取回结果**；要让结果卡可见，联调时在开发者工具
 * Storage 面板写入一条合法 `st_result` 即可（见交付说明）。接入云函数后，此处应改为按
 * 技术资产 §3.4 的退避重试（1s / 3s / 8s，最多 3 次）驱动这三态。
 *
 * 素材位（美术资产 §5.2 / §5.4）：结果卡符号区 = 原型符号本图 + 星芒光晕（装饰库 C-3）；
 * 计算中 / 计算失败符号区 = 环状光晕（装饰库 C-2，加载态指定素材，失败态整体降到 38% 不透明度），
 * 骨架条与文案由页面自绘，不使用图标库素材。
 */

const { PAGES } = require('../../../core/route.js');
const display = require('../../../core/display.js');
const assets = require('../../../shared/assets.js');
const { layerStyle } = require('../../../core/art.js');

/** 「计算中」占位时长：无上报通道阶段的过渡，接入 computeResult 后由真实请求驱动。 */
const PENDING_COMPUTE_MS = 900;

Page({
  data: {
    /** loading | failed | result */
    state: 'loading',
    stateTitle: '',
    stateText: '',
    stateCta: '',
    /** 非结果态符号区的背景（环状光晕） */
    zoneStyle: '',
    // ── 结果卡字段（全部来自 st_result + 构建期产物，页面不拼文案）──
    name: '',
    code: '',
    imagery: '',
    imageryLabel: '',
    summary: '',
    traits: [],
    relationHint: '',
    relationLabel: '',
    sigilStyle: '',
    ctaInvite: '',
    ctaShare: '',
    // ── 分享弹窗 ──
    shareVisible: false,
    /** 分享卡预览上的配对码：需 createInvite 返回，本阶段未接入，恒为空 */
    pairCode: '',
  },

  onLoad() {
    this.app = typeof getApp === 'function' ? getApp() : null;
    /** 本页实例内是否已跑过一次「计算」：返回本页时不重复闪烁（onRetry 显式重跑） */
    this.settled = false;
    this.timer = null;

    this.setData({
      imageryLabel: display.ui('result.imageryLabel'),
      relationLabel: display.ui('result.relationLabel'),
      ctaInvite: display.ui('result.ctaInvite'),
      ctaShare: display.ui('result.ctaShare'),
    });
  },

  onShow() {
    if (this.app && typeof this.app.reportPageView === 'function') {
      this.app.reportPageView(PAGES.RESULT);
    }

    const cached = this.readResult();
    if (cached) {
      this.renderResult(cached);
      return;
    }
    if (this.settled) return;
    this.runCompute();
  },

  onHide() {
    this.clearTimer();
  },

  onUnload() {
    this.clearTimer();
  },

  session() {
    return this.app && this.app.globalData ? this.app.globalData.session : null;
  },

  readResult() {
    const session = this.session();
    return session && typeof session.readResult === 'function' ? session.readResult() : null;
  },

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },

  /** 走一次「计算」：先呈现计算中，占位时长后仍无结果则转计算失败。 */
  runCompute() {
    this.settled = true;
    this.clearTimer();
    this.setState('loading');
    this.timer = setTimeout(() => {
      this.timer = null;
      this.setState('failed');
    }, PENDING_COMPUTE_MS);
  },

  setState(state) {
    // 「计算中」与「计算失败」共用同一符号区素材（环状光晕），差异只在不透明度与文字
    const zoneStyle = layerStyle([{ src: assets.DECOR['C-2'] }]);

    if (state === 'loading') {
      this.setData({
        state,
        stateTitle: display.ui('result.loadingTitle'),
        stateText: display.ui('result.loadingSub'),
        stateCta: display.ui('result.loadingCta'),
        zoneStyle,
      });
      return;
    }

    this.setData({
      state: 'failed',
      stateTitle: display.ui('result.failTitle'),
      stateText: display.ui('result.failText'),
      stateCta: display.ui('result.failCta'),
      zoneStyle,
    });
  },

  /** 结果卡装配。原型码非法（缓存被改 / 跨版本残留）时退回失败态，不渲染半张卡。 */
  renderResult(cached) {
    const found = display.archetype(cached.archetype_code);
    if (!found) {
      this.settled = true;
      this.setState('failed');
      return;
    }

    this.clearTimer();
    this.setData({
      state: 'result',
      name: found.name,
      code: found.code,
      imagery: found.symbol,
      summary: found.summary,
      traits: found.traits,
      relationHint: found.relationHint,
      sigilStyle: layerStyle([
        { src: assets.SYMBOLS[found.code] },
        { src: assets.DECOR['C-3'], size: '132% 132%' },
      ]),
    });
  },

  /** 重新生成：显式重跑一次（美术资产 §5.4 计算失败态的重试入口）。 */
  onRetry() {
    this.runCompute();
  },

  /** 邀请好友配对：进入 P-05 的发起侧视图（配对码待 createInvite 接入后回填）。 */
  onInvite() {
    this.go('/packagePair/pages/pair/index?invite=1');
  },

  onShare() {
    this.setData({ shareVisible: true });
  },

  onShareClose() {
    this.setData({ shareVisible: false });
  },

  /**
   * 分享渠道拉起（美术资产 §7.3：渠道拉起失败仅弱提示 toast，不改变弹窗状态）。
   * 渠道形参与可用性以平台侧为准（PRD 7.2 注），此处只做可降级的调用，不编造枚举。
   */
  onShareChannel(event) {
    const channel = event && event.detail ? event.detail.channel : '';
    if (!channel) return;

    if (channel === 'copy_code') {
      if (!this.data.pairCode) return; // 无配对码可复制：静默返回
      this.copyText(this.data.pairCode);
      return;
    }
    if (channel === 'friend' || channel === 'group') {
      this.shareCard();
      return;
    }
    // save_image：需 canvas 合成方形分享卡（美术资产 §5.2），留待分享卡合成阶段
  },

  copyText(text) {
    if (typeof tt === 'undefined' || !tt || typeof tt.setClipboardData !== 'function') return;
    try {
      tt.setClipboardData({ data: String(text) });
    } catch (err) {
      /* 静默：剪贴板失败不影响弹窗状态 */
    }
  },

  /** 拉起平台分享面板；带配对码时才附回落参数（PRD 7.2：好友渠道携带 code → P-05）。 */
  shareCard() {
    if (typeof tt === 'undefined' || !tt || typeof tt.shareAppMessage !== 'function') return;
    const payload = {
      title: this.data.name,
      desc: this.data.imagery,
    };
    if (this.data.pairCode) payload.query = `code=${this.data.pairCode}`;
    try {
      tt.shareAppMessage(payload);
    } catch (err) {
      /* 静默：分享面板拉起失败不改动弹窗 */
    }
  },

  /** 弹窗「去邀请配对」：关闭弹窗后进入 P-05 发起侧。 */
  onShareInvite() {
    this.setData({ shareVisible: false });
    this.onInvite();
  },

  /** 弹窗「再测一次」：清掉本次会话与结果缓存后重新答题（重测将产生新的 session_id）。 */
  onShareRetry() {
    this.setData({ shareVisible: false });
    const session = this.session();
    if (session) {
      if (typeof session.reset === 'function') session.reset();
      if (typeof session.clearResult === 'function') session.clearResult();
    }
    this.settled = false;
    this.go('/packageQuiz/pages/quiz/index');
  },

  go(url) {
    if (typeof tt !== 'undefined' && tt && typeof tt.navigateTo === 'function') {
      tt.navigateTo({ url });
    }
  },
});
