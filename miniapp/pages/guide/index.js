'use strict';

/**
 * P-02 测试引导页
 *
 * 依据：《美术资产-全流程视觉P01-P06线稿说明》§3（版式 / 三步说明卡 / 免责措辞）。
 * 免责使用 PRD 4.4 的「测试引导页」专属版本，不得复用首页文案（美术资产 §3.3），
 * 由 <disclaimer scope="guide" /> 取自 strings.disclaimers.guide。
 *
 * 「开始答题」不在此处重置会话：P-03 首次作答时由 session.answer 自动开会话，
 * 存在未完成会话时自然续答（技术资产 §3.4 会话恢复）。
 */

const { PAGES } = require('../../core/route.js');
const display = require('../../core/display.js');

Page({
  data: {
    title: '',
    subtitle: '',
    steps: [],
    note: '',
    noteResume: '',
    cta: '',
    canResume: false,
  },

  onLoad() {
    const app = typeof getApp === 'function' ? getApp() : null;
    this.app = app;

    this.setData({
      title: display.ui('guide.title'),
      subtitle: display.ui('guide.subtitle'),
      steps: display.ui('guide.steps'),
      note: display.ui('guide.note'),
      noteResume: display.ui('guide.noteResume'),
      cta: display.ui('guide.cta'),
    });
  },

  onShow() {
    this.refreshSession();
    if (this.app && typeof this.app.reportPageView === 'function') {
      this.app.reportPageView(PAGES.GUIDE);
    }
  },

  /** 未完成会话存在时补一句「上次进度已保留」，与首页「继续上次答题」入口呼应。 */
  refreshSession() {
    const session = this.app && this.app.globalData ? this.app.globalData.session : null;
    const resumable = !!(session && typeof session.status === 'function' && session.status().canResume);
    if (resumable !== this.data.canResume) this.setData({ canResume: resumable });
  },

  onBegin() {
    if (typeof tt !== 'undefined' && tt && typeof tt.navigateTo === 'function') {
      tt.navigateTo({ url: '/packageQuiz/pages/quiz/index' });
    }
  },
});
