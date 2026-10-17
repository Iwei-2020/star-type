'use strict';

/**
 * 云函数调用适配器单测
 * 覆盖：调用器构造（平台官方形态 tt.createCloud + Cloud.callContainer；缺 envID 或无能力 → null）、
 *      运行时环境选配（线上 → prod，开发/预览 → dev，判据缺失或不认识 → prod 兜底）、
 *      统一信封归一（callContainer 原始返回 / 直返信封 / 包一层 result）、业务码→ok 映射、
 *      异常与非法返回的收敛、六个薄壳方法名透传、无能力时的降级（available=false, code=NO_INVOKER）。
 *
 * 服务端载体已按《平台规则检索记录》R-8 收口为抖音云；此处以「伪造宿主 + 注入调用器」把适配层
 * 钉死在契约上，不依赖任何真实平台 API，也不要求开通云服务。
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const client = require('../miniapp/shared/client-constants.js');
const { createCloud, resolveInvoker, resolveCloudEnv, unwrap } = require('../miniapp/core/cloud.js');

const OK = client.ERROR_CODES.OK;

test('resolveCloudEnv：线上走 prod、开发/预览走 dev，判据缺失或不认识一律 prod 兜底', () => {
  const targets = {
    dev: { envID: 'env-dev', serviceID: 'svc-1' },
    prod: { envID: 'env-prod', serviceID: 'svc-1' },
  };
  const withEnv = (envType) => ({ getEnvInfoSync: () => ({ microapp: { envType } }) });

  assert.equal(resolveCloudEnv(withEnv('production'), targets).envID, 'env-prod', '线上版须连 prod');
  assert.equal(resolveCloudEnv(withEnv('development'), targets).envID, 'env-dev', '开发版须连 dev');
  assert.equal(resolveCloudEnv(withEnv('preview'), targets).envID, 'env-dev', '预览版须连 dev');
  assert.equal(
    resolveCloudEnv({ getEnvInfoSync: () => ({ envtype: 'development' }) }, targets).envID,
    'env-dev',
    '兼容扁平 / 小写写法'
  );

  // 判据缺失或不认识时绝不猜 dev —— 宁可连线上，也不能让线上流量误连测试环境
  assert.equal(resolveCloudEnv({}, targets).envID, 'env-prod', '无人无该 API');
  assert.equal(resolveCloudEnv(null, targets).envID, 'env-prod', 'Node / 编译期无宿主');
  assert.equal(resolveCloudEnv(withEnv(''), targets).envID, 'env-prod', '取值空');
  assert.equal(resolveCloudEnv(withEnv('unexpected'), targets).envID, 'env-prod', '取值不认识');
  assert.equal(
    resolveCloudEnv({ getEnvInfoSync: () => { throw new Error('not supported'); } }, targets).envID,
    'env-prod',
    '接口抛错须收敛为 prod，不得上抛'
  );
  assert.equal(resolveCloudEnv(withEnv('development'), { prod: targets.prod }).envID, 'env-prod', '缺 dev 配置时回落 prod');
  assert.equal(resolveCloudEnv(withEnv('production'), null), null, 'targets 非法返回 null');
});

test('resolveInvoker：按平台官方形态构造（tt.createCloud + callContainer），缺配置或无能力时返回 null', async () => {
  assert.equal(resolveInvoker(null), null);
  assert.equal(resolveInvoker({}), null, '宿主无 createCloud 即无能力');

  const sent = [];
  let created = null;
  const host = {
    createCloud: (cfg) => {
      created = cfg;
      return {
        callContainer: (opts) => {
          sent.push(opts);
          opts.success({ statusCode: 200, header: {}, data: JSON.stringify({ code: OK, msg: 'ok', data: 1 }) });
        },
      };
    },
  };

  assert.equal(resolveInvoker(host, {}), null, '未注入 envID 时不构造调用器');
  assert.equal(resolveInvoker(host, { envID: '' }), null);
  assert.equal(created, null, '无 envID 时不应触碰 createCloud');

  const invoker = resolveInvoker(host, { envID: 'env-1', serviceID: 'svc-1' });
  assert.equal(typeof invoker, 'function');
  assert.deepEqual(created, { envID: 'env-1', serviceID: 'svc-1' });

  const out = await invoker('computeResult', { session_id: 's1' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, '/computeResult', '函数名即云托管路径');
  assert.equal(sent[0].init.method, 'POST');
  assert.deepEqual(sent[0].init.header, { 'content-type': 'application/json' });
  assert.deepEqual(sent[0].init.body, { session_id: 's1' });
  assert.equal(out.statusCode, 200, '调用器透传 callContainer 的原始返回，由 unwrap 归一');

  assert.equal(resolveInvoker({ createCloud: () => ({}) }, { envID: 'e' }), null, '实例无 callContainer 即无能力');
  assert.equal(
    resolveInvoker({ createCloud: () => { throw new Error('no cloud'); } }, { envID: 'e' }),
    null,
    'createCloud 抛错须收敛为无能力，不得上抛'
  );
});

test('unwrap：callContainer 原始返回（data 为 JSON 字符串）也能归一', () => {
  const raw = { statusCode: 200, header: { 'x-tt-openid': 'o1' }, data: JSON.stringify({ code: 0, msg: 'ok', data: { x: 1 } }) };
  assert.deepEqual(unwrap(raw), { code: 0, msg: 'ok', data: { x: 1 } });

  // 网关已解析成对象时同样可用
  assert.deepEqual(unwrap({ statusCode: 200, data: { code: 0, msg: 'ok', data: 2 } }), { code: 0, msg: 'ok', data: 2 });
  // 非 JSON 字符串（如网关错误页）不可识别，交给上层收敛为 SERVER_ERROR
  assert.equal(unwrap({ statusCode: 502, data: '<html>bad gateway</html>' }), null);
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

test('createCloud：经平台形态（createCloud + callContainer）端到端打通，fail 回调收敛为 SERVER_ERROR', async () => {
  const host = {
    createCloud: () => ({
      callContainer: (opts) => {
        if (opts.path === '/reportEvents') return opts.fail({ errMsg: 'Cloud.callContainer:fail timeout' });
        opts.success({ statusCode: 200, header: {}, data: JSON.stringify({ code: 1001, msg: '答案不完整', data: null }) });
      },
    }),
  };
  const cloud = createCloud({ host, envID: 'env-1', serviceID: 'svc-1' });
  assert.equal(cloud.available(), true, '注入了 envID 即具备调用能力');

  const failed = await cloud.computeResult({ answers: {} });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, client.ERROR_CODES.ANSWER_INCOMPLETE);
  assert.equal(failed.msg, '答案不完整');

  const netErr = await cloud.reportEvents({ events: [] });
  assert.equal(netErr.ok, false);
  assert.equal(netErr.code, client.ERROR_CODES.SERVER_ERROR);
  assert.equal(netErr.msg, 'Cloud.callContainer:fail timeout');
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
