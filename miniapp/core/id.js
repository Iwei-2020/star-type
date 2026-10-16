'use strict';

/**
 * 客户端标识生成器。
 *
 * 抖音小程序运行环境不提供 Web Crypto，故此处**不依赖任何加密能力**：
 * 生成的标识仅用于「本地会话/埋点条目不重复」，非安全用途（不做鉴权、不做加密）。
 * 生产环境若需更强随机性，应注入宿主提供的能力（如平台侧随机源）。
 *
 * 服务端侧的 UUID 由 `crypto.randomUUID` 生成（见 server/functions/*），两者互不相干。
 */

/** 生成一个形如 `sess-lx2k9-3f8a1c2d` 的本地唯一标识。 */
function newId(prefix) {
  const head = prefix ? `${prefix}-` : '';
  const part = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `${head}${Date.now().toString(36)}-${part()}${part().slice(0, 4)}`;
}

module.exports = { newId };
