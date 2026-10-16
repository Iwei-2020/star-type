'use strict';

/**
 * P-01 首页（骨架）
 *
 * 本阶段只落地「路由消费 + 埋点钩子」，不含任何视觉还原（实施计划 §五.5 / §七）。
 * 视觉还原需本地可运行环境（抖音开发者工具）才能自验，留第二阶段。
 */

const { PAGES } = require('../../core/route.js');

Page({
  onLoad() {
    // 落地路由已在 app.onLaunch 经 core/route.js 统一解析，页面只消费结论，不重复解析
    const app = typeof getApp === 'function' ? getApp() : null;
    this.entry = app && app.globalData ? app.globalData.entry : null;
  },

  onShow() {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && typeof app.reportPageView === 'function') {
      app.reportPageView(PAGES.HOME);
    }
  },
});
