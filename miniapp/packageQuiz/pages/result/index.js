'use strict';

/**
 * P-04 结果页（骨架）
 *
 * 位于分包 packageQuiz（app.json 声明）。结果数据全部来自**服务端**（computeResult 落库后
 * 由本地 st_result 缓存读取），前端不做任何计分或同频度计算 —— 见技术资产 §1.2「单一权威实现」。
 * 本阶段只落地埋点钩子；结果卡、方形分享卡与计算中/失败态的视觉还原留第二阶段。
 */

const { PAGES } = require('../../../core/route.js');

Page({
  onShow() {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && typeof app.reportPageView === 'function') {
      app.reportPageView(PAGES.RESULT);
    }
  },
});
