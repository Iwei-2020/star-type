'use strict';

/**
 * 云函数调用适配器单测
 * 覆盖：调用器探测（tt.cloud.callFunction / tt.callFunction / 无能力）、
 *      统一信封归一（直返 / 包一层 result）、业务码→ok 映射、异常与非法返回的收敛、
 *      六个薄壳方法名透传、无能力时的降级（available=false, code=NO_INVOKER）。
 *
 * 服务端产品载体属 D-1 待复核，故此处以「注入调用器」的方式把适配层钉死在契约上，
 * 不依赖任何真实平台 API。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const client = require('../miniapp/shared/client-constants.js');
const { createCloud, resolveInvoker, unwrap } = require('../miniapp/core/cloud.js');

const OK = client.ERROR_CODES.OK;

test('resolveInvoker：优先 tt.cloud.callFunction，其次 tt.callFunction，均无则 null', () => {
  assert.equal(resolveInvoker(null), null);
  assert.equal(resolveInvoker({}), null);

  const viaCloud = [];
  const hostCloud = {
    cloud: { callFunction: (arg) => { viaCloud.push(arg); return Promise.resolve({ code: OK, data: 1 }); } },
  };
  const cloudInvoker = resolveInvoker(hostCloud);
  assert.equal(typeof cloudInvoker, 'function');
  cloudInvoker('computeResult', { a: 1 });
  assert.deepEqual(viaCloud, [{ name: 'computeResult', data: { a: 1 } }]);

  const viaFlat = [];
  const hostFlat = { callFunction: (arg) => { viaFlat.push(arg); return Promise.resolve({ code: OK, data: 2 }); } };
  const flatInvoker = resolveInvoker(hostFlat);
  assert.equal(typeof flatInvoker, 'function');
  flatInvoker('createInvite', { b: 2 });
  assert.deepEqual(viaFlat, [{ name: 'createInvite', data: { b: 2 } }]);
});

test('unwrap：直返信封与包一层 result 都归一为 { code, msg, data }', () => {
  assert.deepEqual(unwrap({ code: 0, msg: 'ok', data: { x: 1 } }), { code: 0, msg: 'ok', data: { x: 1 } });
  assert.deepEqual(unwrap({ result: { code: 1001, msg: 'er' } }), { code: 1001, msg: 'er', data: null });
  assert.equal(unwrap(null), null);
  assert.equal(unwrap('nope'), null);
  assert.equal(unwrap({ msg: 'no code' }), null);
});

test('createCloud：成功调用 → ok=true，业务失败码 → ok=false 且保留码与语义', async () => {
  const calls = [];
  const cloud = createCloud({
    invoker: (name, params) => {
      calls.push({ name, params });
      if (name === 'computeResult') return Promise.resolve({ code: OK, msg: 'ok', data: { archetype_code: 'AAAA' } });
      return Promise.resolve({ code: client.ERROR_CODES.PAIR_EXPIRED, msg: '配对邀请已过期', data: null });
    },
  });

  assert.equal(cloud.available(), true);

  const ok = await cloud.computeResult({ session_id: 's1' });
  assert.deepEqual({ ok: ok.ok, code: ok.code, data: ok.data }, { ok: true, code: OK, data: { archetype_code: 'AAAA' } });
  assert.deepEqual(calls[0], { name: 'computeResult', params: { session_id: 's1' } });

  const bad = await cloud.getPairStatus({ pair_code: 'K7QX2M9T' });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, client.ERROR_CODES.PAIR_EXPIRED);
  assert.equal(bad.msg, '配对邀请已过期');
});

test('createCloud：平台包一层 result 时同样解析', async () => {
  const cloud = createCloud({
    invoker: () => Promise.resolve({ result: { code: OK, msg: 'ok', data: { pair_code: 'K7QX2M9T' } } }),
  });
  const res = await cloud.createInvite({ user_pseudo_id: 'u1' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.data, { pair_code: 'K7QX2M9T' });
});

test('createCloud：异常与非法返回一律收敛为 SERVER_ERROR，绝不 reject', async () => {
  const throwing = createCloud({ invoker: () => { throw new Error('boom'); } });
  const thrown = await throwing.computeResult({});
  assert.equal(thrown.ok, false);
  assert.equal(thrown.code, client.ERROR_CODES.SERVER_ERROR);
  assert.equal(thrown.msg, 'boom');

  const rejecting = createCloud({ invoker: () => Promise.reject(new Error('net')) });
  const rejected = await rejecting.reportEvents({ events: [] });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, client.ERROR_CODES.SERVER_ERROR);

  const bogus = createCloud({ invoker: () => Promise.resolve('not-an-envelope') });
  const bogusRes = await bogus.getPairStatus({ pair_code: 'K7QX2M9T' });
  assert.equal(bogusRes.ok, false);
  assert.equal(bogusRes.code, client.ERROR_CODES.SERVER_ERROR);
  assert.equal(bogusRes.msg, 'invalid_envelope');
});

test('createCloud：无调用能力时 available=false，调用降级为 NO_INVOKER', async () => {
  const cloud = createCloud({ invoker: null });
  assert.equal(cloud.available(), false);

  const res = await cloud.computeResult({ session_id: 's1' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'NO_INVOKER');
  assert.equal(res.data, null);
});

test('createCloud：六个薄壳方法名与服务端薄壳一致', async () => {
  const seen = [];
  const cloud = createCloud({ invoker: (name) => { seen.push(name); return Promise.resolve({ code: OK, data: null }); } });

  await cloud.computeResult({});
  await cloud.createInvite({});
  await cloud.acceptInvite({});
  await cloud.getPairStatus({});
  await cloud.completePair({});
  await cloud.reportEvents({ events: [] });

  assert.deepEqual(seen, ['computeResult', 'createInvite', 'acceptInvite', 'getPairStatus', 'completePair', 'reportEvents']);
});
