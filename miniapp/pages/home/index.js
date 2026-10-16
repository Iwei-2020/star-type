'use strict';

/**
 * P-01 首页
 *
 * 依据：《美术资产-全流程视觉P01-P06线稿说明》§2（版式 / 色值 / 素材）。
 * 文案一律经 core/display.js 取得（strings.js 是构建期生成的唯一文案源），页面内不写死对外字样；
 * 主视觉与装饰素材取自 miniapp/shared/assets.js（由 tools/gen-assets.js 从美术稿提取）。
 *
 * 落地路由已在 app.onLaunch 由 core/route.js 解析完成，页面只消费结论、不重复解析。
 */

const { PAGES } = require('../../core/route.js');
const display = require('../../core/display.js');
const assets = require('../../shared/assets.js');
const { layerStyle } = require('../../core/art.js');

Page({
  data: {
    brand: '',
    brandSub: '',
    tagline: '',
    spec: '',
    ctaStart: '',
    ctaPair: '',
    ctaResume: '',
    sigilStyle: '',
    /** 存在未完成会话且有作答时为 true，展示「继续上次答题」（美术资产 §2.3） */
    canResume: false,
  },

  onLoad() {
    const app = typeof getApp === 'function' ? getApp() : null;
    this.app = app;

    this.setData({
      brand: display.ui('home.brand'),
      brandSub: display.ui('home.brandSub'),
      tagline: display.ui('home.tagline'),
      spec: display.ui('home.spec'),
      ctaStart: display.ui('home.ctaStart'),
      ctaPair: display.ui('home.ctaPair'),
      ctaResume: display.ui('home.ctaResume'),
      // 主视觉 = 星环本图 + 环状光晕（美术资产 §2.2 ① / ②）
      sigilStyle: layerStyle([
        { src: assets.HOME_SIGIL },
        { src: assets.DECOR['C-2'], size: '132% 132%' },
      ]),
    });
  },

  onShow() {
    this.refreshSession();
    if (this.app && typeof this.app.reportPageView === 'function') {
      this.app.reportPageView(PAGES.HOME);
    }
  },

  /** 会话状态只影响「继续上次答题」入口。 */
  refreshSession() {
    const session = this.app && this.app.globalData ? this.app.globalData.session : null;
    const resumable = !!(session && typeof session.status === 'function' && session.status().canResume);
    if (resumable !== this.data.canResume) this.setData({ canResume: resumable });
  },

  go(url) {
    if (typeof tt !== 'undefined' && tt && typeof tt.navigateTo === 'function') {
      tt.navigateTo({ url });
    }
  },

  /** 主行动点：进入 P-02 测试引导页 */
  onStart() {
    this.go('/pages/guide/index');
  },

  /** 「已有邀请码 · 直接配对」：进入 P-05 的手工输入态（校验与提示在 P-05 内完成） */
  onEnterPair() {
    this.go('/packagePair/pages/pair/index?manual=1');
  },

  /** 继续上次未完成的答题（进度由 session 恢复，P-03 按 cursor 定位） */
  onResume() {
    this.go('/packageQuiz/pages/quiz/index');
  },
});
