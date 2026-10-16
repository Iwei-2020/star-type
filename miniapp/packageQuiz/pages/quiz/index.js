'use strict';

/**
 * P-03 答题页（骨架）
 *
 * 位于分包 packageQuiz（app.json 声明）；本阶段只落地埋点钩子。
 * 答题交互（作答即进入下一题、返回上一题修改、进度持久化）依赖 miniapp/core/session.js，
 * 待视觉还原阶段一并接入；题面与选项文案统一取自 miniapp/shared/strings.js。
 */

const { PAGES } = require('../../../core/route.js');

Page({
  onShow() {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && typeof app.reportPageView === 'function') {
      app.reportPageView(PAGES.QUIZ);
    }
  },
});
