'use strict';

/**
 * 唯一数据源（Single Source of Truth）
 *
 * 本文件是《星语人格 · 好友同频测试》全部规则常量的唯一定义处。
 * 依据：《技术资产-研发侧技术方案预研.md》§3.1～3.5；《文案资产-10题题库与计分表.md》。
 *
 * 消费方约定（对应技术资产 §1.2「单一权威实现」）：
 *   - 服务端：直接 require 本文件，用于计算。
 *   - 前端：**不得** require 本文件。前端只消费 `tools/gen-constants.js` 生成到
 *     `miniapp/shared/` 的展示用产物（原型索引、客户端常量），且这些产物中
 *     **不含**任何计分/同频度常量。
 *   - 门禁：`tools/check-client-isolation.js` 会拦截前端对计分常量的引用。
 */

/** 冻结辅助：递归冻结，防止运行期被意外改写。 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// ─────────────────────────────────────────────────────────────
// 一、题库与计分
// ─────────────────────────────────────────────────────────────

/** 题库版本。随题库变更递增，参与结果缓存键与提交幂等键。 */
const QUIZ_VERSION = 'v1';

/** 单次测试必答题目数。答案数不等于该值即拒绝计分。 */
const REQUIRED_ANSWER_COUNT = 10;

/**
 * 维度 → 题号。每题二选一：选 A 记该维度 A 端 +1，选 B 记 B 端 +1，权重恒为 1。
 * 题数分布 3 / 3 / 2 / 2：D1、D2 为奇数题（不可能同分）；D3、D4 为偶数题（可能 1:1 同分）。
 */
const DIM_QUESTIONS = {
  D1: ['Q1', 'Q5', 'Q9'], // 表达取向：外显(A) / 内隐(B)
  D2: ['Q2', 'Q6', 'Q10'], // 能量取向：炽放(A) / 静蓄(B)
  D3: ['Q3', 'Q7'], // 决策取向：理性(A) / 感性(B)
  D4: ['Q4', 'Q8'], // 关系取向：主动(A) / 随和(B)
};

/** 原型码拼接顺序：D1 → D2 → D3 → D4。 */
const DIM_ORDER = ['D1', 'D2', 'D3', 'D4'];

/** 同分时默认取的端点（PRD 3.5 全局唯一规则）。 */
const TIE_BREAK_ENDPOINT = 'A';

// ─────────────────────────────────────────────────────────────
// 二、同频度
// ─────────────────────────────────────────────────────────────

/**
 * 展示值权重。**已冻结**——变更会直接改变 5 档展示值，
 * 须同步修订 PRD 3.5 表格与《测试资产》TC-SM-05 的硬断言。
 */
const W_SAME = 3; // 一致项权重
const W_COMP = 2; // 互补项权重
const FULL = 12; // 满分 = 4 × W_SAME

/** 相处模式标签，下标即一致项数 C（0～4）。标签文案以 PRD 3.5 为唯一权威。 */
const BAND_BY_C = ['极致互补型', '差异互补型', '均衡互补型', '高默契型', '同频共振型'];

// ─────────────────────────────────────────────────────────────
// 三、配对码
// ─────────────────────────────────────────────────────────────

/**
 * 配对码字母表：去除易混字符 I / L / O / 0 / 1。
 * 实测长度 = 31（23 个字母 + 8 个数字），故空间为 31^8 ≈ 8.5e11。
 * 注意：技术资产 §3.5 注释写作「32^8 ≈ 1.1e12」，底数有误；此处以 ALPHABET.length 计算，不写死底数。
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** 配对码位数。展示时按 4-4 分组，存储与传输不带分隔符。 */
const CODE_LEN = 8;

/** 配对码生成冲突重试上限。 */
const CODE_RETRY_LIMIT = 5;

/** 是否允许用户与自己配对。默认关闭，命中返回 PAIR_SELF_NOT_ALLOWED。 */
const ALLOW_SELF_PAIR = false;

/** 配对邀请有效期：7 天（PRD 3.3）。 */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 等待态轮询退避（毫秒），最后一项为上限，页面离开即停止。 */
const POLL_BACKOFF_MS = [3000, 6000, 12000, 30000];

// ─────────────────────────────────────────────────────────────
// 四、16 原型
// ─────────────────────────────────────────────────────────────

/**
 * 原型码 → 展示信息。**禁止用字符串哈希或下标推导**，必须逐条常量声明。
 * 名称逐条取自《文案资产-16人格原型解读.md》§二；symbolId 取自各原型「主导意象」。
 */
const ARCHETYPES = {
  AAAA: { id: 'archetype-aaaa', name: '曜日型', symbolId: 'star-noon' },
  AAAB: { id: 'archetype-aaab', name: '日珥型', symbolId: 'star-prominence' },
  AABA: { id: 'archetype-aaba', name: '彗尾型', symbolId: 'comet-tail' },
  AABB: { id: 'archetype-aabb', name: '极光型', symbolId: 'aurora-curtain' },
  ABAA: { id: 'archetype-abaa', name: '晨星型', symbolId: 'star-dawn' },
  ABAB: { id: 'archetype-abab', name: '双星型', symbolId: 'star-binary' },
  ABBA: { id: 'archetype-abba', name: '潮汐型', symbolId: 'tide-surface' },
  ABBB: { id: 'archetype-abbb', name: '深海型', symbolId: 'deep-current' },
  BAAA: { id: 'archetype-baaa', name: '星芒型', symbolId: 'star-single' },
  BAAB: { id: 'archetype-baab', name: '星雾型', symbolId: 'nebula-mist' },
  BABA: { id: 'archetype-baba', name: '月晕型', symbolId: 'moon-halo' },
  BABB: { id: 'archetype-babb', name: '星砂型', symbolId: 'star-dust' },
  BBAA: { id: 'archetype-bbaa', name: '极星型', symbolId: 'star-polar' },
  BBAB: { id: 'archetype-bbab', name: '萤火型', symbolId: 'deep-glimmer' },
  BBBA: { id: 'archetype-bbba', name: '静湖型', symbolId: 'lake-mirror' },
  BBBB: { id: 'archetype-bbbb', name: '夜幕型', symbolId: 'night-dome' },
};

// ─────────────────────────────────────────────────────────────
// 五、页面、本地存储键、埋点
// ─────────────────────────────────────────────────────────────

/**
 * 页面 ID 枚举。P-06 按「独立页面」计（用户已决策）：物理实现为 components/share-popup，
 * 但组件首次可见时上报一次 page_view(page_id='P-06')，与埋点映射表对齐，避免漏报。
 */
const PAGE_IDS = ['P-01', 'P-02', 'P-03', 'P-04', 'P-05', 'P-06'];

/** 落地来源枚举。具体 k 值映射待平台侧复核（D-1）。 */
const ENTRY_SOURCES = ['scene_short_video', 'scene_share', 'scene_pair', 'direct', 'douyin_task'];

/** 本地存储键（唯一权威，禁止散落定义）。 */
const STORE = {
  SESSION: 'st_session',
  RESULT: 'st_result',
  MY_ROLES: 'st_pair_roles',
  DEVICE: 'st_device',
  PENDING_PAIR: 'st_pending_pair',
};

/** 埋点 12 事件（PRD 第 9 章已确认）。 */
const EVENTS = [
  'page_view',
  'test_start',
  'answer_submit',
  'test_complete',
  'result_view',
  'pair_invite_create',
  'pair_invite_accept',
  'pair_complete',
  'share_click',
  'ad_impression',
  'ad_reward',
  'session_end',
];

/** 埋点公共字段（每条事件必带）。 */
const EVENT_COMMON_FIELDS = [
  'event_id',
  'session_id',
  'user_pseudo_id',
  'app_version',
  'quiz_version',
  'ts',
  'network',
];

/** 埋点批量上报策略。 */
const REPORT_POLICY = {
  BATCH_SIZE: 10, // 队列满 10 条触发
  FLUSH_INTERVAL_MS: 5000, // 或间隔 5s 触发
  QUEUE_LIMIT: 200, // 本地队列上限，超出丢最旧
};

/** 构建期注入的应用版本号，用于埋点 app_version 字段。 */
const APP_VERSION = '0.1.0';

// ─────────────────────────────────────────────────────────────
// 六、错误码
// ─────────────────────────────────────────────────────────────

/**
 * 错误码。0 为成功；其余见技术资产 §6，另新增 2004（见下）。
 * 本表只定义「码 → 语义」，不定义面向用户的中文提示文案——
 * 资产未给出逐条提示语，本阶段不自行编造，文案留待第二阶段由文案侧补齐。
 */
const ERROR_CODES = {
  OK: 0,
  ANSWER_INCOMPLETE: 1001, // 答案不足 10 题 → 返回答题页补齐
  ANSWER_INVALID: 1002, // 选项非法 → 记录日志并中止本次提交
  QUIZ_VERSION_MISMATCH: 1003, // 题库版本不一致 → 提示重新开始
  PAIR_CODE_NOT_FOUND: 2001, // 邀请不存在 → 引导重新发起
  PAIR_EXPIRED: 2002, // 邀请已过期 → P-05 过期态
  PAIR_SELF_NOT_ALLOWED: 2003, // 不可与自己配对
  PAIR_ALREADY_TAKEN: 2004, // 该邀请已被他人接受（新增，补技术资产 §3.3 未定义项）
  SERVER_ERROR: 3001, // 服务端内部错误 → P-04 计算失败态 + 重试
  RATE_LIMITED: 3002, // 限流 → 退避重试，不进入失败态
};

/** 错误码 → 语义标识，便于日志与断言。 */
const ERROR_NAMES = Object.fromEntries(
  Object.entries(ERROR_CODES).map(([name, code]) => [code, name])
);

/** 配对状态机状态。 */
const PAIR_STATUS = ['pending', 'completed', 'expired'];

/** 配对码输入归一化失败原因。 */
const CODE_REJECT_REASONS = ['EMPTY', 'AMBIGUOUS_CHARS', 'INVALID_CODE'];

module.exports = deepFreeze({
  QUIZ_VERSION,
  REQUIRED_ANSWER_COUNT,
  DIM_QUESTIONS,
  DIM_ORDER,
  TIE_BREAK_ENDPOINT,
  W_SAME,
  W_COMP,
  FULL,
  BAND_BY_C,
  ALPHABET,
  CODE_LEN,
  CODE_RETRY_LIMIT,
  ALLOW_SELF_PAIR,
  SESSION_TTL_MS,
  POLL_BACKOFF_MS,
  ARCHETYPES,
  PAGE_IDS,
  ENTRY_SOURCES,
  STORE,
  EVENTS,
  EVENT_COMMON_FIELDS,
  REPORT_POLICY,
  APP_VERSION,
  ERROR_CODES,
  ERROR_NAMES,
  PAIR_STATUS,
  CODE_REJECT_REASONS,
});
