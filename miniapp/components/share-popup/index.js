'use strict';

/**
 * P-06 分享弹窗组件
 *
 * 依据：PRD 6 章 P-06 与 7.2 分享渠道；《美术资产》§七（分享弹窗线稿）；实施计划 §4.4-①。
 *
 * 两点已定口径：
 *   1. **P-06 按独立页面计**：组件首次可见时上报一次 `page_view(page_id='P-06')`，避免埋点漏报；
 *   2. **免责两处常驻**：分享卡内文字与弹窗底部各一次，两处文案同取 `strings.disclaimers.share`，
 *      不在组件内写死（卡内文字即 `娱乐测试 · 结果仅供参考`）。
 *
 * 边界：本组件只做展示与事件抛出（`share` / `close`），分享渠道的实际拉起与 `share_click`
 * 上报由宿主页面完成 —— 组件内无从得知 `scene` 的合法取值，不在此处编造枚举。
 * 视觉还原（蒙层动效、按钮态、图标）留第二阶段，见实施计划 §七。
 */

const display = require('../../core/display.js');
const { PAGES } = require('../../core/route.js');

/** 分享渠道（PRD 7.2 已确认 4 项；图标取自《美术稿-功能图标库》B-2 / B-3 / B-4 / B-5） */
const CHANNELS = [
  { key: 'friend', label: '抖音好友' },
  { key: 'group', label: '抖音群' },
  { key: 'save_image', label: '保存图片' },
  { key: 'copy_code', label: '复制配对码' },
];

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(value) {
        if (value) this.reportOpen();
      },
    },
    /** 分享卡预览用的原型名（来自结果缓存，组件自身不参与任何计算） */
    archetypeName: { type: String, value: '' },
    /** 分享卡预览上的配对码（无配对关系时为空） */
    pairCode: { type: String, value: '' },
  },

  data: {
    channels: CHANNELS,
    cardText: display.disclaimer('share'),
  },

  methods: {
    /** 首次可见时上报一次 P-06 的 page_view；重复打开不重复上报。 */
    reportOpen() {
      if (this.reportedPageView) return;
      this.reportedPageView = true;

      const app = typeof getApp === 'function' ? getApp() : null;
      if (app && typeof app.reportPageView === 'function') {
        app.reportPageView(PAGES.SHARE);
      }
    },

    /** 点击蒙层关闭（美术资产 §7.3：点击蒙层或下滑关闭） */
    onMaskTap() {
      this.triggerEvent('close');
    },

    /** 阻断弹窗内部点击冒泡到蒙层 */
    onPopupTap() {},

    onChannelTap(event) {
      const channel = event && event.currentTarget ? event.currentTarget.dataset.channel : '';
      if (!channel || channel === 'invite' || channel === 'retry') return;
      this.triggerEvent('share', { channel });
    },

    onInviteTap() {
      this.triggerEvent('invite');
    },

    onRetryTap() {
      this.triggerEvent('retry');
    },
  },
});
