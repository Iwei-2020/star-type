'use strict';

/**
 * 美术素材装配
 *
 * `miniapp/shared/assets.js` 里的素材是 data-URI（base64 SVG），只能经内联 style 的
 * `background-image` 渲染。一个视觉位往往要叠 2–3 层（本图 + 光晕 / 星点 / 底光），
 * 在 TTML 里拼长串 data-URI 既不可读也易错，故统一在页面脚本里拼好整条 style 交给模板，
 * 模板中只出现一个 `{{sigilStyle}}` 之类的占位。（P-01 / P-04 / P-05 共用，故独立成模块。）
 *
 * 边界：只做字符串拼接，不持有任何素材副本、不做任何解码或变换。
 */

/**
 * 多层素材叠成一条 background 声明。数组顺序即图层顺序，**写在前的在上层**。
 * @param {Array<{src:string, position?:string, size?:string}>} layers
 * @returns {string} 可直接绑到 style 的声明串
 */
function layerStyle(layers) {
  const images = layers.map((l) => `url("${l.src}")`).join(', ');
  const positions = layers.map((l) => l.position || 'center center').join(', ');
  const sizes = layers.map((l) => l.size || 'contain').join(', ');
  return (
    `background-image: ${images};` +
    ` background-repeat: no-repeat;` +
    ` background-position: ${positions};` +
    ` background-size: ${sizes};`
  );
}

module.exports = { layerStyle };
