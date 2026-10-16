'use strict';

/**
 * P-03 答题页
 *
 * 依据：《美术资产-全流程视觉P01-P06线稿说明》§4（版式 / 选项态 / 操作提示）。
 * 位于分包 packageQuiz（app.json 声明）；题面、选项、统一题问与操作提示一律经 core/display.js
 * 取得，页面内不写死任何对外字样。
 *
 * 交互口径：
 *   - 作答即进入下一题；末题作答后进入 P-04（redirectTo，避免返回键回到已答完的题面）；
 *   - 「上一题」回改旧题：回退由**页面本地游标**承担，会话机的 cursor 只前进不后退
 *     （core/session.js 的 answer 语义：作答即推进、回改不回退进度），所以会话里
 *     cursor 仍是历史最远进度，答题记录以 answers 为准。
 */

const { PAGES } = require('../../../core/route.js');
const display = require('../../../core/display.js');
const assets = require('../../../shared/assets.js');

Page({
  data: {
    progressText: '',
    progressPercent: 0,
    prompt: '',
    stem: '',
    options: [],
    canGoBack: false,
    backText: '',
    hint: '',
    backIconStyle: '',
  },

  onLoad() {
    const app = typeof getApp === 'function' ? getApp() : null;
    this.app = app;
    this.ids = display.questionIds();
    this.index = 0;

    this.setData({
      prompt: display.questionPrompt(),
      backText: display.ui('quiz.back'),
      // 「上一题」箭头取自功能图标库 A-2
      backIconStyle:
        `background-image: url("${assets.ICONS['A-2']}");` +
        ' background-repeat: no-repeat; background-position: center center; background-size: contain;',
    });
  },

  onShow() {
    // 首次进入按会话游标定位；从 P-04 返回时保留本页游标
    if (!this.entered) {
      this.entered = true;
      this.index = this.sessionCursor();
    }
    this.render();
    if (this.app && typeof this.app.reportPageView === 'function') {
      this.app.reportPageView(PAGES.QUIZ);
    }
  },

  session() {
    return this.app && this.app.globalData ? this.app.globalData.session : null;
  },

  /** 会话游标：上次答题推进到的位置（可恢复到未答的那一题） */
  sessionCursor() {
    const session = this.session();
    const status = session && typeof session.status === 'function' ? session.status() : null;
    const cursor = status ? Number(status.cursor) || 0 : 0;
    return Math.min(Math.max(cursor, 0), Math.max(this.ids.length - 1, 0));
  },

  render() {
    const session = this.session();
    const status = session && typeof session.status === 'function' ? session.status() : null;
    const answers = status ? status.answers : {};
    const total = this.ids.length;
    const last = Math.max(total - 1, 0);
    const index = Math.min(Math.max(this.index, 0), last);
    this.index = index;

    const question = display.question(this.ids[index]) || { stem: '', options: [] };
    const options = (question.options || []).map((option) => ({
      id: option.id,
      text: option.text,
      // 回改旧题时把已选项点亮（只表达「已选」）
      selected: answers[this.ids[index]] === option.id,
    }));
    const answered = status ? Number(status.answered_count) || 0 : 0;
    const percent = total > 0 ? Math.round((answered / total) * 100) : 0;

    this.setData({
      progressText: display.fill(display.ui('quiz.progress'), { n: index + 1, total }),
      progressPercent: percent,
      stem: question.stem,
      options,
      canGoBack: index > 0,
      hint: index >= last ? display.ui('quiz.hintLast') : display.ui('quiz.hint'),
    });
  },

  onOptionTap(event) {
    const optionId = event && event.currentTarget ? event.currentTarget.dataset.option : '';
    const session = this.session();
    if (!optionId || !session || typeof session.answer !== 'function') return;

    const questionId = this.ids[this.index];
    if (!session.answer(questionId, optionId)) return;

    if (this.index >= this.ids.length - 1) {
      if (typeof tt !== 'undefined' && tt && typeof tt.redirectTo === 'function') {
        tt.redirectTo({ url: '/packageQuiz/pages/result/index' });
      }
      return;
    }
    this.index += 1;
    this.render();
  },

  onBack() {
    if (this.index <= 0) return;
    this.index -= 1;
    this.render();
  },
});
