'use strict';

/**
 * P-06 分享弹窗组件
 *
 * 依据：PRD 6 章 P-06 与 7.2 分享渠道；《美术资产-全流程视觉P01-P06线稿说明》§7
 * （蒙层 66% / 抽屉上滑 / 分享卡预览 224rpx / 渠道 2×2 / 免责两处常驻）。
 *
 * 三点已定口径：
 *   1. **P-06 按独立页面计**：组件首次可见时上报一次 `page_view(page_id='P-06')`，避免埋点漏报；
 *   2. **免责两处常驻**：分享卡预览内文字与弹窗底部各一次，两处文案同取 `strings.disclaimers.share`，
 *      组件内不写死；
 *   3. **文案一律经 display.ui('share.*') 读取**（含 4 个渠道标签），组件内不出现硬编码中文
 *      —— 满足《技术资产》§12「全部对外文案集中于单一文案源」。
 *
 * 边界：本组件做展示与事件抛出（`share` / `close` / `invite` / `retry`），并在**自身持有合成画布**的
 * 前提下负责「保存图片」渠道的落地 —— 方形分享卡的 canvas 就在本组件内，宿主页面无法寻址到它，
 * 故由宿主页面调 `exportCard(pairCode)` 触发（页面先补齐配对码，再调用；组件不参与云端交互）。
 * 其余渠道的实际拉起仍由宿主页面完成：组件内无从得知 `scene` 的合法取值，不在此处编造枚举。
 */

const display = require('../../core/display.js');
const { PAGES } = require('../../core/route.js');
const assets = require('../../shared/assets.js');
const { layerStyle } = require('../../core/art.js');
const shareCard = require('../../core/share-card.js');

/** 方形分享卡合成画布的元素 id（与 index.ttml 一致）。 */
const SHARE_CANVAS_ID = 'shareCardCanvas';

/**
 * 渠道键 → 图标位（《美术稿-功能图标库》：B-2 抖音好友 / B-3 抖音群 /
 * B-4 保存图片 / B-5 复制配对码）。键序与构建期生成的 strings.ui.share.channels 一致。
 */
const CHANNEL_ICONS = {
  friend: 'B-2',
  group: 'B-3',
  save_image: 'B-4',
  copy_code: 'B-5',
};

/** 分享卡预览里的原型符号（带星芒光晕）；无原型码时不渲染，不编造占位。 */
function previewSigil(code) {
  if (!code || !assets.SYMBOLS[code]) return '';
  return layerStyle([
    { src: assets.SYMBOLS[code] },
    { src: assets.DECOR['C-3'], size: '140% 140%' },
  ]);
}

/** 渠道清单：标签取自文案源，图标位取自图标库。 */
function buildChannels() {
  const list = display.ui('share.channels');
  if (!Array.isArray(list)) return [];
  return list.map((item) => ({
    key: item.key,
    label: item.label,
    iconStyle: CHANNEL_ICONS[item.key]
      ? layerStyle([{ src: assets.ICONS[CHANNEL_ICONS[item.key]] }])
      : '',
  }));
}

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
    /** 分享卡预览用的原型码（决定预览符号；非法码不渲染） */
    archetypeCode: {
      type: String,
      value: '',
      observer(value) {
        this.setData({ previewSigilStyle: previewSigil(value) });
      },
    },
    /** 分享卡预览上的配对码（无配对关系时为空，则不渲染该行） */
    pairCode: { type: String, value: '' },
  },

  data: {
    title: '',
    subtitle: '',
    ctaInvite: '',
    ctaRetry: '',
    pairCodeLabel: '',
    channels: [],
    cardText: '',
    previewSigilStyle: '',
  },

  attached() {
    // 文案与图标位均在挂载时装配一次（构建期产物固定，不随交互变化）
    this.setData({
      title: display.ui('share.title'),
      subtitle: display.ui('share.subtitle'),
      ctaInvite: display.ui('share.ctaInvite'),
      ctaRetry: display.ui('share.ctaRetry'),
      pairCodeLabel: display.ui('result.pairCodeLabel'),
      channels: buildChannels(),
      cardText: display.disclaimer('share'),
    });
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
      if (!channel) return;
      this.triggerEvent('share', { channel });
    },

    onInviteTap() {
      this.triggerEvent('invite');
    },

    onRetryTap() {
      this.triggerEvent('retry');
    },

    /**
     * 合成方形分享卡并存入相册（宿主页面对 `save_image` 渠道调用；见文件头边界说明）。
     * 无论成功失败都只做一次弱提示 toast，**不改变弹窗状态**（美术资产 §7.3）。
     * @param {string} pairCode 最终配对码；宿主页面若有懒创建邀请，须在其 resolve 后再传。
     */
    exportCard(pairCode) {
      if (this.exporting) return;
      this.exporting = true;
      const done = (res) => {
        this.exporting = false;
        const ok = !!(res && res.ok);
        if (typeof tt !== 'undefined' && tt && typeof tt.showToast === 'function') {
          tt.showToast({ title: display.ui(ok ? 'share.saveOk' : 'share.saveFail'), icon: 'none' });
        }
        this.triggerEvent('saved', { ok });
      };

      shareCard
        .saveToAlbum({
          host: this,
          canvasId: SHARE_CANVAS_ID,
          archetypeCode: this.data.archetypeCode,
          pairCode: pairCode || this.data.pairCode || '',
        })
        .then(done)
        .catch(() => done(null));
    },
  },
});
