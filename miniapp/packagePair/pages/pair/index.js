'use strict';

/**
 * P-05 同频图谱页
 *
 * 依据：《美术资产-全流程视觉P01-P06线稿说明》§6（已完成 6.1 / 等待 6.2 / 已过期 6.3 /
 * 元素清单 6.4 / 对照带绘制规则 6.5）。位于分包 packagePair（app.json 声明）。
 *
 * 四种视图：
 *   input      手工输入配对码（设计稿未覆盖，为首页「已有邀请码 · 直接配对」入口最小补齐）
 *   waiting    等待对方完成（§6.2）：本人缩略卡 + 待完成占位
 *   completed  已完成（§6.1）：缩略双卡 + 4 条维度对照带 + 同频度 + 相处模式标签
 *   expired    已过期（§6.3）
 *
 * 配对码校验统一走 core/route.js 的 checkPairCode（trim + 大写 + 去空白与连字符，含
 * I / L / O / 0 / 1 一律明确拒绝、不做模糊映射），与落地路由同源，本页不另写一份口径。
 *
 * ── 本阶段边界（实施计划 §七）────────────────────────────────
 * 配对状态需服务端 getPairStatus / createInvite / acceptInvite，均未接入
 * （app.js 的 transport 为 null、云函数未部署），故：
 *   1. 带合法码进入 → 乐观落 waiting（本地无状态可查）；
 *   2. completed / expired 的版式已按 §6.1 §6.3 实现，但需服务端数据方可到达 —— `this.pair`
 *      是 getPairStatus 的视图，本阶段恒为 null，故这两个分支不可达；
 *   3. 完成态的 4 条对照带需要「逐维明细」，而 server/lib/pairing.js 的 completedView 目前
 *      只回双方原型码与一致 / 互补总数，**未含逐维明细**（维度顺序与题库分区属前端隔离门禁
 *      禁区，前端不得自行推导），故 renderPair 按以下形状消费，待服务端补齐后方可达：
 *        { status:'completed', pair_code,
 *          initiator:{ code, name }, invitee:{ code, name },
 *          similarity_pct, band_label,
 *          dimensions:[{ dim, title, leftLabel, rightLabel, mark, comp }] }
 */

const { checkPairCode, PAGES } = require('../../../core/route.js');
const display = require('../../../core/display.js');
const assets = require('../../../shared/assets.js');
const { layerStyle } = require('../../../core/art.js');

/** 配对码拒绝原因（reason 取值见 core/route.js CODE_REJECT_REASONS）→ 文案。 */
function rejectText(reject) {
  if (!reject || reject.ok !== false) return '';
  return display.ui(reject.reason === 'AMBIGUOUS_CHARS' ? 'pair.inputAmbiguous' : 'pair.inputInvalid');
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
    /** getPairStatus 视图：本阶段无云函数，恒为 null（见文件头「本阶段边界」②③） */
    this.pair = null;

    const q = query || {};
    const raw = q.code !== undefined ? q.code : q.pair_code;
    const hasCodeParam = raw !== undefined && raw !== null;
    const checked = checkPairCode(raw);

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

    if (checked && checked.ok) {
      // 带合法配对码落地 = 受邀侧（技术资产 §3.3）
      this.renderWaiting(checked.code);
      return;
    }
    if (hasCodeParam) {
      // 带码但形态非法：不挂起该码，进输入态并说明原因（与落地路由 §4.4-④ 同口径）
      this.enterInput(checked);
      return;
    }
    if (q.invite === '1') {
      // 发起侧（P-04「邀请好友配对」入口）：配对码待 createInvite 接入后回填
      this.renderWaiting('');
      return;
    }
    this.enterInput(null);
  },

  onShow() {
    if (this.app && typeof this.app.reportPageView === 'function') {
      this.app.reportPageView(PAGES.PAIR);
    }
  },

  session() {
    return this.app && this.app.globalData ? this.app.globalData.session : null;
  },

  readResult() {
    const session = this.session();
    return session && typeof session.readResult === 'function' ? session.readResult() : null;
  },

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
    this.setData({
      view: 'input',
      codeInput: '',
      inputError: rejectText(reject),
    });
  },

  /** 等待态（§6.2）：本人缩略卡 + 待完成占位 + 等待文案 + 再次邀请。 */
  renderWaiting(pairCode) {
    const self = this.selfCard();
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

  /**
   * 完成态 / 过期态（§6.1 §6.3）：消费 getPairStatus 视图。
   * 本阶段 `this.pair` 恒为 null，故当前不会被调用；保留以便接入后直接对接，避免二次返工。
   */
  renderPair(pair) {
    if (!pair || !pair.status) return;

    if (pair.status === 'expired') {
      this.setData({ view: 'expired' });
      return;
    }

    const left = pair.initiator || {};
    const right = pair.invitee || {};
    const glow = { src: assets.DECOR['C-3'], size: '130% 130%' };

    this.setData({
      view: 'completed',
      pairCode: pair.pair_code || this.data.pairCode,
      shareName: left.name || '',
      shareCode: left.code || '',
      leftRole: display.ui('pair.roleInviter'),
      leftName: left.name || '',
      leftSigilStyle: left.code
        ? layerStyle([{ src: assets.SYMBOLS[left.code] }, glow])
        : '',
      rightRole: display.ui('pair.roleInvitee'),
      rightName: right.name || '',
      rightPending: false,
      // 受邀侧缩略卡用淡紫换色版符号（对齐全流程美术稿；装饰库 C-3 为金色光晕，保留）
      rightSigilStyle: right.code
        ? layerStyle([{ src: assets.SYMBOLS_VIOLET[right.code] }, glow])
        : '',
      similarityText: display.formatPercent(pair.similarity_pct),
      bandText: `${display.ui('pair.bandPrefix')}${pair.band_label || ''}`,
      dimensions: (pair.dimensions || []).map((d) => ({
        dim: d.dim,
        title: d.title,
        leftLabel: d.leftLabel,
        rightLabel: d.rightLabel,
        mark: d.comp ? display.ui('pair.markComp') : display.ui('pair.markSame'),
        comp: d.comp === true,
      })),
    });
  },

  onCodeInput(event) {
    this.setData({
      codeInput: event && event.detail ? event.detail.value : '',
      inputError: '',
    });
  },

  /**
   * 确认配对：本人尚无结果时按落地路由同口径处理 —— 挂起该码并先去答题（技术资产 §3.4），
   * 出结果后再由结果页带走配对码进本页；否则登记受邀角色并进入等待态。
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
    this.renderWaiting(checked.code);
  },

  /** 等待态「再次邀请」：直接拉起分享弹窗（配对码待 createInvite 接入后回填）。 */
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
    if (this.data.pairCode) payload.query = `code=${this.data.pairCode}`;
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

  /** 过期态「重新发起配对」：重新发起需 createInvite，本阶段先回到输入态。 */
  onRestart() {
    this.enterInput(null);
  },

  go(url, replace) {
    if (typeof tt === 'undefined' || !tt) return;
    const api = replace ? tt.redirectTo : tt.navigateTo;
    if (typeof api === 'function') api({ url });
  },
});
