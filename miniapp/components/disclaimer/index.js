'use strict';

/**
 * 免责提示组件
 *
 * 合规硬约束（PRD 4.4 / 美术资产 §1）：
 *   - 文案一律取自 miniapp/shared/strings.js（构建期生成，单一来源），**本组件内不写死任何免责措辞**；
 *   - 字号锁定 24rpx（见 index.ttss），**不得低于 24rpx**，且不得通过折叠、超小字号或"仅弹窗一次"隐藏；
 *   - 因此本组件不提供任何折叠 / 收起交互，只有展示。
 *
 * 用法：<disclaimer scope="home" />
 *   scope ∈ home | guide | quiz | result | pair | share（与 strings.disclaimers 的键一一对应）
 */

const display = require('../../core/display.js');

Component({
  properties: {
    /** 文案位（对应 strings.disclaimers 的键） */
    scope: {
      type: String,
      value: 'home',
      observer(value) {
        this.setData({ text: display.disclaimer(value) });
      },
    },
  },

  data: { text: '' },

  /** 兜底：即便宿主不支持属性 observer，attached 也会按当前 scope 取一次文案。 */
  attached() {
    this.setData({ text: display.disclaimer(this.data.scope) });
  },
});
