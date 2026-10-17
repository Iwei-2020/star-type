'use strict';

/**
 * 好友配对状态机
 *
 * 依据：《技术资产》§3.3 迁移表 + 本计划 §4.4-③ 补的两条迁移行。
 *
 * 迁移表（状态 × 动作）：
 *   1  (无记录)            + createInvite   → 创建 pending
 *   2  pending, invitee=null + acceptInvite → 写 invitee_id，保持 pending
 *   3  pending, invitee=self + acceptInvite → 幂等，保持 pending（重复接受）
 *   4  pending, invitee=other + acceptInvite → 拒绝 PAIR_ALREADY_TAKEN(2004)   ← 补
 *   5  pending, now > expires_at → 惰性判定为 expired，后续动作一律 PAIR_EXPIRED(2002)
 *   6  pending, invitee=null + completePair（受邀者未显式 accept 直接完成）→ 写 invitee_id   ← 补
 *   7  pending, 双方 code 齐备 + completePair → completed（写 c_count / 百分比 / 标签 / completed_at）
 *   8  pending, 双方 code 未齐备 + completePair → 保持 pending，返回 ready:false（不报错，供前端继续等待）
 *   9  completed + completePair → 幂等，返回首次结果，不重算、不重复上报
 *  10  expired + 任意动作 → 拒绝（expired 记录不可复用，须重新发起）
 *
 * 约定：
 *   - 过期判定一律以**服务端时间**（注入的 `ctx.now`）为准，不接受客户端传入时间。
 *   - `completePair` 入参不含答案，只读双方**已落库**的 `archetype_code`（守住 §1.2 单一权威实现）。
 *   - 自配对默认关闭（`ALLOW_SELF_PAIR = false`），命中抛 PAIR_SELF_NOT_ALLOWED(2003)。
 */

const {
  ARCHETYPES,
  ALLOW_SELF_PAIR,
  DIM_ORDER,
  SESSION_TTL_MS,
  POLL_BACKOFF_MS,
} = require('../../shared/constants.js');
const { raise } = require('./errors.js');
const { generateUniquePairCode, normalizePairCode, formatPairCode } = require('./codes.js');
const { similarity, formatSimilarityPct } = require('./similarity.js');

const PENDING = 'pending';
const COMPLETED = 'completed';
const EXPIRED = 'expired';

/** 校验原型码形态（复用常量表的 16 条白名单）。 */
function assertArchetypeCode(code, label) {
  if (typeof code !== 'string' || !ARCHETYPES[code]) {
    throw raise.ANSWER_INVALID(`${label} 非法原型码：${String(code)}`);
  }
}

/** 归一化配对码；不可用时统一抛 PAIR_CODE_NOT_FOUND，并把拒绝原因放进 meta。 */
function requireNormalizedCode(input) {
  const normalized = normalizePairCode(input);
  if (!normalized.ok) {
    throw raise.PAIR_CODE_NOT_FOUND(`配对码不可用：${normalized.reason}`, {
      reason: normalized.reason,
      char: normalized.char ?? null,
    });
  }
  return normalized.value;
}

/**
 * 读取配对记录并**先落盘**惰性过期。
 * 过期写入独立于后续业务事务：即便后续动作抛错，过期状态也应保留。
 */
async function loadRecord(ctx, pairCode) {
  const record = await ctx.store.getPairing(pairCode);
  if (!record) throw raise.PAIR_CODE_NOT_FOUND(`邀请不存在：${pairCode}`);
  if (record.status === PENDING && ctx.now() > record.expires_at) {
    return ctx.store.updatePairing({ ...record, status: EXPIRED });
  }
  return record;
}

/** 等待态轮询退避：3s → 6s → 12s → 30s（末项为上限）。 */
function nextPollDelay(attempt) {
  const index = Math.max(0, Math.min(Number(attempt) || 0, POLL_BACKOFF_MS.length - 1));
  return POLL_BACKOFF_MS[index];
}

/** pending 视图。 */
function pendingView(record, extra) {
  return {
    status: PENDING,
    pair_code: record.pair_code,
    formatted_pair_code: formatPairCode(record.pair_code),
    initiator_code: record.initiator_code,
    invitee_id: record.invitee_id,
    expires_at: record.expires_at,
    ready: false,
    ...extra,
  };
}

/**
 * 逐维对照明细（P-05 完成态的 4 条对照带）。
 *
 * 只回结构化字段，不回任何面向用户的中文——对外文案集中于文案源，
 * 前端按 `dim` 取 `ui('pair.dims.<dim>.*')` 渲染维度名与两端名（技术资产 §12）。
 *
 * @returns {Array<{dim:string, comp:boolean, a:string, b:string}>}
 *   dim  = 维度标识，顺序即服务端 DIM_ORDER（前端不得自行推导维度顺序）
 *   a/b  = 发起者 / 受邀者在该维度的端点（'A' / 'B'）
 *   comp = 两端是否互补（端点不同；相同即一致）
 */
function dimensionRows(initiatorCode, inviteeCode) {
  return DIM_ORDER.map((dim, index) => {
    const a = String(initiatorCode || '')[index] || '';
    const b = String(inviteeCode || '')[index] || '';
    return { dim, comp: a !== b, a, b };
  });
}

/** completed 视图。 */
function completedView(record, isFirstCompletion) {
  return {
    status: COMPLETED,
    pair_code: record.pair_code,
    formatted_pair_code: formatPairCode(record.pair_code),
    initiator_code: record.initiator_code,
    invitee_code: record.invitee_code,
    c_count: record.c_count,
    p_count: 4 - record.c_count,
    similarity_pct: record.similarity_pct,
    similarity_label: formatSimilarityPct(record.similarity_pct),
    band_label: record.band_label,
    dimensions: dimensionRows(record.initiator_code, record.invitee_code),
    completed_at: record.completed_at,
    ready: true,
    // 仅首次完成时为 true：前端与埋点据此决定是否上报 pair_complete
    isFirstCompletion,
  };
}

/**
 * 创建邀请（P-05 发起侧）。
 * @param {{store:object, now:()=>number, randomInt?:(max:number)=>number}} ctx
 * @param {{user_pseudo_id:string, archetype_code:string}} params
 */
async function createInvite(ctx, params) {
  const userId = params.user_pseudo_id;
  if (!userId) throw raise.ANSWER_INVALID('缺少 user_pseudo_id');
  assertArchetypeCode(params.archetype_code, '发起者结果');

  const ts = ctx.now();
  const pairCode = await generateUniquePairCode((code) => ctx.store.pairCodeExists(code), ctx.randomInt);

  const record = {
    pair_code: pairCode,
    initiator_id: userId,
    invitee_id: null,
    initiator_code: params.archetype_code,
    invitee_code: null,
    status: PENDING,
    c_count: null,
    similarity_pct: null,
    band_label: null,
    created_at: ts,
    expires_at: ts + SESSION_TTL_MS,
    completed_at: null,
  };
  await ctx.store.insertPairing(record);

  return {
    pair_code: pairCode,
    formatted_pair_code: formatPairCode(pairCode),
    expires_at: record.expires_at,
  };
}

/**
 * 接受邀请（受邀者进入 P-05）。
 * @param {object} ctx
 * @param {{pair_code:string, user_pseudo_id:string}} params
 */
async function acceptInvite(ctx, params) {
  const userId = params.user_pseudo_id;
  if (!userId) throw raise.ANSWER_INVALID('缺少 user_pseudo_id');
  const pairCode = requireNormalizedCode(params.pair_code);

  const record = await loadRecord(ctx, pairCode);

  if (record.status === EXPIRED) {
    throw raise.PAIR_EXPIRED('邀请已过期，可重新发起', { status: EXPIRED, pair_code: pairCode });
  }
  if (record.status === COMPLETED) {
    return { ...completedView(record, false), isFirstAccept: false };
  }
  if (!ALLOW_SELF_PAIR && record.initiator_id === userId) {
    throw raise.PAIR_SELF_NOT_ALLOWED('不能与自己配对');
  }
  if (record.invitee_id !== null && record.invitee_id !== userId) {
    throw raise.PAIR_ALREADY_TAKEN('该邀请已被他人接受', { pair_code: pairCode });
  }

  // 首次接受用条件更新（CAS）落位，避免多实例并发下两个受邀者同时写入
  const isFirstAccept = record.invitee_id === null;
  let updated = record;
  if (isFirstAccept) {
    const won = await ctx.store.claimInvitee(pairCode, userId);
    if (!won) throw raise.PAIR_ALREADY_TAKEN('该邀请已被他人接受', { pair_code: pairCode });
    updated = { ...record, invitee_id: userId };
  }

  return { ...pendingView(updated, {}), isFirstAccept };
}

/**
 * 查询配对状态（发起者轮询）。
 * @param {object} ctx
 * @param {{pair_code:string, attempt?:number}} params
 */
async function getPairStatus(ctx, params) {
  const pairCode = requireNormalizedCode(params.pair_code);
  const record = await loadRecord(ctx, pairCode);

  if (record.status === EXPIRED) {
    throw raise.PAIR_EXPIRED('邀请已过期，可重新发起', { status: EXPIRED, pair_code: pairCode });
  }
  if (record.status === COMPLETED) {
    return completedView(record, false);
  }
  return pendingView(record, {
    has_invitee: record.invitee_id !== null,
    retry_after_ms: nextPollDelay(params.attempt),
  });
}

/**
 * 完成配对（受邀者完成本人测试后调用；也可由发起者触发收口）。
 *
 * 入参**不含答案**：双方 code 均从已落库记录读取（发起者 code 取自创建时的快照，
 * 受邀者 code 取自 sessions 集合中该用户最近一次落库结果）。因此本函数不构成第二计分入口。
 *
 * @param {object} ctx
 * @param {{pair_code:string, user_pseudo_id:string}} params
 */
async function completePair(ctx, params) {
  const userId = params.user_pseudo_id;
  if (!userId) throw raise.ANSWER_INVALID('缺少 user_pseudo_id');
  const pairCode = requireNormalizedCode(params.pair_code);

  const record = await loadRecord(ctx, pairCode);

  if (record.status === EXPIRED) {
    throw raise.PAIR_EXPIRED('邀请已过期，可重新发起', { status: EXPIRED, pair_code: pairCode });
  }
  // 幂等：已完成则直接返回首次结果，不重算、不上报
  if (record.status === COMPLETED) {
    return completedView(record, false);
  }

  const isParty =
    userId === record.initiator_id || userId === record.invitee_id || record.invitee_id === null;
  if (!isParty) {
    throw raise.PAIR_CODE_NOT_FOUND(`调用者既非发起者也非受邀者：${pairCode}`);
  }
  if (!ALLOW_SELF_PAIR && record.initiator_id === userId && record.invitee_id === null) {
    throw raise.PAIR_SELF_NOT_ALLOWED('不能与自己配对');
  }

  // 受邀者未显式 accept 即直接完成的情形：此处补齐 invitee_id（迁移表第 6 行）
  const inviteeId = record.invitee_id === null ? userId : record.invitee_id;
  const inviterCode = record.initiator_code;
  const inviteeSession = await ctx.store.findLatestSessionByUser(inviteeId);
  const inviteeCode = inviteeSession ? inviteeSession.archetype_code : null;

  // 云库无跨文档事务，transaction 为「顺序执行、不回滚」；幂等由上方 COMPLETED 分支与 CAS 保证
  return ctx.store.transaction(async (store) => {
    // 先落定受邀者归属（即使结果未齐备也要占位，避免并发被他人顶替）
    let current = record;
    if (current.invitee_id === null) {
      current = await store.updatePairing({ ...current, invitee_id: inviteeId });
    }

    // 双方结果未齐备：不报错，返回 pending 供前端继续等待（迁移表第 8 行）
    if (!inviterCode || !inviteeCode) {
      return pendingView(current, { has_invitee: true, retry_after_ms: nextPollDelay(0) });
    }

    // §3.3：同一对好友已有完成的同码配对 → 直接复用，不重复计算
    const existing = await store.findActivePairingByPair(current.initiator_id, inviteeId);
    const canReuse =
      existing &&
      existing.pair_code !== current.pair_code &&
      existing.status === COMPLETED &&
      existing.initiator_code === inviterCode &&
      existing.invitee_code === inviteeCode;

    const metrics = canReuse
      ? { c: existing.c_count, pct: existing.similarity_pct, band: existing.band_label }
      : (() => {
          const s = similarity(inviterCode, inviteeCode);
          return { c: s.c, pct: s.similarityPct, band: s.band };
        })();

    const updated = await store.updatePairing({
      ...current,
      invitee_code: inviteeCode,
      status: COMPLETED,
      c_count: metrics.c,
      similarity_pct: metrics.pct,
      band_label: metrics.band,
      completed_at: ctx.now(),
    });

    return completedView(updated, true);
  });
}

module.exports = {
  PENDING,
  COMPLETED,
  EXPIRED,
  createInvite,
  acceptInvite,
  getPairStatus,
  completePair,
  nextPollDelay,
  pendingView,
  completedView,
  loadRecord,
};
