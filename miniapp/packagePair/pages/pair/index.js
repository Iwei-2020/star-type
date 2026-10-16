'use strict';

/**
 * P-05 同频图谱页
 *
 * 依据：《美术资产-全流程视觉P01-P06线稿说明》§6（已完成 6.1 / 等待 6.2 / 已过期 6.3 /
 * 元素清单 6.4 / 对照带绘制规则 6.5）、《技术资产》§3.3（配对状态机）、§6（云函数契约）、§7（埋点）。
 * 位于分包 packagePair（app.json 声明）。
 *
 * 四种视图：
 *   input      手工输入配对码（设计稿未覆盖，为首页「已有邀请码 · 直接配对」入口最小补齐）
 *   waiting    等待对方完成（§6.2）：本人缩略卡 + 待完成占位
 *   completed  已完成（§6.1）：缩略双卡 + 4 条维度对照带 + 同频度 + 相处模式标签
 *   expired    已过期（§6.3）
 *
 * 身份判定：同一张码「我是发起者还是受邀者」不由 URL 形参决定，而由本地角色索引
 * （`st_pair_roles.initiated`，session.hasRole）判定 —— 这样自己再点开自己的链接不会被
 * 误判成受邀者而触发 PAIR_SELF_NOT_ALLOWED(2003)。发起侧只等待（不 accept/complete），
 * 受邀侧 acceptInvite → completePair。
 *
 * 轮询：等待态按服务端 `retry_after_ms`（pending 视图）退避轮询 getPairStatus，
 * 退后台即停（onHide），回前台续（onShow）；completed / expired 落地后停止。
 *
 * 完成态的 4 条对照带读服务端 `completedView.dimensions`（`[{ dim, comp, a, b }]`）：
 * **维度顺序由服务端给定**（前端不得自行推导，隔离门禁禁区），文案按 dim 取
 * `ui('pair.dims.<dim>.*')`；端点 A/B 的左右落位由 a / b 决定。
 *
 * 配对码校验统一走 core/route.js 的 checkPairCode（trim + 大写 + 去空白与连字符，含
 * I / L / O / 0 / 1 一律明确拒绝、不做模糊映射），与落地路由同源，本页不另写一份口径。
 */

const { checkPairCode, PAGES } = require('../../../core/route.js');
const display = require('../../../core/display.js');
const assets = require('../../../shared/assets.js');
const { layerStyle } = require('../../../core/art.js');
const { ERROR_CODES, POLL_BACKOFF_MS } = require('../../../shared/client-constants.js');

/** 配对码拒绝原因（reason 取值见 core/route.js CODE_REJECT_REASONS）→ 文案。 */
function rejectText(reject) {
  if (!reject || reject.ok !== false) return '';
  return display.ui(reject.reason === 'AMBIGUOUS_CHARS' ? 'pair.inputAmbiguous' : 'pair.inputInvalid');
}

/** 轮询间隔：优先用服务端 pending 视图给的 retry_after_ms，缺失时按本地退避表兜底。 */
function pollDelay(attempt, serverDelay) {
  const given = Number(serverDelay);
  if (given > 0) return given;
  const index = Math.min(Math.max(Number(attempt) || 0, 0), POLL_BACKOFF_MS.length - 1);
  return POLL_BACKOFF_MS[index];
}

/** 逐维明细 → 对照带渲染项（维度顺序即服务端数组顺序，本页只做展示映射）。 */
function buildDimensions(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const dim = row.dim;
    const comp = row.comp === true;
    return {
      dim,
      title: display.ui(`pair.dims.${dim}.title`),
      leftLabel: display.ui(`pair.dims.${dim}.a`),
      rightLabel: display.ui(`pair.dims.${dim}.b`),
      mark: comp ? display.ui('pair.markComp') : display.ui('pair.markSame'),
      comp,
      merged: !comp,
      showRight: comp,
      leftDot: row.a === 'A' ? 'p5__dot--a' : 'p5__dot--b',
      rightDot: row.b === 'A' ? 'p5__dot--a' : 'p5__dot--b',
    };
  });
}

Page({
  data: {
    /** input | waiting | completed | expired */
    view: 'input',
    title: '',
    // ── 输入态 ──
    inputHint: '',
    inputPlaceholder: '',
    inputCta: '',
    inputError: '',
    codeInput: '',
    inputIconStyle: '',
    // ── 对照区（等待态 / 完成态共用）──
    leftRole: '',
    leftName: '',
    leftSigilStyle: '',
    rightRole: '',
    rightName: '',
    rightSigilStyle: '',
    rightPending: true,
    linkStyle: '',
    // ── 等待态 ──
    waitText: '',
    waitCta: '',
    waitIconStyle: '',
    // ── 完成态 ──
    dimensions: [],
    similarityText: '',
    bandText: '',
    shareCta: '',
    switchCta: '',
    // ── 过期态 ──
    expiredTitle: '',
    expiredSub: '',
    expiredCta: '',
    expiredIconStyle: '',
    // ── 分享 ──
    shareVisible: false,
    shareName: '',
    shareCode: '',
    pairCode: '',
  },

  onLoad(query) {
    this.app = typeof getApp === 'function' ? getApp() : null;
    this.stopped = false;
    this.polling = false;
    this.pollTimer = null;
    this.pollAttempt = 0;
    /** 当前轮询锚定的配对码（用实例字段而非 this.data：不依赖 setData 的回写时序） */
    this.activePairCode = '';

    this.setData({
      title: display.ui('pair.title'),
      inputHint: display.ui('pair.inputHint'),
      inputPlaceholder: display.ui('pair.inputPlaceholder'),
      inputCta: display.ui('pair.inputCta'),
      inputIconStyle: layerStyle([{ src: assets.ICONS['B-6'] }]),
      // 中间连接符（§6.4②）取图标库 B-1（节点连线），与 ⇄ 的连接语义一致：
      // 装饰库 D-3「图谱连线组」的 viewBox 为 200×200、线宽仅 1.4，在 56rpx 展示尺寸下线宽不足 1rpx 而不可见。
      linkStyle: layerStyle([{ src: assets.ICONS['B-1'] }]),
      waitText: display.ui('pair.waitText'),
      waitCta: display.ui('pair.waitCta'),
      waitIconStyle: layerStyle([{ src: assets.ICONS['C-3'] }]),
      expiredTitle: display.ui('pair.expiredTitle'),
      expiredSub: display.ui('pair.expiredSub'),
      expiredCta: display.ui('pair.expiredCta'),
      expiredIconStyle: layerStyle([{ src: assets.ICONS['C-4'] }]),
      shareCta: display.ui('pair.shareCta'),
      switchCta: display.ui('pair.switchCta'),
    });

    const q = query || {};
    const raw = q.code !== undefined ? q.code : q.pair_code;
    const hasCodeParam = raw !== undefined && raw !== null;
    const checked = checkPairCode(raw);

    if (checked && checked.ok) {
      const session = this.session();
      const mine =
        session && typeof session.hasRole === 'function' && session.hasRole('initiated', checked.code);
      if (mine) this.startInitiator(checked.code);
      else this.joinFlow(checked.code);
      return;
    }
    if (hasCodeParam) {
      // 带码但形态非法：不挂起该码，进输入态并说明原因（与落地路由 §4.4-④ 同口径）
      this.enterInput(checked);
      return;
    }
    if (q.invite === '1') {
      // 发起侧（P-04「邀请好友配对」入口）：创建邀请后进入等待态
      this.startInitiator('');
      return;
    }
    this.enterInput(null);
  },

  onShow() {
    if (this.app && typeof this.app.reportPageView === 'function') {
      this.app.reportPageView(PAGES.PAIR);
    }
    // 回前台续上等待态轮询（onHide 已停，避免后台空转）
    if (this.data.view === 'waiting' && this.data.pairCode && !this.polling) {
      this.startPoll(this.data.pairCode);
    }
  },

  onHide() {
    this.stopPoll();
  },

  onUnload() {
    this.stopped = true;
    this.stopPoll();
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

  hasCloud() {
    const box = this.cloud();
    return !!(box && typeof box.available === 'function' && box.available());
  },

  // ── 视图切换 ────────────────────────────────────────────────

  /** 本人缩略卡（等待态用）：结果缺失时退回占位，避免渲染半张卡。 */
  selfCard() {
    const cached = this.readResult();
    const found = cached ? display.archetype(cached.archetype_code) : null;
    return {
      name: found ? found.name : '',
      code: found ? found.code : '',
      style: found
        ? layerStyle([
            { src: assets.SYMBOLS[found.code] },
            { src: assets.DECOR['C-3'], size: '130% 130%' },
          ])
        : layerStyle([{ src: assets.ICONS['B-8'] }]),
    };
  },

  enterInput(reject) {
    this.stopPoll();
    this.activePairCode = '';
    this.setData({
      view: 'input',
      codeInput: '',
      inputError: rejectText(reject),
    });
  },

  /** 2001：邀请不存在（服务端判定），退回输入态并说明。 */
  enterInputNotFound() {
    this.stopPoll();
    this.activePairCode = '';
    this.setData({
      view: 'input',
      codeInput: '',
      inputError: display.ui('pair.inputNotFound'),
    });
  },

  /** 等待态（§6.2）：本人缩略卡 + 待完成占位 + 等待文案 + 再次邀请。 */
  renderWaiting(pairCode) {
    const self = this.selfCard();
    this.activePairCode = pairCode || '';
    this.setData({
      view: 'waiting',
      pairCode: pairCode || '',
      shareName: self.name,
      shareCode: self.code,
      leftRole: display.ui('pair.roleSelf'),
      leftName: self.name || display.ui('pair.pendingName'),
      leftSigilStyle: self.style,
      rightRole: display.ui('pair.pendingName'),
      rightName: display.ui('pair.pendingName'),
      rightPending: true,
      rightSigilStyle: layerStyle([{ src: assets.ICONS['B-8'] }]),
    });
  },

  /** 过期态（§6.3）。 */
  renderExpired() {
    this.stopPoll();
    this.setData({ view: 'expired' });
  },

  /** 完成态（§6.1）：消费服务端 completed 视图。 */
  renderPair(view) {
    if (!view || !view.status) return;
    this.stopPoll();
    this.activePairCode = view.pair_code || this.activePairCode;

    if (view.status === 'expired') {
      this.setData({ view: 'expired' });
      return;
    }
    if (view.status !== 'completed') return;

    const inviter = display.archetype(view.initiator_code);
    const invitee = display.archetype(view.invitee_code);
    const glow = { src: assets.DECOR['C-3'], size: '130% 130%' };

    this.setData({
      view: 'completed',
      pairCode: view.pair_code || this.data.pairCode,
      shareName: inviter ? inviter.name : '',
      shareCode: inviter ? inviter.code : '',
      leftRole: display.ui('pair.roleInviter'),
      leftName: inviter ? inviter.name : '',
      leftSigilStyle: inviter ? layerStyle([{ src: assets.SYMBOLS[inviter.code] }, glow]) : '',
      rightRole: display.ui('pair.roleInvitee'),
      rightName: invitee ? invitee.name : '',
      rightPending: false,
      // 受邀侧缩略卡用淡紫换色版符号（对齐全流程美术稿；装饰层 C-3 为金色光晕，保留）
      rightSigilStyle: invitee ? layerStyle([{ src: assets.SYMBOLS_VIOLET[invitee.code] }, glow]) : '',
      similarityText: display.formatPercent(view.similarity_pct),
      bandText: `${display.ui('pair.bandPrefix')}${view.band_label || ''}`,
      dimensions: buildDimensions(view.dimensions),
    });

    // 仅首次完成上报一次（服务端 isFirstCompletion 保证幂等，刷新图谱不重复计数）
    if (view.isFirstCompletion === true) {
      this.track('pair_complete', {
        pair_code: view.pair_code || '',
        c_count: view.c_count === undefined ? 0 : view.c_count,
        band_label: view.band_label || '',
        similarity_pct: view.similarity_pct === undefined ? 0 : view.similarity_pct,
      });
    }
  },

  // ── 云函数链路 ──────────────────────────────────────────────

  /**
   * 发起侧：有码 → 直接等待 + 轮询；无码 → createInvite 后等待 + 轮询。
   * 无云函数能力时退回输入态（等价于手工输入别人的邀请码）。
   */
  startInitiator(pairCode) {
    if (pairCode) {
      this.renderWaiting(pairCode);
      this.startPoll(pairCode);
      return;
    }

    if (!this.hasCloud()) {
      this.enterInput(null);
      return;
    }

    const session = this.session();
    const cached = this.readResult();
    this.cloud()
      .createInvite({
        user_pseudo_id: this.userId(),
        archetype_code: cached ? cached.archetype_code : '',
      })
      .then((res) => {
        if (this.stopped) return;
        if (res && res.ok && res.data && res.data.pair_code) {
          const code = res.data.pair_code;
          if (session && typeof session.addRole === 'function') session.addRole('initiated', code);
          this.track('pair_invite_create', {
            pair_code: code,
            archetype_id: cached && cached.archetype_id ? cached.archetype_id : '',
          });
          this.renderWaiting(code);
          this.startPoll(code);
          return;
        }
        this.enterInput(null);
      });
  },

  /**
   * 受邀侧：acceptInvite 落定受邀身份 → completePair 尝试收口。
   * 本人尚无结果时不在此硬撑，挂起配对码并先去答题（与落地路由 §4.4-④ 同口径）。
   */
  joinFlow(pairCode) {
    if (!this.readResult()) {
      const session = this.session();
      if (session && typeof session.setPendingPair === 'function') session.setPendingPair(pairCode);
      this.go('/pages/guide/index', true);
      return;
    }

    if (!this.hasCloud()) {
      this.renderWaiting(pairCode);
      this.startPoll(pairCode);
      return;
    }

    this.cloud()
      .acceptInvite({ pair_code: pairCode, user_pseudo_id: this.userId() })
      .then((res) => {
        if (this.stopped) return;
        if (res && res.ok && res.data) {
          const view = res.data;
          if (view.isFirstAccept === true) this.track('pair_invite_accept', { pair_code: pairCode });
          if (view.status === 'completed') {
            this.renderPair(view);
            return;
          }
          this.completePair(pairCode);
          return;
        }
        // 接受失败（过期 / 不存在 / 已被占用）：不在前端复刻状态机，交给轮询统一判定
        this.renderWaiting(pairCode);
        this.startPoll(pairCode);
      });
  },

  /** 收口：双方结果齐备则服务端直接返回 completed 视图。 */
  completePair(pairCode) {
    if (!this.hasCloud()) {
      this.renderWaiting(pairCode);
      this.startPoll(pairCode);
      return;
    }

    this.cloud()
      .completePair({ pair_code: pairCode, user_pseudo_id: this.userId() })
      .then((res) => {
        if (this.stopped) return;
        if (res && res.ok && res.data && res.data.status === 'completed') {
          this.renderPair(res.data);
          return;
        }
        this.renderWaiting(pairCode);
        this.startPoll(pairCode);
      });
  },

  // ── 等待态轮询 ──────────────────────────────────────────────

  startPoll(pairCode) {
    if (!pairCode) return;
    this.stopPoll();
    this.polling = true;
    this.pollAttempt = 0;
    this.poll(pairCode);
  },

  stopPoll() {
    this.polling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  },

  poll(pairCode) {
    if (this.stopped || this.activePairCode !== pairCode) {
      this.polling = false;
      return;
    }
    if (!this.hasCloud()) {
      this.polling = false;
      return;
    }

    const attempt = this.pollAttempt;
    this.cloud()
      .getPairStatus({ pair_code: pairCode, attempt })
      .then((res) => {
        if (this.stopped || this.activePairCode !== pairCode) return;

        if (res && res.ok && res.data) {
          const view = res.data;
          if (view.status === 'completed') {
            this.renderPair(view);
            return;
          }
          if (view.status === 'expired') {
            this.renderExpired();
            return;
          }
          this.schedulePoll(pairCode, pollDelay(attempt, view.retry_after_ms));
          return;
        }

        if (res && res.code === ERROR_CODES.PAIR_EXPIRED) {
          this.renderExpired();
          return;
        }
        if (res && res.code === ERROR_CODES.PAIR_CODE_NOT_FOUND) {
          this.enterInputNotFound();
          return;
        }
        // 其他失败（限流 3002 / 服务端 3001 / 网络异常）：保留等待态，按退避表续轮询
        this.schedulePoll(pairCode, pollDelay(attempt, null));
      });
  },

  schedulePoll(pairCode, delay) {
    this.pollAttempt += 1;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.poll(pairCode);
    }, delay);
  },

  // ── 输入态 ──────────────────────────────────────────────────

  onCodeInput(event) {
    this.setData({
      codeInput: event && event.detail ? event.detail.value : '',
      inputError: '',
    });
  },

  /**
   * 确认配对：本人尚无结果时按落地路由同口径处理 —— 挂起该码并先去答题（技术资产 §3.4），
   * 出结果后再由结果页带走配对码进本页；否则登记受邀角色并进入受邀链路。
   */
  onConfirm() {
    const checked = checkPairCode(this.data.codeInput);
    if (!checked || !checked.ok) {
      this.setData({ inputError: rejectText(checked) });
      return;
    }

    const session = this.session();
    if (!this.readResult()) {
      if (session && typeof session.setPendingPair === 'function') session.setPendingPair(checked.code);
      this.go('/pages/guide/index', true);
      return;
    }
    if (session && typeof session.addRole === 'function') session.addRole('joined', checked.code);
    this.joinFlow(checked.code);
  },

  // ── 分享 ────────────────────────────────────────────────────

  /** 等待态「再次邀请」：直接拉起分享弹窗（配对码已在手）。 */
  onInviteAgain() {
    this.setData({ shareVisible: true });
  },

  onShare() {
    this.setData({ shareVisible: true });
  },

  onShareClose() {
    this.setData({ shareVisible: false });
  },

  /**
   * 分享渠道拉起（美术资产 §7.3：渠道拉起失败仅弱提示，不改变弹窗状态）。
   * 渠道形参与可用性以平台侧为准（PRD 7.2 注），此处只做可降级的调用，不编造枚举。
   */
  onShareChannel(event) {
    const channel = event && event.detail ? event.detail.channel : '';
    if (!channel) return;

    this.track('share_click', { scene: 'pair', channel });

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
    const payload = { title: this.data.shareName, desc: display.ui('share.subtitle') };
    if (this.data.pairCode) payload.query = `code=${encodeURIComponent(this.data.pairCode)}`;
    try {
      tt.shareAppMessage(payload);
    } catch (err) {
      /* 静默：分享面板拉起失败不改动弹窗 */
    }
  },

  /** 弹窗「去邀请配对」：本页已在图谱之上，语义等价于「换个好友配对」→ 回到输入态。 */
  onPopupInvite() {
    this.setData({ shareVisible: false });
    this.onSwitch();
  },

  /** 弹窗「再测一次」：清掉会话与结果缓存后重新答题（重测产生新的 session_id）。 */
  onPopupRetry() {
    this.setData({ shareVisible: false });
    this.stopPoll();
    const session = this.session();
    if (session) {
      if (typeof session.reset === 'function') session.reset();
      if (typeof session.clearResult === 'function') session.clearResult();
    }
    this.go('/packageQuiz/pages/quiz/index');
  },

  /** 「换个好友配对」：回到输入态并清空已输入的码。 */
  onSwitch() {
    this.enterInput(null);
  },

  /** 过期态「重新发起配对」：本人发起的码就重新创建一张，否则回到输入态。 */
  onRestart() {
    const session = this.session();
    const code = this.data.pairCode;
    if (code && session && typeof session.hasRole === 'function' && session.hasRole('initiated', code)) {
      this.startInitiator('');
      return;
    }
    this.enterInput(null);
  },

  go(url, replace) {
    if (typeof tt === 'undefined' || !tt) return;
    const api = replace ? tt.redirectTo : tt.navigateTo;
    if (typeof api === 'function') api({ url });
  },
});
