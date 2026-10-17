'use strict';

/**
 * 云数据库 store —— 抖音云云数据库（文档型）实现
 *
 * 依据：《平台规则检索记录》R-8、《技术资产》§6 / §12、《待确认项台账》D-1。
 * 服务端唯一通道为官方 Node SDK：`@open-dy/node-server-sdk` → `dySDK.database()`。
 * 文档：…/cloud-database/server/sdk-collection、…/server/sdk-document。
 *
 * 与内存实现（store.js）的关系：**方法签名一一对应**，差异只在载体语义：
 *   1) 全部方法返回 Promise（云库 IO 天然异步）。上层 handler / pairing 统一 `await`，
 *      因此同一套上层逻辑对两种 store 都成立（`await 同步值` 合法）。
 *   2) 唯一索引由集合的 `_id` 承担：sessions 用 session_id、pairings 用 pair_code、
 *      events 用 event_id 作 `_id`。`add` 在 `_id` 与已有记录冲突时失败 —— 天然唯一键插入。
 *      **错误处理不依赖具体 errorCode**：catch 后回读同 `_id`，读到即判为「冲突/重复」，
 *      读不到则原样抛出（避免把真实故障误判成冲突）。
 *   3) 「先到先得」改用条件更新（CAS）：`where({pair_code, invitee_id: null}).update`
 *      返回 `updated:0|1`，`0` 即已被占用，解决多实例下并发接受的竞态。
 *   4) **服务端 SDK 无跨文档事务** → `transaction` 降级为「顺序执行、不回滚」：
 *      幂等性由业务层保证（如 pairing.completePair 的「已完成即返回首结果」分支）。
 *      **不虚构云侧事务语义。**
 *
 * 集合（首次写入即创建；需在抖音云控制台开启「云数据库」组件后生效）：
 *   - st_sessions  _id = session_id
 *   - st_pairings  _id = pair_code
 *   - st_events    _id = event_id
 */

const { raise } = require('./errors.js');

const C_SESSIONS = 'st_sessions';
const C_PAIRINGS = 'st_pairings';
const C_EVENTS = 'st_events';
const EXPIRED = 'expired';

/** 去掉库侧 `_id`，使读出的记录字段口径与内存实现一致。 */
function stripId(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

/** `doc(id).get()` → 单条记录或 null。 */
async function readDoc(collection, id) {
  const res = await collection.doc(id).get();
  const rows = (res && res.data) || [];
  return rows.length > 0 ? rows[0] : null;
}

/** 唯一键冲突判定：写失败后回读同 `_id`，存在即冲突。 */
async function insertUnique(collection, id, doc, conflictMessage) {
  try {
    await collection.add({ ...doc, _id: id });
  } catch (err) {
    if (await readDoc(collection, id)) throw raise.SERVER_ERROR(conflictMessage);
    throw err;
  }
}

/**
 * @param {{database:()=>object}} dySDK 官方 SDK 的 `dySDK`（`database()` 返回数据库实例）
 */
function createCloudStore(dySDK) {
  const database = dySDK.database();
  const command = database.command;

  const api = {
    // ── sessions（_id = session_id）──

    async insertSession(record) {
      await insertUnique(
        database.collection(C_SESSIONS),
        record.session_id,
        record,
        `session_id 已存在：${record.session_id}`
      );
      return { ...record };
    },

    async getSession(sessionId) {
      return stripId(await readDoc(database.collection(C_SESSIONS), sessionId));
    },

    async findLatestSessionByUser(userPseudoId) {
      const res = await database
        .collection(C_SESSIONS)
        .where({ user_pseudo_id: userPseudoId })
        .orderBy('ts', 'desc')
        .limit(1)
        .get();
      const rows = (res && res.data) || [];
      return rows.length > 0 ? stripId(rows[0]) : null;
    },

    // ── pairings（_id = pair_code）──

    async pairCodeExists(pairCode) {
      return !!(await readDoc(database.collection(C_PAIRINGS), pairCode));
    },

    async getPairing(pairCode) {
      return stripId(await readDoc(database.collection(C_PAIRINGS), pairCode));
    },

    async insertPairing(record) {
      await insertUnique(
        database.collection(C_PAIRINGS),
        record.pair_code,
        record,
        `pair_code 已存在：${record.pair_code}`
      );
      return { ...record };
    },

    async updatePairing(record) {
      // set 为替换式写入；须剔除 `_id`（SDK 不允许更新 _id）
      await database.collection(C_PAIRINGS).doc(record.pair_code).set(stripId(record));
      return { ...record };
    },

    /**
     * 先到先得：仅当 invitee_id 仍为 null 时写入。
     * @returns {Promise<boolean>} true=本次写入生效；false=已被他人抢先（`updated:0`）
     */
    async claimInvitee(pairCode, inviteeId) {
      const res = await database
        .collection(C_PAIRINGS)
        .where({ pair_code: pairCode, invitee_id: null })
        .update({ invitee_id: inviteeId });
      return res.updated === 1;
    },

    /**
     * 按 (发起者, 受邀者) 查未失效记录。
     * 语义来源（§3.3）：同对好友重复配对 → 复用已完成记录；expired 不占索引。
     */
    async findActivePairingByPair(initiatorId, inviteeId) {
      const res = await database
        .collection(C_PAIRINGS)
        .where({ initiator_id: initiatorId, invitee_id: inviteeId, status: command.neq(EXPIRED) })
        .orderBy('created_at', 'desc')
        .limit(1)
        .get();
      const rows = (res && res.data) || [];
      return rows.length > 0 ? stripId(rows[0]) : null;
    },

    // ── events（_id = event_id，服务端去重）──

    async seenEvent(eventId) {
      return !!(await readDoc(database.collection(C_EVENTS), eventId));
    },

    async appendEvent(event) {
      await insertUnique(
        database.collection(C_EVENTS),
        event.event_id,
        event,
        `event_id 已存在：${event.event_id}`
      );
      return { ...event };
    },

    // ── 事务（降级）──

    /**
     * 云数据库无跨文档事务：只顺序执行回调、不回滚。
     * @param {(store:object)=>Promise<any>} fn
     */
    async transaction(fn) {
      return fn(api);
    },

    // ── 运维辅助 ──

    async stats() {
      const [sessions, pairings, events] = await Promise.all([
        database.collection(C_SESSIONS).count(),
        database.collection(C_PAIRINGS).count(),
        database.collection(C_EVENTS).count(),
      ]);
      return { sessions: sessions.total, pairings: pairings.total, events: events.total };
    },
  };

  return api;
}

module.exports = { createCloudStore, COLLECTIONS: { C_SESSIONS, C_PAIRINGS, C_EVENTS } };
