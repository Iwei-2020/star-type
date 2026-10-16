'use strict';

/**
 * P-02 测试引导页（骨架）
 *
 * 免责措辞使用 PRD 4.4 的「测试引导页」专属版本，不得复用首页文案
 * （《美术资产》§3.3）——本阶段尚未接入免责组件，第二阶段接入时取 strings.disclaimers.guide。
 */

const { PAGES } = require('../../core/route.js');

Page({
  onShow() {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && typeof app.reportPageView === 'function') {
      app.reportPageView(PAGES.GUIDE);
    }
  },
});
