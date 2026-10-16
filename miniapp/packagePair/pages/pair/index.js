'use strict';

/**
 * P-05 好友配对页（骨架）
 *
 * 位于分包 packagePair（app.json 声明）。本阶段只落地「配对码校验 + 埋点钩子」。
 *
 * 配对码的校验口径统一由 core/route.js 提供（本计划 §4.4-⑤）：
 * 只做 trim + 大写 + 去空白与连字符，含易混字符 I/L/O/0/1 一律**明确拒绝**，
 * 不做 O→0、I→1 一类模糊映射 —— 以免把非法码"纠正"成恰好存在的他人码。
 * 配对状态展示（等待 / 已完成 / 已过期）需服务端 getPairStatus，留第二阶段。
 */

const { PAGES, checkPairCode } = require('../../../core/route.js');

Page({
  onLoad(query) {
    // 落地链接与手工输入共用同一校验函数；非法码只记录原因，具体提示文案由第二阶段补齐
    const checked = checkPairCode(query && query.code);
    this.pairCode = checked && checked.ok ? checked.code : '';
    this.pairCodeRejectReason = checked && !checked.ok ? checked.reason : null;
  },

  onShow() {
    const app = typeof getApp === 'function' ? getApp() : null;
    if (app && typeof app.reportPageView === 'function') {
      app.reportPageView(PAGES.PAIR);
    }
  },
});
