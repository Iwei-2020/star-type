'use strict';

/**
 * 内存 store —— 承担唯一索引与事务语义
 *
 * 这是**真实实现而非 mock**：唯一索引、复合唯一约束、事务快照回滚都在这里落地，
 * `pairing.js` 与 `handlers.js` 只依赖本文件暴露的接口，不关心底层载体。
 *
 * 后续替换为云数据库时只需重写本文件（保持方法签名），上层逻辑不动。
 *
 * TODO(D-1)：云数据库（文档型）无跨文档事务。云库实现（store-cloud.js）已把 `transaction`
 *   降级为「顺序执行、不回滚」，幂等性由业务层保证。**不虚构云侧事务语义。**
 *
 * `transaction` 既接受**同步回调**（就地快照回滚），也接受**异步回调**（云库路径下
 * store 方法返回 Promise）：异步回调 reject 时同样整体回滚，故上层的 `await store.transaction(...)`
 * 对两种 store 语义一致。
 */

const { raise } = require('./errors.js');

/** 深拷贝，避免外层对象与库内对象互相污染（事务快照依赖此语义）。 */
function clone(value) {
  return value === null || value === undefined ? value : structuredClone(value);
}

/** 复合唯一键的拼接方式（\u0000 不会出现在 user_pseudo_id 中）。 */
function compositeKey(initiatorId, inviteeId) {
  return `${initiatorId}\u0000${inviteeId}`;
}

function createStore() {
  const state = {
    sessions: new Map(), // session_id → 会话记录
    pairings: new Map(), // pair_code → 配对记录
    pairIndex: new Map(), // 复合键 → pair_code（仅登记 invitee_id 非空且非 expired 的记录）
    eventIds: new Set(), // 已接收埋点的 event_id，用于服务端去重
    events: [], // 已接收埋点（内存态，随实例生命周期结束而释放）
  };

  /**
   * 复合键索引维护（(initiator_id, invitee_id) → 最新有效 pair_code）。
   *
   * 实现说明（对 §3.3 的一处必要放宽，已在交付汇报中记录）：
   *   §3.3 要求 (initiator_id, invitee_id) 建**复合唯一**索引，但同时规定
   *   「同一用户对同一好友重复配对 → 直接复用已完成记录」「已有 expired 记录视为新配对，允许新建」。
   *   这两条与硬唯一冲突：发起时 invitee 未知，同一对好友再次发起必然产生两条有效记录
   *   （一条 completed、一条 pending），硬唯一会直接 500。
   *   因此此处把复合键实现为**查询索引**（指向最新有效记录），唯一性由 §3.3 的「复用」语义
   *   在 `pairing.completePair` 中落地（复用已完成记录的同码结果，不重复计算）。
   *   真正的库级唯一约束需云数据库支持冲突回退，随 D-1 一并确认。
   */
  function indexSet(record) {
    if (record.invitee_id === null || record.status === 'expired') return;
    state.pairIndex.set(compositeKey(record.initiator_id, record.invitee_id), record.pair_code);
  }

  function indexClear(record) {
    if (record.invitee_id === null || record.status === 'expired') return;
    const key = compositeKey(record.initiator_id, record.invitee_id);
    if (state.pairIndex.get(key) === record.pair_code) state.pairIndex.delete(key);
  }

  const api = {
    // ── sessions 集合（§5）：session_id 唯一索引 ──

    insertSession(record) {
      if (state.sessions.has(record.session_id)) {
        throw raise.SERVER_ERROR(`session_id 已存在：${record.session_id}`);
      }
      state.sessions.set(record.session_id, clone(record));
      return clone(record);
    },

    getSession(sessionId) {
      return clone(state.sessions.get(sessionId) ?? null);
    },

    /**
     * 取某用户最近一次落库的会话结果。
     * 用途：`completePair` 读取受邀者「已落库的 archetype_code」——这是「只读落库」决策
     * 在 sessions 集合上所需的最小索引（user_pseudo_id 维度）。
     */
    findLatestSessionByUser(userPseudoId) {
      let latest = null;
      for (const rec of state.sessions.values()) {
        if (rec.user_pseudo_id !== userPseudoId) continue;
        if (!latest || rec.ts >= latest.ts) latest = rec;
      }
      return clone(latest);
    },

    // ── pairings 集合：pair_code 唯一索引 + (initiator_id, invitee_id) 复合唯一 ──

    pairCodeExists(pairCode) {
      return state.pairings.has(pairCode);
    },

    getPairing(pairCode) {
      return clone(state.pairings.get(pairCode) ?? null);
    },

    insertPairing(record) {
      if (state.pairings.has(record.pair_code)) {
        throw raise.SERVER_ERROR(`pair_code 已存在：${record.pair_code}`);
      }
      indexSet(record);
      state.pairings.set(record.pair_code, clone(record));
      return clone(record);
    },

    updatePairing(record) {
      const prev = state.pairings.get(record.pair_code);
      if (!prev) throw raise.SERVER_ERROR(`pair_code 不存在：${record.pair_code}`);
      indexClear(prev);
      indexSet(record);
      state.pairings.set(record.pair_code, clone(record));
      return clone(record);
    },

    /**
     * 先到先得：仅当 `invitee_id` 仍为 null 时写入。
     * 与云库实现的 CAS（`where({pair_code, invitee_id:null}).update`）语义一致。
     * @returns {boolean} true=本次写入生效；false=已被他人抢先
     */
    claimInvitee(pairCode, inviteeId) {
      const rec = state.pairings.get(pairCode);
      if (!rec || rec.invitee_id !== null) return false;
      api.updatePairing({ ...clone(rec), invitee_id: inviteeId });
      return true;
    },

    /**
     * 按 (发起者, 受邀者) 查未失效的配对记录。
     * 语义来源（§3.3）：同一用户对同一好友重复配对 → 直接复用已完成记录；
     * 已有 expired 记录则视为新配对，允许新建（故 expired 不占复合索引）。
     */
    findActivePairingByPair(initiatorId, inviteeId) {
      const code = state.pairIndex.get(compositeKey(initiatorId, inviteeId));
      return code ? clone(state.pairings.get(code)) : null;
    },

    // ── events：按 event_id 服务端去重（客户端重试重放时防重复计数） ──

    seenEvent(eventId) {
      return state.eventIds.has(eventId);
    },

    appendEvent(event) {
      state.eventIds.add(event.event_id);
      state.events.push(clone(event));
      return clone(event);
    },

    // ── 事务 ──

    /**
     * 事务快照 + 回滚。fn 抛错时，sessions / pairings / 复合索引整体还原。
     * 同步回调就地回滚；异步回调（返回 Promise）在 reject 时回滚，两种形态语义一致。
     * @param {(store:object)=>any|Promise<any>} fn
     */
    transaction(fn) {
      const snapshot = {
        sessions: new Map([...state.sessions].map(([k, v]) => [k, clone(v)])),
        pairings: new Map([...state.pairings].map(([k, v]) => [k, clone(v)])),
        pairIndex: new Map(state.pairIndex),
        eventIds: new Set(state.eventIds),
        events: clone(state.events),
      };
      const rollback = () => {
        state.sessions = snapshot.sessions;
        state.pairings = snapshot.pairings;
        state.pairIndex = snapshot.pairIndex;
        state.eventIds = snapshot.eventIds;
        state.events = snapshot.events;
      };

      let result;
      try {
        result = fn(api);
      } catch (err) {
        rollback();
        throw err;
      }
      if (result && typeof result.then === 'function') {
        return result.then(
          (value) => value,
          (err) => {
            rollback();
            throw err;
          }
        );
      }
      return result;
    },

    // ── 测试与运维辅助 ──

    stats() {
      return {
        sessions: state.sessions.size,
        pairings: state.pairings.size,
        pairIndexEntries: state.pairIndex.size,
        events: state.events.length,
      };
    },
  };

  return api;
}

module.exports = { createStore, compositeKey };
