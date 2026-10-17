'use strict';

/**
 * 云数据库 store 单测
 * 用「假 dySDK」在内存里模拟云数据库的 add / doc / where / update / set 语义，
 * 覆盖：_id 唯一键插入与冲突、替换式写入、CAS（先到先得）、补丁式分页查找、事件去重、
 * 以及「无事务」降级行为。另覆盖 store-provider 的运行时选择与显式降级告警。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { ERROR_CODES } = require('../shared/constants.js');
const { createCloudStore } = require('../server/lib/store-cloud.js');
const { createRuntimeStore } = require('../server/lib/store-provider.js');

// ─────────────────────────────────────────────────────────────
// 假 dySDK：内存实现云数据库集合语义
// ─────────────────────────────────────────────────────────────

const NEQ = Symbol('neq');

/**
 * 匹配查询条件。条件值可为普通值（严格相等）或 `command.neq(v)` 的哨兵对象。
 */
function matches(doc, cond) {
  for (const key of Object.keys(cond)) {
    const expect = cond[key];
    if (expect && typeof expect === 'object' && expect[NEQ] !== undefined) {
      if (doc[key] === expect[NEQ]) return false;
    } else if (doc[key] !== expect) {
      return false;
    }
  }
  return true;
}

function makeFakeDySDK() {
  const tables = new Map(); // 集合名 → Map(_id → doc)
  let autoId = 0;

  function table(name) {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  }

  function makeDocument(name, id) {
    return {
      async get() {
        const doc = table(name).get(id);
        return { data: doc ? [{ ...doc }] : [] };
      },
      async set(obj) {
        if (obj._id !== undefined) {
          throw Object.assign(new Error('_id值不能更新'), { errorCode: 156401 });
        }
        // 替换式写入（不存在则插入）
        table(name).set(id, { ...obj, _id: id });
        return { updated: 1 };
      },
      async update(obj) {
        if (obj._id !== undefined) {
          throw Object.assign(new Error('_id值不能更新'), { errorCode: 156401 });
        }
        const doc = table(name).get(id);
        if (!doc) return { updated: 0 };
        Object.assign(doc, obj);
        return { updated: 1 };
      },
      async remove() {
        return { deleted: table(name).delete(id) ? 1 : 0 };
      },
    };
  }

  function makeCollection(name) {
    const query = {
      _filters: [],
      _limit: null,
      _orders: [],
      _skip: 0,
      doc(id) {
        return makeDocument(name, id);
      },
      where(cond) {
        query._filters.push(cond);
        return query;
      },
      limit(n) {
        query._limit = n;
        return query;
      },
      orderBy(field, order) {
        query._orders.push([field, order]);
        return query;
      },
      skip(n) {
        query._skip = n;
        return query;
      },
      field() {
        return query;
      },
      _rows() {
        return [...table(name).values()].filter((doc) => query._filters.every((c) => matches(doc, c)));
      },
      async get() {
        let rows = query._rows();
        for (const [field, order] of [...query._orders].reverse()) {
          rows.sort((a, b) => (order === 'desc' ? (b[field] ?? 0) - (a[field] ?? 0) : (a[field] ?? 0) - (b[field] ?? 0)));
        }
        if (query._skip) rows = rows.slice(query._skip);
        if (query._limit != null) rows = rows.slice(0, query._limit);
        return { data: rows.map((doc) => ({ ...doc })) };
      },
      async count() {
        return { total: query._rows().length };
      },
      async update(patch) {
        let updated = 0;
        for (const doc of query._rows()) {
          Object.assign(doc, patch);
          updated += 1;
        }
        return { updated };
      },
      async remove() {
        const rows = query._rows();
        for (const doc of rows) table(name).delete(doc._id);
        return { deleted: rows.length };
      },
      async add(obj) {
        if (obj._id !== undefined && table(name).has(obj._id)) {
          throw Object.assign(new Error('_id 冲突'), { errorCode: 156401 });
        }
        const id = obj._id !== undefined ? obj._id : `auto-${++autoId}`;
        table(name).set(id, { ...obj, _id: id });
        return { id };
      },
    };
    return query;
  }

  const database = {
    collection: (name) => makeCollection(name),
    command: { neq: (v) => ({ [NEQ]: v }) },
  };

  return { database: () => database };
}

function makeStore() {
  return createCloudStore(makeFakeDySDK());
}

// ─────────────────────────────────────────────────────────────
// 云库 store
// ─────────────────────────────────────────────────────────────

test('云库 store：session 以 _id 唯一，重复插入即冲突，读出不含库侧 _id', async () => {
  const store = makeStore();
  const rec = { session_id: 's-1', user_pseudo_id: 'u', quiz_version: 'v1', archetype_code: 'AAAA', ts: 1 };

  const inserted = await store.insertSession(rec);
  assert.equal(inserted.session_id, 's-1');
  assert.ok(!('_id' in inserted));

  const got = await store.getSession('s-1');
  assert.equal(got.archetype_code, 'AAAA');
  assert.ok(!('_id' in got), '读出的记录不应暴露库侧 _id');

  await assert.rejects(() => store.insertSession(rec), (err) => err.code === ERROR_CODES.SERVER_ERROR);
  assert.equal(await store.getSession('missing'), null);
});

test('云库 store：findLatestSessionByUser 按 ts 取最新（orderBy desc + limit 1）', async () => {
  const store = makeStore();
  await store.insertSession({ session_id: 's-1', user_pseudo_id: 'u', ts: 10, archetype_code: 'AAAA' });
  await store.insertSession({ session_id: 's-2', user_pseudo_id: 'u', ts: 20, archetype_code: 'BBBB' });
  await store.insertSession({ session_id: 's-3', user_pseudo_id: 'other', ts: 30, archetype_code: 'CCCC' });

  const latest = await store.findLatestSessionByUser('u');
  assert.equal(latest.session_id, 's-2');
  assert.equal(await store.findLatestSessionByUser('nobody'), null);
});

test('云库 store：配对码唯一 + claimInvitee 为条件更新（先到先得）', async () => {
  const store = makeStore();
  const rec = { pair_code: 'ABCDEFGH', initiator_id: 'userA', invitee_id: null, status: 'pending', created_at: 1 };

  await store.insertPairing(rec);
  assert.equal(await store.pairCodeExists('ABCDEFGH'), true);
  assert.equal(await store.pairCodeExists('ZZZZZZZZ'), false);
  await assert.rejects(() => store.insertPairing(rec), (err) => err.code === ERROR_CODES.SERVER_ERROR);

  assert.equal(await store.claimInvitee('ABCDEFGH', 'userB'), true, '首个受邀者应取得占位');
  assert.equal(await store.claimInvitee('ABCDEFGH', 'userC'), false, '已有受邀者时 CAS 应返回 updated:0');
  assert.equal((await store.getPairing('ABCDEFGH')).invitee_id, 'userB');
});

test('云库 store：updatePairing 为替换式写入（set）', async () => {
  const store = makeStore();
  await store.insertPairing({ pair_code: 'ABCDEFGH', initiator_id: 'userA', invitee_id: null, status: 'pending', created_at: 1, completed_at: null });

  await store.updatePairing({ pair_code: 'ABCDEFGH', initiator_id: 'userA', invitee_id: 'userB', status: 'completed', created_at: 1, completed_at: 9 });

  const got = await store.getPairing('ABCDEFGH');
  assert.equal(got.status, 'completed');
  assert.equal(got.invitee_id, 'userB');
  assert.equal(got.completed_at, 9);
});

test('云库 store：findActivePairingByPair 排除 expired，取最新有效记录', async () => {
  const store = makeStore();
  await store.insertPairing({ pair_code: 'AAAABBBB', initiator_id: 'userA', invitee_id: 'userB', status: 'completed', created_at: 1 });
  await store.insertPairing({ pair_code: 'CCCCDDDD', initiator_id: 'userA', invitee_id: 'userB', status: 'expired', created_at: 2 });

  const found = await store.findActivePairingByPair('userA', 'userB');
  assert.equal(found.pair_code, 'AAAABBBB', 'expired 记录不应被命中');
  assert.equal(await store.findActivePairingByPair('userA', 'userC'), null);
});

test('云库 store：appendEvent 以 _id 去重，seenEvent 可判重', async () => {
  const store = makeStore();
  const ev = { event_id: 'evt-1', event_name: 'test_start' };

  assert.equal(await store.seenEvent('evt-1'), false);
  await store.appendEvent(ev);
  assert.equal(await store.seenEvent('evt-1'), true);
  await assert.rejects(() => store.appendEvent(ev), (err) => err.code === ERROR_CODES.SERVER_ERROR);
});

test('云库 store：transaction 降级为顺序执行（无回滚，写入保留）', async () => {
  const store = makeStore();

  const out = await store.transaction(async (s) => {
    await s.insertSession({ session_id: 's-tx', user_pseudo_id: 'u', ts: 1, archetype_code: 'AAAA' });
    return 'done';
  });
  assert.equal(out, 'done');
  assert.ok(await store.getSession('s-tx'), '云库无事务：写入不被回滚');

  await assert.rejects(() => store.transaction(async () => {
    throw new Error('boom');
  }), /boom/);
});

test('云库 store：stats 通过各集合 count 汇总', async () => {
  const store = makeStore();
  await store.insertSession({ session_id: 's-1', user_pseudo_id: 'u', ts: 1, archetype_code: 'AAAA' });
  await store.insertPairing({ pair_code: 'ABCDEFGH', initiator_id: 'userA', invitee_id: null, status: 'pending', created_at: 1 });
  await store.appendEvent({ event_id: 'evt-1' });

  assert.deepEqual(await store.stats(), { sessions: 1, pairings: 1, events: 1 });
});

// ─────────────────────────────────────────────────────────────
// 运行时选择
// ─────────────────────────────────────────────────────────────

test('运行时选择：SDK 可用 → 云库 store（方法返回 Promise）', () => {
  const store = createRuntimeStore({ warn() {} }, () => makeFakeDySDK());
  const probe = store.pairCodeExists('X');
  assert.ok(probe instanceof Promise, '云库 store 方法应为异步');
});

test('运行时选择：SDK 不可用 → 降级内存 store 并显式告警（禁止静默降级）', () => {
  const warnings = [];
  const store = createRuntimeStore({ warn: (msg) => warnings.push(msg) }, () => {
    throw new Error('MODULE_NOT_FOUND');
  });

  assert.equal(store.pairCodeExists('X'), false, '内存 store 方法为同步返回');
  assert.equal(warnings.length, 1, '降级必须显式告警');
  assert.match(warnings[0], /降级为内存 store/);
});

test('运行时选择：SDK 存在但未暴露 database() → 同样降级并告警', () => {
  const warnings = [];
  const store = createRuntimeStore({ warn: (msg) => warnings.push(msg) }, () => ({}));
  assert.equal(store.pairCodeExists('X'), false);
  assert.equal(warnings.length, 1);
});
