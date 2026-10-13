/** Official API responses are mocked; disk locking, caching and lease state are real. No credential transport is invoked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { QuotaManager, normalizeUsage } from '../src/quota.mjs';

const MODEL = 'opencode-go/mock-code';
const OTHER = 'opencode-go/mock-flash';
const START = Date.parse('2026-10-13T08:00:00.000Z');
const AUTH = { available: true, source: 'SIMULATED existing provider authentication',
  inferenceCredentialMatches: true, bindingId: 'a'.repeat(64) };
const childEnvironment = () => Object.fromEntries(Object.entries({ SystemRoot: process.env.SystemRoot,
  PATH: path.dirname(process.execPath), TEMP: os.tmpdir(), TMP: os.tmpdir() }).filter(([, value]) => typeof value === 'string'));
const coverage = { verified: true, scope: 'account', provider: 'opencode-go',
  sourceSchema: 'usage.percent.resetsAt-v1', provenance: 'SIMULATED official source and response fixture' };

function response(percent = 0, now = START, overrides = {}) {
  const window = (value, delta) => ({ status: 'ok', percent: value, resetsAt: new Date(now + delta).toISOString() });
  return { ok: true, category: 'ok', httpStatus: 200, fetchedAt: new Date(now).toISOString(),
    auth: AUTH,
    endpoint: 'https://opencode.ai/zen/go/usage', consoleFallback: 'https://opencode.ai/console',
    verifiedCoverage: coverage,
    body: { useBalance: false, usage: { rolling: window(percent, 300_000), weekly: window(0, 7 * 86_400_000), monthly: window(0, 30 * 86_400_000) } },
    ...overrides };
}

async function fixture(t, { percent = 0, query, config = {}, catalog = [MODEL, OTHER] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'goflow-quota-test-'));
  const stateDir = path.join(root, 'state');
  const runtimeConfigPath = path.join(root, 'runtime.json');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(runtimeConfigPath, JSON.stringify({ billingGuard: { useBalanceDisabledConfirmed: true,
    activeGoSubscriptionConfirmed: true }, quota: { queryTimeoutMs: 50 }, ...config }));
  await fs.writeFile(path.join(stateDir, 'models.json'), JSON.stringify({ models: catalog, provider: 'opencode-go' }));
  const clock = { value: START };
  let calls = 0;
  const queryUsage = async (...args) => { calls++; return query ? query(...args) : response(percent, clock.value); };
  const options = { stateDir, runtimeConfigPath };
  const dependencies = { queryUsage, credentialBinding: async () => ({ ok: true, auth: AUTH }), now: () => clock.value };
  const manager = new QuotaManager(options, dependencies);
  t.after(async () => {
    const resolved = path.resolve(root), temp = path.resolve(os.tmpdir());
    assert.equal(path.dirname(resolved).toLowerCase(), temp.toLowerCase());
    assert.ok(path.basename(resolved).startsWith('goflow-quota-test-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { root, stateDir, runtimeConfigPath, clock, manager, options, dependencies, calls: () => calls };
}

test('normalizer uses only reliable official windows and shared-account provenance', () => {
  const raw = response(42);
  raw.body.secret = 'DO_NOT_PERSIST_UNWHITELISTED_BODY';
  raw.body.models = { inventedWallet: 99999 };
  const quota = normalizeUsage(raw);
  assert.equal(quota.available, true); assert.equal(quota.reliable, true);
  assert.equal(quota.maxPercent, 42); assert.equal(quota.modelWallets, 'not-exposed');
  assert.equal(quota.coverage.scope, 'account-shared');
  assert.equal(JSON.stringify(quota).includes('DO_NOT_PERSIST'), false);
  assert.equal(JSON.stringify(quota).includes('inventedWallet'), false);
  for (const broken of [
    { ...raw, verifiedCoverage: null },
    { ...raw, body: { usage: { rolling: raw.body.usage.rolling } } },
    { ...raw, body: { usage: { ...raw.body.usage, rolling: { ...raw.body.usage.rolling, percent: '42' } } } },
    { ...raw, body: { usage: { ...raw.body.usage, weekly: { ...raw.body.usage.weekly, percent: NaN } } } },
    { ...raw, body: { usage: { ...raw.body.usage, monthly: { ...raw.body.usage.monthly, resetsAt: 'unknown' } } } },
  ]) assert.equal(normalizeUsage(broken).reliable && normalizeUsage(broken).available, false);
});

test('legacy usagePercent/resetInSec windows normalize without local cost estimates', () => {
  const raw = { fetchedAt: new Date(START).toISOString(), verifiedCoverage: coverage, body: { useBalance: false,
    rollingUsage: { status: 'ok', usagePercent: 80, resetInSec: 60 },
    weeklyUsage: { status: 'ok', usagePercent: 10, resetInSec: 1000 },
    monthlyUsage: { status: 'ok', usagePercent: 5, resetInSec: 5000 } } };
  const quota = normalizeUsage(raw);
  assert.equal(quota.reliable, true); assert.equal(quota.sourceSchema, 'legacy');
  assert.equal(quota.maxPercent, 80);
  assert.equal(quota.windows[0].resetAt, new Date(START + 60_000).toISOString());
  for (const resetInSec of [Number.MAX_VALUE, Number.MAX_SAFE_INTEGER, Infinity, -1, 366 * 86_400 + 1]) {
    const oversized = { ...raw, body: { ...raw.body, rollingUsage: { ...raw.body.rollingUsage, resetInSec } } };
    assert.equal(normalizeUsage(oversized).available, false);
  }
});

test('RFC3339 resets require a timezone and valid calendar; percentages must be finite real 0..100', () => {
  for (const resetsAt of ['2026-10-13T09:00:00', '2026-02-30T09:00:00Z', '2026-13-01T09:00:00Z',
    '2026-10-13T24:00:00Z', '2026-10-13T09:00:00+24:00', '2026-10-13T09:60:00Z', 'October 13, 2026']) {
    const raw = response(); raw.body.usage.rolling.resetsAt = resetsAt;
    assert.equal(normalizeUsage(raw).available, false, resetsAt);
  }
  const zoned = response(); zoned.body.usage.rolling.resetsAt = '2026-10-13T16:05:00+08:00';
  assert.equal(normalizeUsage(zoned).windows[0].resetAt, '2026-10-13T08:05:00.000Z');
  for (const percent of [-1, 101, Infinity, NaN, '95', null]) {
    const raw = response(); raw.body.usage.weekly.percent = percent;
    assert.equal(normalizeUsage(raw).available, false, String(percent));
  }
});

test('credential/source binding changes invalidate a fresh cache and opaque hashes are never public', async t => {
  const f = await fixture(t);
  let auth = AUTH;
  const dependencies = { queryUsage: async () => response(0, START, { auth }),
    credentialBinding: async () => ({ ok: true, auth }), now: () => START };
  const manager = new QuotaManager(f.options, dependencies);
  let queries = 0;
  const counted = new QuotaManager(f.options, { ...dependencies, queryUsage: async (...args) => { queries++; return dependencies.queryUsage(...args); } });
  await counted.usage(); assert.equal(queries, 1);
  auth = { ...AUTH, source: 'SIMULATED replacement credential vault', bindingId: 'b'.repeat(64) };
  const refreshed = await counted.usage(); assert.equal(queries, 2); assert.equal(refreshed.fresh, true);
  assert.equal(JSON.stringify(refreshed).includes('bindingId'), false);
  assert.equal(JSON.stringify(await manager.status()).includes('bindingId'), false);
  const stored = JSON.parse(await fs.readFile(path.join(f.stateDir, 'quota', 'usage-cache.json'), 'utf8'));
  assert.equal(stored.auth.bindingId, auth.bindingId);
  const events = await fs.readFile(path.join(f.stateDir, 'quota', 'events.jsonl'), 'utf8');
  assert.equal(events.includes('a'.repeat(64)), false); assert.equal(events.includes('b'.repeat(64)), false);
});

test('unavailable/mismatched local binding and mismatched GET binding never permit execution', async t => {
  for (const inspected of [{ ok: false, auth: { available: false } },
    { ok: true, auth: { ...AUTH, inferenceCredentialMatches: false } }]) {
    const f = await fixture(t);
    const manager = new QuotaManager(f.options, { ...f.dependencies, credentialBinding: async () => inspected });
    const blocked = await manager.reserve({ model: MODEL, taskId: 'binding-blocked' });
    assert.equal(blocked.reason, 'authorization'); assert.equal(f.calls(), 0);
    assert.equal(blocked.decision.queryFailureReason, inspected.auth.available ? 'credential_mismatch' : 'missing_login');
  }
  const f = await fixture(t, { query: () => response(0, START, { auth: { ...AUTH, bindingId: 'c'.repeat(64) } }) });
  const mismatch = await f.manager.reserve({ model: MODEL, taskId: 'wrong-account-body' });
  assert.equal(mismatch.reason, 'authorization'); assert.equal(mismatch.usage.queryFailureReason, 'credential_mismatch');
});

test('stable failure reasons survive publicly, while arbitrary private error text is discarded', async t => {
  const f = await fixture(t, { query: () => ({ ok: false, category: 'authorization', fetchedAt: new Date(START).toISOString(),
    auth: AUTH, reason: 'missing_native_go_auth' }) });
  assert.equal((await f.manager.usage()).queryFailureReason, 'missing_native_go_auth');
  const g = await fixture(t, { query: () => ({ ok: false, category: 'authorization', fetchedAt: new Date(START).toISOString(),
    auth: AUTH, reason: 'PRIVATE_AUTH_ERROR_DO_NOT_PERSIST' }) });
  assert.equal((await g.manager.usage()).queryFailureReason, null);
  const text = await fs.readFile(path.join(g.stateDir, 'quota', 'usage-cache.json'), 'utf8');
  assert.equal(text.includes('PRIVATE_AUTH_ERROR'), false);
});

test('60-second cache is shared across instances and cached status never queries', async t => {
  const f = await fixture(t, { percent: 23 });
  const second = new QuotaManager(f.options, f.dependencies);
  assert.equal((await f.manager.status()).fresh, false); assert.equal(f.calls(), 0);
  assert.equal((await f.manager.usage()).fresh, true);
  assert.equal((await second.usage()).quota.maxPercent, 23); assert.equal(f.calls(), 1);
  assert.equal((await second.cached()).lastSuccessAt, new Date(START).toISOString()); assert.equal(f.calls(), 1);
  f.clock.value += 60_001;
  assert.equal((await second.cached()).fresh, false);
  assert.equal((await second.usage()).fresh, true); assert.equal(f.calls(), 2);
});

test('80% warns and prefers lower cost without changing quality; 95% queues; 100% always stops', async t => {
  for (const [percent, allowed, level, reason] of [[79, true, 'allow', 'quota_available'], [80, true, 'warn', 'quota_80'],
    [94, true, 'warn', 'quota_80'], [95, false, 'blocked', 'quota_95'], [100, false, 'blocked', 'quota_100']]) {
    const f = await fixture(t, { percent });
    const decision = await f.manager.evaluate(MODEL);
    assert.equal(decision.allowed, allowed); assert.equal(decision.level, level); assert.equal(decision.reason, reason);
    assert.equal(decision.preferLowCost, percent >= 80 && percent < 100);
    if (!allowed) {
      const reserved = await f.manager.reserve({ model: MODEL, taskId: `percent-${percent}`, priority: 'low' });
      assert.equal(reserved.status, 'deferred'); assert.equal(reserved.reason, reason);
      assert.equal((await f.manager.queue())[0].taskId, `percent-${percent}`);
    }
  }
});

test('all reliable windows are checked and historical rate-limited status cannot be bypassed', async t => {
  const f = await fixture(t, { query: () => {
    const raw = response(10); raw.body.usage.monthly.percent = 100; return raw;
  } });
  assert.equal((await f.manager.evaluate(MODEL)).reason, 'quota_100');
  const g = await fixture(t, { query: () => {
    const raw = response(10); raw.body.usage.weekly.status = 'rate-limited'; return raw;
  } });
  assert.equal((await g.manager.evaluate(MODEL)).reason, 'quota_100');
});

test('model coverage requires the real Go catalog and verified account scope', async t => {
  const f = await fixture(t);
  assert.equal((await f.manager.evaluate('opencode-go/not-in-catalog')).reason, 'unknown_model_coverage');
  assert.equal((await f.manager.evaluate('openai/paid')).allowed, false);
  const g = await fixture(t, { query: () => response(0, START, { verifiedCoverage: { ...coverage, verified: false } }) });
  assert.equal((await g.manager.evaluate(MODEL)).reason, 'quota_unknown');
  assert.equal((await g.manager.cached()).fresh, false);
});

test('live API does not expose Use balance; explicit human attestation remains separate', async t => {
  const live = () => { const raw = response(); delete raw.body.useBalance; return raw; };
  const f = await fixture(t, { query: live });
  const usage = await f.manager.usage(); assert.equal(usage.quota.useBalance, null);
  assert.equal(usage.quota.useBalanceSource, 'not_exposed');
  const decision = await f.manager.evaluate(MODEL);
  assert.equal(decision.allowed, true); assert.equal(decision.useBalanceSource, 'human_attestation');
  const g = await fixture(t, { query: live, config: { billingGuard: { useBalanceDisabledConfirmed: false } } });
  assert.equal((await g.manager.evaluate(MODEL)).reason, 'use_balance_unknown');
  const h = await fixture(t, { query: () => {
    const raw = response(); raw.body.useBalance = true; return raw;
  } });
  assert.equal((await h.manager.evaluate(MODEL)).reason, 'use_balance_enabled');
});

test('one-task override is exact-model/task-bound, expires, and is consumed by one reservation', async t => {
  const f = await fixture(t, { percent: 95 });
  const permit = await f.manager.createOverride({ model: MODEL, taskId: 'authorized-task', source: 'Explicit human local CLI approval for this one task', ttlSeconds: 60, maxUses: 1 });
  assert.equal((await f.manager.reserve({ model: OTHER, taskId: 'authorized-task', overrideToken: permit.token })).allowed, false);
  assert.equal((await f.manager.reserve({ model: MODEL, taskId: 'other-task', overrideToken: permit.token })).allowed, false);
  const allowed = await f.manager.reserve({ model: MODEL, taskId: 'authorized-task', overrideToken: permit.token });
  assert.equal(allowed.allowed, true); assert.equal(allowed.decision.overrideUsed, true);
  await f.manager.release(allowed.lease.id);
  assert.equal((await f.manager.reserve({ model: MODEL, taskId: 'authorized-task', overrideToken: permit.token })).reason, 'quota_95');
  const expired = await f.manager.createOverride({ model: MODEL, taskId: 'expires-task', source: 'Explicit human approval with short expiration', ttlSeconds: 1 });
  f.clock.value += 1001;
  assert.equal((await f.manager.reserve({ model: MODEL, taskId: 'expires-task', overrideToken: expired.token })).allowed, false);
  await assert.rejects(f.manager.createOverride({ model: MODEL, taskId: 'invalid-task', source: 'explicit approval', maxUses: 2 }));
  await assert.rejects(f.manager.createOverride({ model: MODEL, taskId: 'invalid-task', source: 'explicit approval', ttlSeconds: 601 }));
});

test('100% cannot be overridden even by a previously valid manual permit', async t => {
  const f = await fixture(t, { percent: 100 });
  const permit = await f.manager.createOverride({ model: MODEL, taskId: 'never-run', source: 'Explicit user requested one task but 100 percent always stops' });
  const blocked = await f.manager.reserve({ model: MODEL, taskId: 'never-run', overrideToken: permit.token });
  assert.equal(blocked.allowed, false); assert.equal(blocked.reason, 'quota_100');
});

test('401, 429, 5xx and network errors preserve last success but stale data cannot permit execution', async t => {
  for (const [category, httpStatus, retryAfterSeconds] of [['authorization', 401], ['quota', 429, 120], ['service', 503], ['network', null]]) {
    let failing = false;
    const f = await fixture(t, { query: () => failing ? { ok: false, category, httpStatus, retryAfterSeconds,
      fetchedAt: new Date(START).toISOString(), auth: { available: category !== 'authorization', source: 'mock' } } : response(5) });
    await f.manager.usage(); failing = true;
    const unavailable = await f.manager.usage({ force: true });
    assert.equal(unavailable.fresh, false); assert.equal(unavailable.lastSuccessAt, new Date(START).toISOString());
    assert.equal((await f.manager.evaluate(MODEL)).allowed, false); assert.equal(f.calls(), 2);
    const second = new QuotaManager(f.options, f.dependencies);
    assert.equal((await second.reserve({ model: MODEL, taskId: `hold-${category}` })).reason, category);
    assert.equal(f.calls(), 2, 'automatic admission respects error backoff and cannot run on cached data');
  }
});

test('a hung query times out and never authorizes execution', async t => {
  const f = await fixture(t, { query: () => new Promise(() => {}), config: { quota: { queryTimeoutMs: 15 } } });
  const usage = await f.manager.usage();
  assert.equal(usage.fresh, false); assert.equal(usage.category, 'network');
  assert.equal((await f.manager.evaluate(MODEL)).allowed, false); assert.equal(f.calls(), 1);
});

test('reset crossing causes a real refresh and never fabricates a zero percentage', async t => {
  let calls = 0;
  const f = await fixture(t, { query: () => {
    calls++;
    const raw = response(calls === 1 ? 95 : 7, f.clock.value);
    if (calls === 1) raw.body.usage.rolling.resetsAt = new Date(START + 1000).toISOString();
    return raw;
  } });
  assert.equal((await f.manager.evaluate(MODEL)).allowed, false);
  f.clock.value += 1001;
  assert.equal((await f.manager.cached()).fresh, false);
  const refreshed = await f.manager.evaluate(MODEL);
  assert.equal(refreshed.allowed, true); assert.equal(refreshed.maxPercent, 7); assert.equal(calls, 2);
});

test('concurrent manager instances share one lease and release invalidates usage before the next call', async t => {
  const f = await fixture(t);
  const other = new QuotaManager(f.options, f.dependencies);
  const results = await Promise.all([f.manager.reserve({ model: MODEL, taskId: 'parallel-a' }), other.reserve({ model: OTHER, taskId: 'parallel-b' })]);
  assert.equal(results.filter(r => r.allowed).length, 1);
  assert.equal(results.find(r => !r.allowed).reason, 'busy'); assert.equal(f.calls(), 1);
  const lease = results.find(r => r.allowed).lease;
  assert.equal((await f.manager.status()).activeLeases.length, 1);
  assert.equal((await other.renew(lease.id)).renewed, true);
  await other.release(lease.id, { outcome: 'mock completion' });
  assert.equal((await f.manager.cached()).fresh, false);
  const deferredTaskId = results[0].allowed ? 'parallel-b' : 'parallel-a';
  const resumed = await f.manager.resume(deferredTaskId);
  assert.equal(resumed.allowed, true); await f.manager.release(resumed.lease.id);
  assert.equal(f.calls(), 2);
});

test('every non-backoff execution admission fetches authoritative quota even when the display cache is fresh', async t => {
  const f = await fixture(t);
  await f.manager.usage(); assert.equal(f.calls(), 1);
  const reserved = await f.manager.reserve({ model: MODEL, taskId: 'fresh-admission' });
  assert.equal(reserved.allowed, true); assert.equal(f.calls(), 2);
  await f.manager.release(reserved.lease.id);
});

test('two contenders recover a dead process lock without deleting a replacement live lock', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.stateDir, 'quota'), { recursive: true });
  await fs.writeFile(path.join(f.stateDir, 'quota', 'quota.lock'), JSON.stringify({ id: 'dead-fixture-lock', pid: 2_000_000_000,
    createdAt: Date.now() - 100_000, expiresAt: Date.now() - 50_000 }));
  const other = new QuotaManager(f.options, f.dependencies);
  const results = await Promise.all([f.manager.reserve({ model: MODEL, taskId: 'recover-a' }), other.reserve({ model: MODEL, taskId: 'recover-b' })]);
  assert.equal(results.filter(r => r.allowed).length, 1); assert.equal(results.find(r => !r.allowed).reason, 'busy');
  assert.equal(f.calls(), 1);
  await f.manager.release(results.find(r => r.allowed).lease.id);
});

test('expired timestamp alone cannot release a live lease owner', async t => {
  const f = await fixture(t, { config: { quota: { leaseMs: 1000, queryTimeoutMs: 50 } } });
  const first = await f.manager.reserve({ model: MODEL, taskId: 'alive-owner' });
  f.clock.value += 1001;
  const blocked = await f.manager.reserve({ model: OTHER, taskId: 'must-wait' });
  assert.equal(blocked.reason, 'busy'); assert.equal(f.calls(), 1);
  assert.equal((await f.manager.status()).activeLeases[0].expired, true);
  assert.equal((await f.manager.renew(first.lease.id)).renewed, false);
  assert.equal((await f.manager.release(first.lease.id)).released, true);
});

test('dead-owner recovery waits for its timeout then invalidates cached quota before requery', async t => {
  const f = await fixture(t);
  await f.manager.usage();
  await fs.writeFile(path.join(f.stateDir, 'quota', 'leases.json'), JSON.stringify([{ id: '00000000-0000-0000-0000-000000000000',
    model: MODEL, taskId: 'lost-owner', pid: 2_000_000_000, createdAt: new Date(START).toISOString(), expiresAt: new Date(START + 1000).toISOString() }]));
  assert.equal((await f.manager.reserve({ model: MODEL, taskId: 'before-timeout' })).reason, 'busy');
  assert.equal(f.calls(), 1);
  f.clock.value += 1001;
  const recovered = await new QuotaManager(f.options, f.dependencies).reserve({ model: MODEL, taskId: 'after-timeout' });
  assert.equal(recovered.allowed, true); assert.equal(f.calls(), 2);
  await f.manager.release(recovered.lease.id);
});

test('a real orphan worker holds its lease after the owner is lost and its timestamp expires', async t => {
  const f = await fixture(t, { config: { quota: { leaseMs: 1000, queryTimeoutMs: 50 } } });
  const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { shell: false, windowsHide: true,
    stdio: 'ignore', env: childEnvironment() });
  await new Promise((resolve, reject) => { worker.once('spawn', resolve); worker.once('error', reject); });
  const workerClosed = new Promise(resolve => worker.once('close', resolve));
  t.after(async () => { if (worker.exitCode === null) worker.kill(); await workerClosed; });
  const original = await f.manager.reserve({ model: MODEL, taskId: 'will-be-orphaned' });
  assert.equal((await f.manager.bindWorker(original.lease.id, worker.pid)).bound, true);
  assert.equal((await f.manager.release(original.lease.id)).reason, 'worker_still_active');
  const leaseFile = path.join(f.stateDir, 'quota', 'leases.json');
  const leases = JSON.parse(await fs.readFile(leaseFile, 'utf8'));
  leases[0].pid = 2_000_000_000; // Simulate the MCP parent's death while its real child remains alive.
  await fs.writeFile(leaseFile, JSON.stringify(leases));
  f.clock.value += 1001;
  assert.equal((await f.manager.reserve({ model: OTHER, taskId: 'cannot-steal-orphan-slot' })).reason, 'busy');
  const status = await f.manager.status();
  assert.equal(status.activeLeases[0].ownerAlive, false); assert.equal(status.activeLeases[0].workerAlive, true);
  assert.equal(status.activeLeases[0].expired, true); assert.equal(f.calls(), 1);
  worker.kill(); await workerClosed;
  const recovered = await f.manager.reserve({ model: OTHER, taskId: 'after-orphan-exits' });
  assert.equal(recovered.allowed, true); assert.equal(f.calls(), 2);
  await f.manager.release(recovered.lease.id);
});

test('independent Node processes cannot reserve the shared slot twice', async t => {
  const f = await fixture(t);
  const moduleUrl = new URL('../src/quota.mjs', import.meta.url).href;
  const childSource = [
    `import {QuotaManager} from ${JSON.stringify(moduleUrl)};`,
    `const options=${JSON.stringify(f.options)};`,
    `const response=${JSON.stringify(response())};`,
    `const q=new QuotaManager(options,{queryUsage:async()=>response,credentialBinding:async()=>({ok:true,auth:response.auth}),now:()=>${START}});`,
    `const r=await q.reserve({model:${JSON.stringify(MODEL)},taskId:process.argv[1]});`,
    `console.log(JSON.stringify({allowed:r.allowed,reason:r.reason,lease:r.lease}));`,
  ].join('\n');
  const run = taskId => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', childSource, taskId], { shell: false, windowsHide: true, env: childEnvironment() });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
  const results = await Promise.all([run('process-a'), run('process-b')]);
  assert.equal(results.filter(r => r.allowed).length, 1); assert.equal(results.find(r => !r.allowed).reason, 'busy');
  const status = await f.manager.status();
  assert.equal(status.activeLeases.length, 1, 'a recently lost process remains held until its effective timeout');
  assert.equal((await f.manager.reserve({ model: MODEL, taskId: 'process-parent' })).reason, 'busy');
});

test('persisted quota events and deferral metadata contain no raw API body or raw task', async t => {
  const f = await fixture(t, { query: () => {
    const raw = response(95); raw.body.private = 'API_BODY_MUST_NOT_BE_PERSISTED'; return raw;
  } });
  await f.manager.reserve({ model: MODEL, taskId: 'queue-safe-only-id', priority: 'low', task: 'RAW_TASK_MUST_NOT_BE_PERSISTED' });
  const contents = await Promise.all(['usage-cache.json', 'queue.json', 'events.jsonl'].map(name => fs.readFile(path.join(f.stateDir, 'quota', name), 'utf8')));
  for (const text of contents) {
    assert.equal(text.includes('API_BODY_MUST_NOT_BE_PERSISTED'), false);
    assert.equal(text.includes('RAW_TASK_MUST_NOT_BE_PERSISTED'), false);
  }
  assert.equal((await f.manager.resume('nonexistent-task')).reason, 'queue_task_missing');
});
