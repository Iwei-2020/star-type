'use strict';

/**
 * 配对状态机单测
 * 覆盖：《测试资产》TC-PA-01～10 + §3.3 迁移表 10 行 + 事务回滚。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ARCHETYPES,
  SESSION_TTL_MS,
  POLL_BACKOFF_MS,
  ERROR_CODES,
} = require('../shared/constants.js');
const { createStore } = require('../server/lib/store.js');
const {
  createInvite,
  acceptInvite,
  getPairStatus,
  completePair,
  nextPollDelay,
} = require('../server/lib/pairing.js');

const T0 = 1_700_000_000_000; // 固定基准时间，避免用例依赖真实时钟

/** 可控上下文：固定起点时间 + 确定性随机源 + 内存 store。 */
function makeCtx() {
  const store = createStore();
  let t = T0;
  let counter = 0;
  return {
    store,
    now: () => t,
    // 依次取字母表下标，使配对码可预期且互不重复
    randomInt: (max) => counter++ % max,
    advance: (ms) => {
      t += ms;
    },
    setNow: (v) => {
      t = v;
    },
  };
}

/** 模拟 computeResult 落库（受邀者/发起者的结果来源）。 */
function seedResult(ctx, user, code) {
  assert.ok(ARCHETYPES[code], `非法原型码 ${code}`);
  return ctx.store.insertSession({
    session_id: `sess-${user}`,
    user_pseudo_id: user,
    quiz_version: 'v1',
    archetype_code: code,
    archetype_id: ARCHETYPES[code].id,
    ts: ctx.now(),
  });
}

function expectCode(fn, code, messagePattern) {
  assert.throws(fn, (err) => {
    assert.equal(err.code, code, `期望错误码 ${code}，实际 ${err.code}（${err.message}）`);
    if (messagePattern) assert.match(err.message, messagePattern);
    return true;
  });
}

test('TC-PA-01：创建邀请 → 8 位码、pending、有效期为 7 天', () => {
  const ctx = makeCtx();
  seedResult(ctx, 'userA', 'ABAB');
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });

  assert.equal(inv.pair_code.length, 8);
  assert.equal(inv.formatted_pair_code, `${inv.pair_code.slice(0, 4)}-${inv.pair_code.slice(4)}`);
  assert.equal(inv.expires_at, T0 + SESSION_TTL_MS);

  const record = ctx.store.getPairing(inv.pair_code);
  assert.equal(record.status, 'pending');
  assert.equal(record.initiator_id, 'userA');
  assert.equal(record.invitee_id, null);
  assert.equal(record.initiator_code, 'ABAB');
  assert.equal(record.invitee_code, null);
  assert.equal(record.c_count, null);
  assert.equal(record.completed_at, null);
});

test('TC-PA-01 补充：发起者结果非法原型码 → ANSWER_INVALID', () => {
  const ctx = makeCtx();
  expectCode(
    () => createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ZZZZ' }),
    ERROR_CODES.ANSWER_INVALID
  );
  expectCode(
    () => createInvite(ctx, { archetype_code: 'ABAB' }),
    ERROR_CODES.ANSWER_INVALID
  );
});

test('TC-PA-02：受邀者接受 → 写 invitee_id，状态仍 pending，isFirstAccept=true', () => {
  const ctx = makeCtx();
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });

  const r1 = acceptInvite(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });
  assert.equal(r1.status, 'pending');
  assert.equal(r1.isFirstAccept, true);
  assert.equal(r1.invitee_id, 'userB');
  assert.equal(r1.initiator_code, 'ABAB');

  const record = ctx.store.getPairing(inv.pair_code);
  assert.equal(record.invitee_id, 'userB');
  assert.equal(record.status, 'pending');
});

test('TC-PA-02 补充：小写/带连字符的配对码可接受（归一化）', () => {
  const ctx = makeCtx();
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });
  const r = acceptInvite(ctx, {
    pair_code: inv.formatted_pair_code.toLowerCase(),
    user_pseudo_id: 'userB',
  });
  assert.equal(r.status, 'pending');
});

test('TC-PA-03：受邀者未显式 accept 直接 completePair → 补齐 invitee_id 并完成（迁移表第 6 行）', () => {
  const ctx = makeCtx();
  seedResult(ctx, 'userB', 'ABAB');
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });

  const r = completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });
  assert.equal(r.status, 'completed');
  assert.equal(r.isFirstCompletion, true);
  assert.equal(r.invitee_code, 'ABAB');

  const record = ctx.store.getPairing(inv.pair_code);
  assert.equal(record.invitee_id, 'userB');
  assert.equal(record.status, 'completed');
});

test('TC-PA-04：同码双方 → C=4, P=0, 100%, 同频共振型', () => {
  const ctx = makeCtx();
  seedResult(ctx, 'userB', 'ABAB');
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });

  const r = completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });
  assert.equal(r.c_count, 4);
  assert.equal(r.p_count, 0);
  assert.equal(r.similarity_pct, 100);
  assert.equal(r.similarity_label, '100%');
  assert.equal(r.band_label, '同频共振型');
  assert.equal(r.completed_at, T0);
});

test('TC-PA-04 补充：异码双方 → 91.7% 高默契型', () => {
  const ctx = makeCtx();
  seedResult(ctx, 'userB', 'ABAA');
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });

  const r = completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });
  assert.equal(r.c_count, 3);
  assert.equal(r.p_count, 1);
  assert.equal(r.similarity_pct, 91.7);
  assert.equal(r.band_label, '高默契型');
});

test('TC-PA-05：受邀者结果未齐备 → 不报错，返回 ready:false 并占位 invitee_id（迁移表第 8 行）', () => {
  const ctx = makeCtx();
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });

  // userB 尚未落库结果
  const r = completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });
  assert.equal(r.status, 'pending');
  assert.equal(r.ready, false);
  assert.equal(r.has_invitee, true);

  // 占位已落库，避免并发被他人顶替
  const record = ctx.store.getPairing(inv.pair_code);
  assert.equal(record.invitee_id, 'userB');
  assert.equal(record.status, 'pending');
});

test('TC-PA-05 补充：结果就绪后重新调用 → 正常完成', () => {
  const ctx = makeCtx();
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });
  const first = completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });
  assert.equal(first.ready, false);

  seedResult(ctx, 'userB', 'BABA');
  const second = completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });
  assert.equal(second.status, 'completed');
  assert.equal(second.isFirstCompletion, true);
  assert.equal(second.c_count, 0);
  assert.equal(second.similarity_pct, 66.7);
  assert.equal(second.band_label, '极致互补型');
});

test('TC-PA-06：完成后重复调用 → 幂等，返回首次结果且不重算、不重复上报（迁移表第 9 行）', () => {
  const ctx = makeCtx();
  seedResult(ctx, 'userB', 'ABAB');
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });

  const first = completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });
  assert.equal(first.isFirstCompletion, true);
  const stamp = ctx.store.getPairing(inv.pair_code).completed_at;

  ctx.advance(60_000);
  const second = completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });
  assert.equal(second.isFirstCompletion, false);
  assert.equal(second.c_count, first.c_count);
  assert.equal(second.similarity_pct, first.similarity_pct);
  assert.equal(second.band_label, first.band_label);
  assert.equal(ctx.store.getPairing(inv.pair_code).completed_at, stamp, 'completed_at 不应被刷新');
});

test('TC-PA-07：过期 → getPairStatus 抛 PAIR_EXPIRED(2002)，且记录惰性落为 expired（迁移表第 5 行）', () => {
  const ctx = makeCtx();
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });

  assert.equal(getPairStatus(ctx, { pair_code: inv.pair_code }).status, 'pending');

  ctx.advance(SESSION_TTL_MS + 1);
  expectCode(() => getPairStatus(ctx, { pair_code: inv.pair_code }), ERROR_CODES.PAIR_EXPIRED);
  assert.equal(ctx.store.getPairing(inv.pair_code).status, 'expired');
});

test('TC-PA-07 补充：过期判定用服务端时间，恰好等于 expires_at 时仍有效（用 > 而非 >=）', () => {
  const ctx = makeCtx();
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });
  ctx.setNow(inv.expires_at);
  assert.equal(getPairStatus(ctx, { pair_code: inv.pair_code }).status, 'pending');
});

test('TC-PA-08：过期后 acceptInvite / completePair 均被拒（迁移表第 10 行）', () => {
  const ctx = makeCtx();
  seedResult(ctx, 'userB', 'ABAB');
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });
  ctx.advance(SESSION_TTL_MS + 1);

  expectCode(() => acceptInvite(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' }), ERROR_CODES.PAIR_EXPIRED);
  expectCode(() => completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' }), ERROR_CODES.PAIR_EXPIRED);
});

test('TC-PA-09：自配对默认关闭 → 2003（acceptInvite 与 completePair 两处）', () => {
  const ctx = makeCtx();
  seedResult(ctx, 'userA', 'ABAB');
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });

  expectCode(() => acceptInvite(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userA' }), ERROR_CODES.PAIR_SELF_NOT_ALLOWED);
  expectCode(() => completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userA' }), ERROR_CODES.PAIR_SELF_NOT_ALLOWED);
  assert.equal(ctx.store.getPairing(inv.pair_code).invitee_id, null, '自配对被拒后不应留下 invitee_id');
});

test('TC-PA-10：已被他人接受 → 2004（迁移表第 4 行）', () => {
  const ctx = makeCtx();
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });
  acceptInvite(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });

  expectCode(() => acceptInvite(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userC' }), ERROR_CODES.PAIR_ALREADY_TAKEN);
  assert.equal(ctx.store.getPairing(inv.pair_code).invitee_id, 'userB', '拒绝后不应覆盖原受邀者');
});

test('TC-PA-10 补充：同一受邀者重复接受 → 幂等成功，isFirstAccept=false（迁移表第 3 行）', () => {
  const ctx = makeCtx();
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });

  const r1 = acceptInvite(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });
  assert.equal(r1.isFirstAccept, true);
  const r2 = acceptInvite(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });
  assert.equal(r2.status, 'pending');
  assert.equal(r2.isFirstAccept, false);
});

test('TC-PA-10 补充：已完成的邀请再次 accept → 返回 completed（幂等读取）', () => {
  const ctx = makeCtx();
  seedResult(ctx, 'userB', 'ABAB');
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });
  completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });

  const r = acceptInvite(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });
  assert.equal(r.status, 'completed');
  assert.equal(r.band_label, '同频共振型');
});

test('邀请不存在 / 配对码不可用 → 2001，并把拒绝原因放进 meta', () => {
  const ctx = makeCtx();
  expectCode(() => acceptInvite(ctx, { pair_code: 'ABCDEFGH', user_pseudo_id: 'userB' }), ERROR_CODES.PAIR_CODE_NOT_FOUND);
  expectCode(() => getPairStatus(ctx, { pair_code: 'ABCDEFGH' }), ERROR_CODES.PAIR_CODE_NOT_FOUND);

  assert.throws(
    () => acceptInvite(ctx, { pair_code: 'K7QXI9T2', user_pseudo_id: 'userB' }),
    (err) => {
      assert.equal(err.code, ERROR_CODES.PAIR_CODE_NOT_FOUND);
      assert.equal(err.meta.reason, 'AMBIGUOUS_CHARS', '歧义字符应被明确拒绝，不做模糊归一化');
      return true;
    }
  );
  assert.throws(
    () => acceptInvite(ctx, { pair_code: 'K7QX2M9', user_pseudo_id: 'userB' }),
    (err) => {
      assert.equal(err.code, ERROR_CODES.PAIR_CODE_NOT_FOUND);
      assert.equal(err.meta.reason, 'INVALID_CODE');
      return true;
    }
  );
  expectCode(() => acceptInvite(ctx, { pair_code: '', user_pseudo_id: 'userB' }), ERROR_CODES.PAIR_CODE_NOT_FOUND);
});

test('§3.3 复用：同一对好友二次配对 → 复用已完成结果，不重复计算', () => {
  const ctx = makeCtx();
  seedResult(ctx, 'userA', 'ABAB');
  seedResult(ctx, 'userB', 'ABAA');

  const inv1 = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });
  const first = completePair(ctx, { pair_code: inv1.pair_code, user_pseudo_id: 'userB' });
  assert.equal(first.similarity_pct, 91.7);

  // 同一对好友重新发起 → 新 pair_code，但结果复用
  const inv2 = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });
  const second = completePair(ctx, { pair_code: inv2.pair_code, user_pseudo_id: 'userB' });
  assert.equal(second.status, 'completed');
  assert.equal(second.similarity_pct, 91.7);
  assert.equal(second.band_label, '高默契型');
  assert.notEqual(inv2.pair_code, inv1.pair_code);
});

test('§3.3 复用：复合索引指向最新有效记录，且过期记录不占索引', () => {
  const ctx = makeCtx();
  const inv1 = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });
  acceptInvite(ctx, { pair_code: inv1.pair_code, user_pseudo_id: 'userB' });
  assert.equal(ctx.store.findActivePairingByPair('userA', 'userB').pair_code, inv1.pair_code);

  ctx.advance(SESSION_TTL_MS + 1);
  // getPairStatus 对过期记录抛 2002，同时惰性把记录置为 expired
  expectCode(() => getPairStatus(ctx, { pair_code: inv1.pair_code }), ERROR_CODES.PAIR_EXPIRED);
  assert.equal(ctx.store.findActivePairingByPair('userA', 'userB'), null, 'expired 记录应退出复合索引');
  assert.equal(ctx.store.getPairing(inv1.pair_code).status, 'expired');
});

test('调用者既非发起者也非受邀者 → 拒绝', () => {
  const ctx = makeCtx();
  seedResult(ctx, 'userB', 'ABAB');
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });
  acceptInvite(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });

  expectCode(() => completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userC' }), ERROR_CODES.PAIR_CODE_NOT_FOUND);
});

test('发起者可触发收口（受邀者已落库结果时）', () => {
  const ctx = makeCtx();
  seedResult(ctx, 'userB', 'BABA');
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });
  acceptInvite(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });

  const r = completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userA' });
  assert.equal(r.status, 'completed');
  assert.equal(r.invitee_code, 'BABA');
});

test('事务回滚：更新失败时配对记录不被部分写入', () => {
  const ctx = makeCtx();
  seedResult(ctx, 'userB', 'ABAB');
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });
  const before = ctx.store.getPairing(inv.pair_code);
  assert.equal(before.invitee_id, null);

  // 让 updatePairing 在事务中途抛错，验证整体回滚
  ctx.store.updatePairing = () => {
    throw new Error('injected failure');
  };

  assert.throws(() => completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' }), /injected failure/);
  assert.deepEqual(ctx.store.getPairing(inv.pair_code), before, '事务应整体回滚，不留下部分写入');
});

test('事务回滚：store.transaction 原语在抛错后还原 sessions / pairings / 索引', () => {
  const ctx = makeCtx();
  const statsBefore = ctx.store.stats();

  assert.throws(() => {
    ctx.store.transaction((store) => {
      store.insertSession({ session_id: 's-x', user_pseudo_id: 'u', archetype_code: 'AAAA', ts: T0 });
      throw new Error('boom');
    });
  }, /boom/);

  assert.deepEqual(ctx.store.stats(), statsBefore);
  assert.equal(ctx.store.getSession('s-x'), null);
});

test('轮询退避序列：3s → 6s → 12s → 30s，超出上限取 30s', () => {
  assert.deepEqual(
    POLL_BACKOFF_MS,
    [3000, 6000, 12000, 30000]
  );
  assert.equal(nextPollDelay(0), 3000);
  assert.equal(nextPollDelay(1), 6000);
  assert.equal(nextPollDelay(2), 12000);
  assert.equal(nextPollDelay(3), 30000);
  assert.equal(nextPollDelay(99), 30000);
  assert.equal(nextPollDelay(-5), 3000);
});

test('getPairStatus：pending 返回退避时长，completed 返回完整结果', () => {
  const ctx = makeCtx();
  seedResult(ctx, 'userB', 'ABAB');
  const inv = createInvite(ctx, { user_pseudo_id: 'userA', archetype_code: 'ABAB' });

  const pending = getPairStatus(ctx, { pair_code: inv.pair_code, attempt: 1 });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.has_invitee, false);
  assert.equal(pending.retry_after_ms, 6000);

  completePair(ctx, { pair_code: inv.pair_code, user_pseudo_id: 'userB' });
  const done = getPairStatus(ctx, { pair_code: inv.pair_code });
  assert.equal(done.status, 'completed');
  assert.equal(done.initiator_code, 'ABAB');
  assert.equal(done.invitee_code, 'ABAB');
  assert.equal(done.band_label, '同频共振型');
  assert.equal(done.isFirstCompletion, false);
});
