'use strict';

/**
 * P-04 结果页
 *
 * 依据：《美术资产-全流程视觉P01-P06线稿说明》§5（结果卡元素清单 5.2 / 状态变体 5.4）、
 * 《技术资产》§3.4（提交退避重试）、§6（computeResult / createInvite 契约）、§7（埋点）。
 *
 * 位于分包 packageQuiz（app.json 声明）。结果一律由**服务端** computeResult 产出后经
 * 本地 `st_result` 缓存读取（技术资产 §3.4：结果页重入以缓存为准），前端不做任何计分或
 * 同频度计算 —— 见技术资产 §1.2「单一权威实现」。
 *
 * 三态状态机（美术资产 §5.4）：
 *   loading  已提交、等待服务端返回
 *   failed   退避重试耗尽后仍无结果
 *   result   本地已缓存结果，直接呈现结果卡
 *
 * 提交链路：computeResult（失败按 1s / 3s / 8s 退避重试，最多 3 次）→ 成功即写 `st_result`。
 * 待配对码：受邀落地且本人尚无结果时由 app.js 挂起（`st_pending_pair`），
 * 本次出结果后取出并直接进入 P-05，闭合「受邀 → 自己测 → 看同频图谱」这条链路。
 *
 * 素材位（美术资产 §5.2 / §5.4）：结果卡符号区 = 原型符号本图 + 星芒光晕（装饰库 C-3）；
 * 计算中 / 计算失败符号区 = 环状光晕（装饰库 C-2，失败态整体降到 38% 不透明度），
 * 骨架条与文案由页面自绘，不使用图标库素材。
 */

const { PAGES } = require('../../../core/route.js');
const display = require('../../../core/display.js');
const assets = require('../../../shared/assets.js');
const { layerStyle } = require('../../../core/art.js');

/** 提交失败重试退避（技术资产 §3.4：1s / 3s / 8s，最多 3 次；期间保持「计算中」）。 */
const RETRY_BACKOFF_MS = [1000, 3000, 8000];

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
    /** 本页发起的邀请码：由 createInvite 回填（分享卡预览与「复制配对码」渠道使用） */
    pairCode: '',
  },

  onLoad() {
    this.app = typeof getApp === 'function' ? getApp() : null;
    /** 本页实例内是否已发起过「计算」：返回本页时不重复闪烁（onRetry 显式重跑） */
    this.settled = false;
    /** 已重试次数（对应 RETRY_BACKOFF_MS 的下标） */
    this.retry = 0;
    this.timer = null;
    /** 页面已卸载：异步回调不得再 setData */
    this.stopped = false;
    this.inviteCode = '';
    this.invitePending = null;
    this.reportedResultView = false;
    this.enteredPair = false;

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
      this.renderResult(cached, true);
      return;
    }
    if (this.settled) return;
    this.runCompute();
  },

  onHide() {
    // 退后台即中断退避链；`settled` 复位，使返回本页时能重新发起提交
    this.clearTimer();
    this.settled = false;
  },

  onUnload() {
    this.stopped = true;
    this.clearTimer();
  },

  // ── 依赖取用 ────────────────────────────────────────────────

  session() {
    return this.app && this.app.globalData ? this.app.globalData.session : null;
  },

  cloud() {
    return this.app && this.app.globalData ? this.app.globalData.cloud : null;
  },

  track(name, payload) {
    const tracker = this.app && this.app.globalData ? this.app.globalData.tracker : null;
    if (!tracker || typeof tracker.track !== 'function') return false;
    return tracker.track(name, payload);
  },

  userId() {
    const session = this.session();
    return session && typeof session.getUserId === 'function' ? session.getUserId() : '';
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

  // ── 提交与三态 ──────────────────────────────────────────────

  /** 走一次「计算」：先呈现计算中，失败按退避重试，耗尽后转计算失败。 */
  runCompute() {
    this.settled = true;
    this.retry = 0;
    this.clearTimer();
    this.setState('loading');
    this.submit();
  },

  submit() {
    const box = this.cloud();
    const session = this.session();
    const payload = session && typeof session.payload === 'function' ? session.payload() : null;

    // 无云函数能力 / 无待提交会话：直接进失败态（美术资产 §5.4 ②），不空转重试
    if (!box || typeof box.available !== 'function' || !box.available() || !payload) {
      this.setState('failed');
      return;
    }

    box
      .computeResult({
        session_id: payload.session_id,
        user_pseudo_id: this.userId(),
        quiz_version: payload.quiz_version,
        answers: payload.answers,
      })
      .then((res) => {
        if (this.stopped) return;
        if (res && res.ok && res.data && res.data.archetype_code) {
          if (typeof session.saveResult === 'function') session.saveResult(res.data);
          this.reportComplete(res.data, payload.answers);
          this.renderResult(this.readResult(), false);
          this.enterPendingPair();
          return;
        }
        this.scheduleRetry();
      });
  },

  /** 退避重试：三次用尽即转失败态（技术资产 §3.4）。 */
  scheduleRetry() {
    if (this.retry >= RETRY_BACKOFF_MS.length) {
      this.setState('failed');
      return;
    }
    const delay = RETRY_BACKOFF_MS[this.retry];
    this.retry += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.submit();
    }, delay);
  },

  setState(state) {
    // 「计算中」与「计算失败」共用同一符号区素材（环状光晕），差异只在不透明度与文字
    const zoneStyle = layerStyle([{ src: assets.DECOR['C-2'] }]);

    if (state === 'loading') {
      this.setData({
        state: 'loading',
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
  renderResult(cached, isRevisit) {
    const found = cached && display.archetype(cached.archetype_code);
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

    if (!this.reportedResultView) {
      this.reportedResultView = true;
      this.track('result_view', {
        archetype_id: cached.archetype_id || '',
        is_revisit: isRevisit === true,
      });
    }
  },

  /** 本次出结果后有挂起的邀请码：取出并直接进入 P-05（受邀链路闭环，实施计划 §4.4-④）。 */
  enterPendingPair() {
    if (this.enteredPair) return;
    const session = this.session();
    if (!session || typeof session.readPendingPair !== 'function') return;
    const pendingCode = session.readPendingPair();
    if (!pendingCode) return;
    this.enteredPair = true;
    if (typeof session.clearPendingPair === 'function') session.clearPendingPair();
    this.go(`/packagePair/pages/pair/index?pair_code=${encodeURIComponent(pendingCode)}`);
  },

  reportComplete(result, answers) {
    const session = this.session();
    const status = session && typeof session.status === 'function' ? session.status() : null;
    const startedAt = status && status.started_at ? status.started_at : Date.now();
    this.track('test_complete', {
      archetype_id: result.archetype_id || '',
      total_duration_ms: Math.max(0, Date.now() - startedAt),
      answer_count: answers ? Object.keys(answers).length : 0,
    });
  },

  /** 重新生成：显式重跑一次（美术资产 §5.4 计算失败态的重试入口）。 */
  onRetry() {
    this.runCompute();
  },

  // ── 邀请与分享 ──────────────────────────────────────────────

  /**
   * 懒创建邀请（幂等）：本页只在用户真正表达邀请/分享意图时发起 createInvite，
   * 且同一页实例内复用同一张码，避免重复产生 pending 邀请。
   * @returns {Promise<string>} 成功为配对码，失败/无能力为 ''
   */
  ensureInvite() {
    const box = this.cloud();
    if (!box || typeof box.available !== 'function' || !box.available()) return Promise.resolve('');
    if (this.inviteCode) return Promise.resolve(this.inviteCode);
    if (this.invitePending) return this.invitePending;

    const session = this.session();
    const cached = this.readResult();

    this.invitePending = box
      .createInvite({
        user_pseudo_id: this.userId(),
        archetype_code: cached ? cached.archetype_code : '',
      })
      .then((res) => {
        this.invitePending = null;
        if (!res || !res.ok || !res.data || !res.data.pair_code) return '';
        const code = res.data.pair_code;
        this.inviteCode = code;
        if (session && typeof session.addRole === 'function') session.addRole('initiated', code);
        this.setData({ pairCode: code });
        this.track('pair_invite_create', {
          pair_code: code,
          archetype_id: cached && cached.archetype_id ? cached.archetype_id : '',
        });
        return code;
      });

    return this.invitePending;
  },

  /** 邀请好友配对：先拿到邀请码，再进入 P-05 发起侧（带码进入，P-05 不重复创建）。 */
  onInvite() {
    this.ensureInvite().then((code) => {
      if (this.stopped) return;
      this.go(
        code
          ? `/packagePair/pages/pair/index?pair_code=${encodeURIComponent(code)}`
          : '/packagePair/pages/pair/index?invite=1'
      );
    });
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

    this.track('share_click', { scene: 'result', channel });

    if (channel === 'copy_code') {
      // 配对码随需创建，不再因「尚无码」而静默无响应
      this.ensureInvite().then((code) => {
        if (!this.stopped && code) this.copyText(code);
      });
      return;
    }
    if (channel === 'friend' || channel === 'group') {
      this.ensureInvite().then((code) => {
        if (!this.stopped) this.shareCard(code);
      });
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
  shareCard(code) {
    if (typeof tt === 'undefined' || !tt || typeof tt.shareAppMessage !== 'function') return;
    const payload = {
      title: this.data.name,
      desc: this.data.imagery,
    };
    if (code) payload.query = `code=${encodeURIComponent(code)}`;
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
    this.clearTimer();
    const session = this.session();
    if (session) {
      if (typeof session.reset === 'function') session.reset();
      if (typeof session.clearResult === 'function') session.clearResult();
    }
    this.settled = false;
    this.retry = 0;
    this.reportedResultView = false;
    this.go('/packageQuiz/pages/quiz/index');
  },

  go(url) {
    if (typeof tt !== 'undefined' && tt && typeof tt.navigateTo === 'function') {
      tt.navigateTo({ url });
    }
  },
});
