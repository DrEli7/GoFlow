/**
 * GoFlow control-plane regression tests.
 * All model discovery and model responses in this file are SIMULATED fixtures.
 * Filesystem isolation, review/apply behavior, and project Node tests are real.
 * This suite must never launch the user's OpenCode executable or call a provider.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GoFlow, runProcess } from '../src/core.mjs';
import { QuotaManager } from '../src/quota.mjs';
import { spawn } from 'node:child_process';

const SOURCE = 'src/math.mjs';
const PROJECT_TEST = 'test/math.test.mjs';
const ORIGINAL = 'export function add(a, b) { return 0; }\n';
const CORRECT = 'export function add(a, b) { return a + b; }\n';
const WRONG = 'export function add(a, b) { return a - b; }\n';
const VALID_MODELS = ['opencode-go/mock-small', 'opencode-go/mock-medium'];
const REVIEW = { reviewer: 'GPT', reviewSummary: 'GPT reviewed the bounded math change and its independent passing tests.' };
const discoveredGit=(process.env.PATH??'').split(path.delimiter)
  .map(directory=>path.resolve(directory,process.platform==='win32'?'git.exe':'git'))
  .find(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile());
const GIT_EXE=process.env.GOFLOW_TEST_GIT_EXE??discoveredGit;
if(!GIT_EXE||!path.isAbsolute(GIT_EXE))throw new Error('Tests require a native Git executable on PATH or GOFLOW_TEST_GIT_EXE.');

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function fixture(t, { billing = true, config = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goflow-control-test-'));
  const directory = path.join(root, 'project');
  const stateDir = path.join(root, 'state');
  const runtimeConfigPath = path.join(root, 'runtime.json');
  write(path.join(directory, SOURCE), ORIGINAL);
  write(path.join(directory, PROJECT_TEST), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { add } from '../src/math.mjs';",
    "test('real project acceptance: adds positive and negative integers', () => {",
    '  assert.equal(add(2, 3), 5);',
    '  assert.equal(add(-4, 2), -2);',
    '});',
    '',
  ].join('\n'));
  write(runtimeConfigPath, JSON.stringify({
    version: 1,
    mode: 'auto',
    billingGuard: {
      useBalanceDisabledConfirmed: billing,
      activeGoSubscriptionConfirmed: billing,
      confirmedAt: billing ? '2026-10-13T00:00:00.000Z' : null,
      confirmationSource: billing ? 'SIMULATED TEST FIXTURE - not a user attestation' : null,
    },
    // These are fixture-only values. The injected runner handles model calls.
    opencodeExe: process.execPath,
    nodeExe: process.execPath,
    gitExe: GIT_EXE,
    maxRepairAttempts: 2,
    timeoutMs: 10000,
    maxFileBytes: 100000,
    maxContextBytes: 400000,
    ...config,
  }, null, 2));
  t.after(() => {
    const resolved = path.resolve(root);
    const temp = path.resolve(os.tmpdir());
    assert.ok(path.dirname(resolved).toLowerCase() === temp.toLowerCase());
    assert.ok(path.basename(resolved).startsWith('goflow-control-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return {
    root, directory, stateDir, runtimeConfigPath,
    options: { stateDir, runtimeConfigPath, opencodeExe: process.execPath, nodeExe: process.execPath, gitExe: GIT_EXE },
    request: {
      directory,
      task: 'Fix the well specified add function to return the sum. Preserve exported API.',
      files: [SOURCE, PROJECT_TEST],
      editableFiles: [SOURCE],
      // Isolation=none runs the test in this permission-constrained Node process.
      tests: [{ command: process.execPath, args: ['--test', '--test-isolation=none', PROJECT_TEST] }],
      risk: 'low', complexity: 'simple',
    },
    readSource: () => fs.readFileSync(path.join(directory, SOURCE), 'utf8'),
  };
}

function simulatedRunner({ models = VALID_MODELS, content = CORRECT, response, delayMs = 0, version = '1.18.15',
  authMetadata = '● OpenCode Go api\n└ 1 credentials\n' } = {}) {
  const calls = [];
  const result = stdout => ({ code: 0, stdout, stderr: '', timedOut: false, outputLimit: false, durationMs: 1 });
  const runner = async (executable, args, options = {}) => {
    const call = { purpose: options.purpose, executable, args: [...args], cwd: options.cwd, input: options.input ?? '' };
    calls.push(call);
    if (options.purpose === 'models') {
      assert.equal(executable, process.execPath, 'model executable must remain the fixture placeholder');
      assert.deepEqual(args, ['models', 'opencode-go']);
      return result(models.join('\n') + '\n');
    }
    if (options.purpose === 'version') return result(version + '\n');
    if (options.purpose === 'authMetadata') {
      assert.equal(executable, process.execPath, 'auth metadata must come only from the fixture runner');
      assert.deepEqual(args, ['auth', 'list']);
      const count = calls.filter(c => c.purpose === 'authMetadata').length;
      return result(typeof authMetadata === 'function' ? authMetadata(call, count) : authMetadata);
    }
    if (options.purpose === 'inference') {
      assert.equal(executable, process.execPath, 'never invoke a real OpenCode executable');
      const selected = args[args.indexOf('--model') + 1];
      assert.ok(VALID_MODELS.includes(selected), 'only dynamically discovered Go fixture models may be selected');
      assert.ok(args.includes('--pure'));
      assert.equal(args.includes('--auto'), false, 'delegation cannot grant automatic tool approvals');
      const effective = JSON.parse(options.env.OPENCODE_CONFIG_CONTENT);
      assert.deepEqual(effective.enabled_providers, ['opencode-go']);
      assert.equal(effective.model, selected);
      assert.equal(effective.small_model, selected);
      assert.deepEqual(effective.permission, { '*': 'deny' });
      assert.deepEqual(effective.tools, { '*': false });
      assert.deepEqual(effective.agent.goflow.permission, { '*': 'deny' });
      assert.deepEqual(effective.agent.goflow.tools, { '*': false });
      assert.deepEqual(effective.plugin, []);
      assert.deepEqual(effective.mcp, {});
      assert.deepEqual(effective.instructions, []);
      assert.equal(options.env.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      const payload = response ? await response(call, calls.filter(c => c.purpose === 'inference').length) : { files: [{ path: SOURCE, content }] };
      return result(JSON.stringify({
        type: 'text', sessionID: 'SIMULATED_MODEL_SESSION',
        part: { id: 'SIMULATED_PART', type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) },
      }) + '\n');
    }
    assert.ok(['git', 'test'].includes(options.purpose), `unexpected command purpose: ${options.purpose}`);
    if (options.purpose === 'test') {
      assert.equal(path.resolve(executable).toLowerCase(), path.resolve(process.execPath).toLowerCase());
      assert.ok(args.includes('--permission'), 'independent test must keep the real Node permission boundary');
      assert.ok(args.includes('--test-isolation=none'));
    } else assert.equal(path.resolve(executable).toLowerCase(), path.resolve(GIT_EXE).toLowerCase());
    return runProcess(executable, args, options);
  };
  return { runner, calls, inferenceCalls: () => calls.filter(c => c.purpose === 'inference') };
}

function setup(t, fixtureOptions, runnerOptions, quotaOptions = {}) {
  const f = fixture(t, fixtureOptions);
  const simulation = simulatedRunner(runnerOptions);
  const quotaCalls = [];
  const quotaState = { percent: quotaOptions.percent ?? 0, category: quotaOptions.category ?? 'ok', coverage: quotaOptions.coverage ?? true };
  const auth = { available: true, source: 'SIMULATED QUOTA TEST FIXTURE', inferenceCredentialMatches: true, bindingId: 'a'.repeat(64) };
  const quota = new QuotaManager(f.options, {
    credentialBinding: async () => ({ ok: true, auth }),
    queryUsage: async () => {
      quotaCalls.push({ percent: quotaState.percent, category: quotaState.category });
      const fetchedAt = new Date().toISOString();
      if (quotaState.category !== 'ok') return { ok: false, category: quotaState.category, fetchedAt, auth,
        queryFailureReason: quotaState.category === 'authorization' ? 'credential_mismatch' : quotaState.category };
      return { ok: true, category: 'ok', fetchedAt, auth,
        verifiedCoverage: { verified: quotaState.coverage, provider: 'opencode-go', scope: 'account-shared',
          sourceSchema: 'SIMULATED current-three-window fixture', provenance: 'SIMULATED ONLY' },
        body: { useBalance: false, usage: Object.fromEntries(['rolling', 'weekly', 'monthly'].map(id => [id,
          { status: 'ok', percent: quotaState.percent, resetsAt: new Date(Date.now() + 3_600_000).toISOString() }])) } };
    },
  });
  return { ...f, simulation, quota, quotaCalls, quotaState, flow: new GoFlow(f.options, { runner: simulation.runner, quota }) };
}

async function passingProposal(t, options = {}) {
  const f = setup(t, options.fixture, options.runner);
  const record = await f.flow.submit(f.request);
  assert.equal(record.status, 'review_required', record.reason ?? JSON.stringify(record.attempts));
  assert.equal(record.attempts.length, 1);
  assert.equal(record.attempts[0].tests[0].exitCode, 0, 'real acceptance process must pass');
  assert.equal(record.attempts[0].tests[0].passed, true);
  assert.match(record.attempts[0].tests[0].stdout, /real project acceptance/);
  assert.equal(f.readSource(), ORIGINAL, 'proposal must not modify the original project');
  return { ...f, record };
}

test('[SIMULATED MODEL] billing guard blocks delegation before every model request', async t => {
  const f = setup(t, { billing: false });
  const result = await f.flow.submit(f.request);
  assert.equal(result.status, 'billing_blocked');
  assert.equal(f.simulation.calls.length, 0);
  assert.equal(f.readSource(), ORIGINAL);
  assert.equal((await f.flow.status()).inferenceAllowed, false);
  assert.equal((await f.flow.task(result.taskId)).status, 'billing_blocked');
});

test('[SIMULATED MODEL] balance-off confirmation alone cannot bypass active Go subscription confirmation', async t => {
  const f = setup(t, { config: { billingGuard: {
    useBalanceDisabledConfirmed: true,
    activeGoSubscriptionConfirmed: false,
    confirmedAt: '2026-10-13T00:00:00.000Z',
    confirmationSource: 'SIMULATED TEST FIXTURE - not a user attestation',
  } } });
  const result = await f.flow.submit(f.request);
  assert.equal(result.status, 'billing_blocked');
  assert.equal(f.simulation.calls.length, 0);
  assert.equal(f.readSource(), ORIGINAL);
  const status = await f.flow.status();
  assert.equal(status.inferenceAllowed, false);
  assert.equal(status.billingGuard.activeGoSubscriptionConfirmed, false);
  assert.equal((await f.flow.route(f.request)).billingBlocked, true);
});

test('[SIMULATED MODEL] high risk and complex tasks stay with GPT even in forced Go mode', async t => {
  const f = setup(t);
  for (const request of [
    { ...f.request, risk: 'high', mode: 'go' },
    { ...f.request, task: 'Rewrite OAuth credential validation', mode: 'go' },
    { ...f.request, complexity: 'high', mode: 'go' },
    { ...f.request, task: 'Design a distributed consensus architecture', mode: 'go' },
  ]) {
    const result = await f.flow.submit(request);
    assert.equal(result.status, 'retained_gpt');
    assert.equal(result.routing.executor, 'gpt');
  }
  assert.equal(f.simulation.calls.length, 0);
  assert.equal(f.readSource(), ORIGINAL);
});

test('ordinary code tasks keep credential exclusion guardrails without being routed as credential work', async t => {
  const f = setup(t);
  for (const task of [
    '添加 isBlank 并编写 Node 单元测试。不得修改 package.json，不添加依赖，不读取凭据或项目外文件。',
    '添加字符串工具。不要读取或输出 API Key。',
    'Implement trim helper tests. Do not read credentials or outside project files.',
    'Implement a local string function; never log secrets.',
  ]) assert.equal((await f.flow.route({...f.request,task})).executor,'go',task);
  assert.equal(f.simulation.inferenceCalls().length,0);
});

test('credential exclusions cannot hide real security work or explicit high risk even in forced Go mode', async t => {
  const f = setup(t);
  for (const task of [
    '不要读取密钥。修改 OAuth 认证与权限判断。',
    '不要读取凭据，但重新设计密码校验。',
    'Never read credentials. Rewrite payment billing logic.',
    'Implement string helper and rotate the API secret.',
    '不读取凭据内容，修改凭据保存功能。',
  ]) assert.equal((await f.flow.route({...f.request,task,mode:'go'})).executor,'gpt',task);
  assert.equal((await f.flow.route({...f.request,task:'字符串工具。不读取凭据。',risk:'high',mode:'go'})).executor,'gpt');
  assert.equal(f.simulation.inferenceCalls().length,0);
});

test('[SIMULATED MODEL] catalog filters providers dynamically and never uses a paid preference', async t => {
  const f = setup(t, { config: { modelPreference: ['openai/paid-model', VALID_MODELS[0]] } }, {
    models: ['openai/paid-model', 'opencode/free-model', ...VALID_MODELS, VALID_MODELS[0]],
  });
  const catalog = await f.flow.models();
  assert.deepEqual(catalog.models, [...VALID_MODELS].sort());
  assert.equal(catalog.provider, 'opencode-go');
  assert.equal(catalog.inference, false);
  const record = await f.flow.submit(f.request);
  assert.equal(record.status, 'review_required', record.reason);
  assert.equal(record.model, VALID_MODELS[0]);
  assert.equal(record.accounting.extraPaygAllowed, false);
  assert.equal(f.simulation.inferenceCalls().length, 1);
  assert.equal(f.readSource(), ORIGINAL);
});

test('[SIMULATED MODEL] catalog containing only other providers fails closed', async t => {
  const f = setup(t, undefined, { models: ['openai/paid-model', 'opencode/free-model'] });
  await assert.rejects(f.flow.models(), /没有实际可用|provider/);
  const record = await f.flow.submit(f.request);
  assert.equal(record.status, 'blocked');
  assert.equal(f.simulation.inferenceCalls().length, 0);
  assert.equal(f.readSource(), ORIGINAL);
});

test('[SIMULATED MODEL] a CLI version outside the audited version stops before inference', async t => {
  const f = setup(t, undefined, { version: '9.9.9-unaudited-fixture' });
  const record = await f.flow.submit(f.request);
  assert.equal(record.status, 'blocked');
  assert.match(record.reason, /版本.*审查|1\.18\.15/);
  assert.equal(f.simulation.calls.filter(c => c.purpose === 'version').length, 1);
  assert.equal(f.simulation.inferenceCalls().length, 0);
  assert.equal(f.readSource(), ORIGINAL);
});

test('[SIMULATED MODEL] model discovery prepares local install markers and verifies metadata before listing', async t => {
  const f = setup(t);
  await f.flow.models();
  assert.deepEqual(f.simulation.calls.map(c => c.purpose), ['version', 'authMetadata', 'models']);
  const directory = f.simulation.calls.find(call => call.purpose === 'models').cwd;
  for (const local of [directory, path.join(directory, 'xdg', 'opencode')]) {
    assert.ok(fs.statSync(path.join(local, 'node_modules')).isDirectory());
    const manifest = JSON.parse(fs.readFileSync(path.join(local, 'package.json'), 'utf8'));
    assert.deepEqual(manifest.dependencies, { '@opencode-ai/plugin': '1.18.15' });
    const lock = JSON.parse(fs.readFileSync(path.join(local, 'package-lock.json'), 'utf8'));
    assert.equal(lock.lockfileVersion, 3);
    assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  }
  assert.equal(f.simulation.inferenceCalls().length, 0);
});

test('[SIMULATED MODEL] wellknown, unknown, malformed, or non-Go auth metadata blocks discovery and inference', async t => {
  for (const authMetadata of [
    '● OpenCode Go api\n● Fixture remote wellknown\n└ 2 credentials\n',
    '● OpenCode Go api\n● Fixture remote mystery\n└ 2 credentials\n',
    '● OpenCode Go api\n└ 99 credentials\n',
    '● Other fixture provider oauth\n└ 1 credentials\n',
    'not a validated metadata format',
  ]) {
    const f = setup(t, undefined, { authMetadata });
    await assert.rejects(f.flow.models(), /元数据|wellknown|remote|provider/);
    const record = await f.flow.submit(f.request);
    assert.equal(record.status, 'blocked', record.reason);
    assert.equal(f.simulation.calls.filter(c => c.purpose === 'models').length, 0);
    assert.equal(f.simulation.inferenceCalls().length, 0);
    assert.equal(f.readSource(), ORIGINAL);
    // Runtime evidence must contain a safe rejection, never raw auth listing rows.
    const events = fs.readFileSync(path.join(f.stateDir, 'events.jsonl'), 'utf8');
    assert.equal(events.includes('●'), false);
  }
});

test('[SIMULATED MODEL] auth metadata is rechecked between model discovery and inference', async t => {
  const f = setup(t, undefined, { authMetadata: (_call, count) => count === 1
    ? '● OpenCode Go api\n└ 1 credentials\n'
    : '● OpenCode Go api\n● Fixture remote wellknown\n└ 2 credentials\n' });
  const record = await f.flow.submit(f.request);
  assert.equal(record.status, 'blocked', record.reason);
  assert.equal(f.simulation.calls.filter(c => c.purpose === 'models').length, 1);
  assert.equal(f.simulation.calls.filter(c => c.purpose === 'authMetadata').length, 2);
  assert.equal(f.simulation.inferenceCalls().length, 0);
  assert.equal(f.readSource(), ORIGINAL);
});

test('[SIMULATED MODEL] two repairs are capped at three total attempts and escalate using real test evidence', async t => {
  const f = setup(t, { config: { maxRepairAttempts: 50 } }, { content: WRONG });
  const record = await f.flow.submit(f.request);
  assert.equal(record.status, 'escalation_required', record.reason ?? JSON.stringify(record.attempts));
  assert.equal(f.simulation.inferenceCalls().length, 3);
  assert.equal(record.attempts.length, 3);
  for (const attempt of record.attempts) {
    assert.equal(attempt.passed, false);
    assert.ok(attempt.tests.length >= 1);
    assert.notEqual(attempt.tests[0].exitCode, 0);
    assert.equal(attempt.tests[0].passed, false);
    assert.match(attempt.tests[0].stdout, /AssertionError|ERR_ASSERTION/);
    assert.match(attempt.failure, /测试.*失败/);
  }
  const calls = f.simulation.inferenceCalls();
  assert.match(calls[1].input, /Previous attempt failed verification/);
  assert.match(calls[2].input, /AssertionError|ERR_ASSERTION/);
  assert.equal((await f.flow.status()).maxRepairAttempts, 2);
  assert.equal(f.readSource(), ORIGINAL);
  const saved = await f.flow.task(record.taskId);
  assert.equal(saved.status, 'escalation_required');
  assert.equal(saved.attempts.length, 3);
});

test('[SIMULATED MODEL] a later evidence-based repair can pass while original stays untouched', async t => {
  const f = setup(t, undefined, { response: (_call, attempt) => ({ files: [{ path: SOURCE, content: attempt === 1 ? WRONG : CORRECT }] }) });
  const record = await f.flow.submit(f.request);
  assert.equal(record.status, 'review_required', record.reason);
  assert.equal(record.attempts.length, 2);
  assert.equal(record.attempts[0].tests[0].passed, false);
  assert.equal(record.attempts[1].tests[0].passed, true);
  assert.equal(f.readSource(), ORIGINAL);
});

test('[SIMULATED MODEL] passing output creates a real diff and persistent evidence but requires review', async t => {
  const f = await passingProposal(t);
  const diff = fs.readFileSync(f.record.diffPath, 'utf8');
  assert.match(diff, /diff --git a\/src\/math\.mjs b\/src\/math\.mjs/);
  assert.match(diff, /\+export function add\(a, b\) \{ return a \+ b; \}/);
  const persisted = await f.flow.task(f.record.taskId);
  assert.equal(persisted.status, 'review_required');
  assert.equal(persisted.model, f.record.model);
  const testArtifact = JSON.parse(fs.readFileSync(path.join(f.record.artifactDirectory, 'attempt-1-test-1.json'), 'utf8'));
  assert.equal(testArtifact.exitCode, 0);
  const events = fs.readFileSync(path.join(f.stateDir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(events.some(event => event.type === 'review_required' && event.taskId === f.record.taskId && event.model === f.record.model));
});

test('[SIMULATED MODEL] a real empty Node test file cannot be accepted as a passing test suite', async t => {
  const f = setup(t, { config: { maxRepairAttempts: 0 } });
  write(path.join(f.directory, PROJECT_TEST), '// This real fixture deliberately declares no tests.\n');
  const record = await f.flow.submit(f.request);
  assert.equal(record.status, 'escalation_required', record.reason ?? JSON.stringify(record.attempts));
  assert.equal(record.attempts.length, 1);
  const tested = record.attempts[0].tests[0];
  assert.equal(tested.exitCode, 0, 'the real Node process must exit successfully to exercise this guard');
  assert.equal(tested.passed, false, 'a file wrapper with zero declared tests never proves acceptance');
  assert.equal(f.readSource(), ORIGINAL);
});

test('[SIMULATED MODEL] a real skipped-only Node suite with exit zero cannot prove acceptance', async t => {
  const f = setup(t, { config: { maxRepairAttempts: 0 } });
  write(path.join(f.directory, PROJECT_TEST), "import test from 'node:test';\ntest.skip('deliberately skipped fixture', () => {});\n");
  const record = await f.flow.submit(f.request);
  assert.equal(record.status, 'escalation_required', record.reason ?? JSON.stringify(record.attempts));
  const tested = record.attempts[0].tests[0];
  assert.equal(tested.exitCode, 0);
  assert.equal(tested.passCount, 0);
  assert.equal(tested.passed, false);
  assert.equal(f.readSource(), ORIGINAL);
});

test('[SIMULATED MODEL] acceptance requires GPT reviewer and a substantive review summary', async t => {
  const f = await passingProposal(t);
  for (const invalid of [
    { reviewer: 'Go', reviewSummary: REVIEW.reviewSummary },
    { reviewer: 'human', reviewSummary: REVIEW.reviewSummary },
    { reviewer: 'GPT', reviewSummary: 'OK' },
    { reviewer: 'GPT' },
  ]) await assert.rejects(f.flow.accept(f.record.taskId, invalid));
  assert.equal(f.readSource(), ORIGINAL);
  assert.equal((await f.flow.task(f.record.taskId)).status, 'review_required');
  const accepted = await f.flow.accept(f.record.taskId, REVIEW);
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.review.reviewer, 'GPT');
  assert.equal(accepted.review.summary, REVIEW.reviewSummary);
  assert.equal(f.readSource(), CORRECT);
  await assert.rejects(f.flow.accept(f.record.taskId, REVIEW), /仅允许/);
});

test('[SIMULATED MODEL] changed original source prevents application and preserves the new source', async t => {
  const f = await passingProposal(t);
  const changed = 'export function add(a, b) { return a + b + 100; }\n';
  write(path.join(f.directory, SOURCE), changed);
  await assert.rejects(f.flow.accept(f.record.taskId, REVIEW), /冲突|发生/);
  assert.equal(f.readSource(), changed);
  assert.equal((await f.flow.task(f.record.taskId)).status, 'review_required');
});

test('[SIMULATED MODEL] failed exclusive temporary-file creation preserves the existing file and original source', async t => {
  const f = await passingProposal(t);
  const temporary = `${path.join(f.directory, SOURCE)}.goflow-${f.record.taskId}.tmp`;
  const sentinel = 'existing temporary file belongs to a concurrent writer\n';
  write(temporary, sentinel);
  await assert.rejects(f.flow.accept(f.record.taskId, REVIEW), /应用失败|EEXIST/);
  assert.equal(fs.readFileSync(temporary, 'utf8'), sentinel, 'cleanup cannot delete a file it failed to create');
  assert.equal(f.readSource(), ORIGINAL);
  assert.equal((await f.flow.task(f.record.taskId)).status, 'review_required');
});

test('[SIMULATED MODEL] changed context prevents application even when the editable source is unchanged', async t => {
  const f = await passingProposal(t);
  fs.appendFileSync(path.join(f.directory, PROJECT_TEST), '// concurrent context edit\n');
  await assert.rejects(f.flow.accept(f.record.taskId, REVIEW), /冲突|发生/);
  assert.equal(f.readSource(), ORIGINAL);
});

test('[SIMULATED MODEL] changing a candidate after tests invalidates acceptance', async t => {
  const f = await passingProposal(t);
  write(path.join(f.record.workdir, SOURCE), WRONG);
  await assert.rejects(f.flow.accept(f.record.taskId, REVIEW), /测试后发生变更|重新测试/);
  assert.equal(f.readSource(), ORIGINAL);
});

test('[SIMULATED MODEL] traversal, absolute, control-config, and Windows reserved paths are rejected before inference', async t => {
  const f = setup(t);
  for (const unsafe of ['../outside.mjs', '..\\outside.mjs', path.join(f.root, 'outside.mjs'), '.env', '.codex/config.toml', 'src/NUL.txt', 'src/math.mjs.']) {
    const record = await f.flow.submit({ ...f.request, files: [unsafe, PROJECT_TEST], editableFiles: [unsafe] });
    assert.equal(record.status, 'blocked', `${unsafe}: ${record.reason}`);
  }
  assert.equal(f.simulation.inferenceCalls().length, 0);
  assert.equal(f.readSource(), ORIGINAL);
});

test('[SIMULATED MODEL] real junction/symlink and hard-linked inputs are rejected', async t => {
  const f = setup(t);
  const outside = path.join(f.root, 'outside');
  write(path.join(outside, 'outside.mjs'), CORRECT);
  const link = path.join(f.directory, 'linked');
  try { fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip(`OS cannot create test symlink: ${error.code}`); throw error; }
  const linked = await f.flow.submit({ ...f.request, files: ['linked/outside.mjs', PROJECT_TEST], editableFiles: ['linked/outside.mjs'] });
  assert.equal(linked.status, 'blocked', linked.reason);
  assert.match(linked.reason, /链接|junction/);
  fs.linkSync(path.join(f.directory, SOURCE), path.join(f.directory, 'src/hard.mjs'));
  const hard = await f.flow.submit({ ...f.request, files: ['src/hard.mjs', PROJECT_TEST], editableFiles: ['src/hard.mjs'] });
  assert.equal(hard.status, 'blocked', hard.reason);
  assert.match(hard.reason, /硬链接/);
  assert.equal(f.simulation.inferenceCalls().length, 0);
});

test('[SIMULATED MODEL] model attempts to edit undeclared or traversing files cannot reach the original project', async t => {
  const f = setup(t, { config: { maxRepairAttempts: 0 } }, { response: () => ({ files: [{ path: '../escape.mjs', content: CORRECT }] }) });
  const escaped = await f.flow.submit(f.request);
  assert.equal(escaped.status, 'escalation_required');
  assert.equal(escaped.attempts[0].tests.length, 0);
  assert.equal(fs.existsSync(path.join(f.stateDir, 'tasks', escaped.taskId, 'escape.mjs')), false);
  assert.equal(f.readSource(), ORIGINAL);
  const g = setup(t, { config: { maxRepairAttempts: 0 } }, { response: () => ({ files: [{ path: PROJECT_TEST, content: '// unauthorized' }] }) });
  const undeclared = await g.flow.submit(g.request);
  assert.equal(undeclared.status, 'escalation_required');
  assert.match(undeclared.attempts[0].failure, /未声明/);
  assert.equal(g.readSource(), ORIGINAL);
});

test('[SIMULATED MODEL] modes persist and force Go cannot remove conservative routing gates', async t => {
  const f = setup(t);
  for (const mode of ['off', 'gpt', 'go', 'auto']) {
    const status = await f.flow.setMode(mode);
    assert.equal(status.mode, mode);
    const reread = new GoFlow(f.options, { runner: f.simulation.runner });
    assert.equal((await reread.status()).mode, mode);
    const low = await reread.route(f.request);
    assert.equal(low.executor, ['off', 'gpt'].includes(mode) ? 'gpt' : 'go');
    const high = await reread.route({ ...f.request, risk: 'high', mode: 'go' });
    assert.equal(high.executor, 'gpt');
    if (['off', 'gpt'].includes(mode)) assert.equal((await reread.submit(f.request)).status, 'retained_gpt');
  }
  await assert.rejects(f.flow.setMode('unsafe'));
  assert.equal(f.simulation.inferenceCalls().length, 0);
});

test('[SIMULATED MODEL] process and authorization errors queue without consuming a capability repair', async t => {
  for (const code of [1, 0]) {
    const f = setup(t);
    const underlying = f.simulation.runner;
    let inferenceCalls = 0;
    f.flow.runner = async (exe, args, options) => {
      if (options.purpose !== 'inference') return underlying(exe, args, options);
      inferenceCalls++;
      return {code, stdout: code === 0 ? JSON.stringify({type:'error',error:{message:'Authentication rejected by provider: 401'}})+'\n' : '', stderr:code ? 'CLI transport failed' : '',durationMs:1};
    };
    const record=await f.flow.submit(f.request);
    assert.equal(record.status,'queued');
    assert.equal(record.queue.category,code===0?'authorization':'service');
    assert.equal(record.capabilityFailures,0);
    assert.equal(inferenceCalls,1);
    assert.equal(record.attempts.length,1);
    assert.equal(record.attempts[0].tests.length,0);
    assert.equal(f.readSource(),ORIGINAL);
  }
});

test('[SIMULATED MODEL] concurrent tasks on one source use distinct real snapshot Git workspaces', async t => {
  let releaseFirst;
  const gate = new Promise(resolve=>{releaseFirst=resolve;});
  const f = setup(t, undefined, { response: async(_call,attempt)=>{if(attempt===1)await gate;return {files:[{path:SOURCE,content:CORRECT}]};} });
  const firstPromise=f.flow.submit(f.request);
  const deadline=Date.now()+5000;
  while(f.simulation.inferenceCalls().length!==1&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.simulation.inferenceCalls().length,1);
  const queued=await f.flow.submit(f.request);
  assert.equal(queued.status,'queued');assert.equal(queued.queue.category,'busy');
  assert.equal(f.simulation.inferenceCalls().length,1,'only one shared Go request may be active');
  releaseFirst();
  const first=await firstPromise;
  const second=await f.flow.resume(queued.taskId);
  assert.equal(second.taskId,queued.taskId,'resume must preserve the exact queue ID');
  assert.equal(first.status, 'review_required', first.reason);
  assert.equal(second.status, 'review_required', second.reason);
  assert.notEqual(first.taskId, second.taskId);
  assert.notEqual(first.workdir, second.workdir);
  assert.ok(fs.existsSync(path.join(first.workdir, '.git')));
  assert.ok(fs.existsSync(path.join(second.workdir, '.git')));
  const calls = f.simulation.inferenceCalls();
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].cwd, calls[1].cwd);
  assert.equal(fs.readFileSync(path.join(first.workdir, SOURCE), 'utf8'), CORRECT);
  assert.equal(fs.readFileSync(path.join(second.workdir, SOURCE), 'utf8'), CORRECT);
  assert.equal(f.readSource(), ORIGINAL);
  await f.flow.accept(first.taskId, REVIEW);
  await assert.rejects(f.flow.accept(second.taskId, REVIEW), /冲突/);
  assert.equal(f.readSource(), CORRECT);
});

test('[SIMULATED QUOTA] status reads cached quota only; read-only usage works before billing confirmation', async t => {
  const f=setup(t,{billing:false});
  assert.equal(f.quotaCalls.length,0);
  const before=await f.flow.status();assert.equal(before.quota.fresh,false);assert.equal(f.quotaCalls.length,0);
  const usage=await f.flow.usage({force:true});assert.equal(usage.channel,'opencode-go');assert.equal(usage.quota.maxPercent,0);
  assert.equal(f.quotaCalls.length,1);
  for(let n=0;n<3;n++)assert.equal((await f.flow.status()).quota.fresh,true);
  assert.equal(f.quotaCalls.length,1,'status must not invoke a usage GET');
  assert.equal((await f.flow.status()).inferenceAllowed,false);
  assert.equal((await f.flow.status()).metrics.successRate,null);
  await assert.rejects(f.flow.usage({force:'true'}));
  assert.equal(f.simulation.inferenceCalls().length,0);
});

test('[SIMULATED QUOTA] cached eligibility rejects API balance, rate limits and credential mismatch without GET', async t => {
  const f=setup(t);await f.flow.usage({force:true});assert.equal((await f.flow.status()).inferenceAllowed,true);
  const cacheFile=path.join(f.stateDir,'quota','usage-cache.json');const original=JSON.parse(fs.readFileSync(cacheFile,'utf8'));
  for(const modify of [cache=>{cache.quota.useBalance=true;},cache=>{cache.quota.windows[0].status='rate-limited';},cache=>{cache.auth.inferenceCredentialMatches=false;}]){
    const cache=structuredClone(original);modify(cache);write(cacheFile,JSON.stringify(cache));
    const status=await f.flow.status();assert.equal(status.inferenceAllowed,false);assert.equal(status.cachedEligibilityIsGrant,false);
  }
  assert.equal(f.quotaCalls.length,1,'eligibility display may not query usage repeatedly');
});

test('[SIMULATED QUOTA] 95 percent queues an exact task and quota reset resumes that same ID', async t => {
  const f=setup(t,undefined,undefined,{percent:95});
  const queued=await f.flow.submit(f.request);
  assert.equal(queued.status,'queued');assert.equal(queued.queue.reason,'quota_95');assert.equal(queued.capabilityFailures,0);
  assert.equal(f.simulation.inferenceCalls().length,0);assert.equal(f.readSource(),ORIGINAL);
  const list=await f.flow.queue();assert.equal(list.total,1);assert.equal(list.tasks[0].taskId,queued.taskId);
  f.quotaState.percent=0;await f.flow.usage({force:true});
  const resumed=await f.flow.resume(queued.taskId);
  assert.equal(resumed.taskId,queued.taskId);assert.equal(resumed.status,'review_required',resumed.reason);
  assert.equal((await f.flow.queue()).total,0);assert.equal(f.readSource(),ORIGINAL);
  assert.equal((await f.flow.status()).taskCount,1);
  assert.equal((await f.flow.status()).metrics.realTaskCount,0,'mock tasks cannot fabricate historical success');
});

test('[SIMULATED QUOTA] unknown coverage and query authorization failures queue without paid fallback', async t => {
  for(const options of [{coverage:false},{category:'authorization'},{category:'service'}]){
    const f=setup(t,undefined,undefined,options);const record=await f.flow.submit(f.request);
    assert.equal(record.status,'queued',record.reason);assert.equal(record.capabilityFailures,0);
    if(options.category==='authorization')assert.equal(record.queue.queryFailureReason,'credential_mismatch');
    assert.equal(f.simulation.inferenceCalls().length,0);assert.equal(f.readSource(),ORIGINAL);
    assert.equal(record.queue.automaticGptFallback,false);
  }
});

test('[SIMULATED QUOTA] quota is readmitted for each repair and a new 95 percent hold preserves repair evidence', async t => {
  const f=setup(t,undefined,{content:WRONG});
  const underlying=f.simulation.runner;
  f.flow.runner=async(exe,args,options)=>{const result=await underlying(exe,args,options);if(options.purpose==='inference')f.quotaState.percent=95;return result;};
  const queued=await f.flow.submit(f.request);
  assert.equal(queued.status,'queued');assert.equal(queued.capabilityFailures,1);assert.equal(queued.attempts.length,1);
  assert.equal(queued.attempts[0].tests[0].passed,false);assert.equal(f.simulation.inferenceCalls().length,1);
  assert.ok(f.quotaCalls.length>=3,'initial admission and repair re-admission must refresh usage');
  assert.equal((await f.quota.status()).activeLeases.length,0,'every model request releases its permit');
  const events=fs.readFileSync(path.join(f.stateDir,'quota','events.jsonl'),'utf8');assert.match(events,/lease_released/);
});

test('[SIMULATED QUOTA] provider 429 and timeout queue as resources and never consume coding repairs', async t => {
  for(const failure of [{code:429,stderr:'SIMULATED rate limited',category:'quota'},{code:503,stderr:'SIMULATED 503',category:'service'},{code:null,stderr:'SIMULATED timeout',timedOut:true,category:'service'}]){
    const f=setup(t);const underlying=f.simulation.runner;
    f.flow.runner=async(exe,args,options)=>options.purpose==='inference'?{...failure,stdout:'',durationMs:1}:underlying(exe,args,options);
    const record=await f.flow.submit(f.request);
    assert.equal(record.status,'queued');assert.equal(record.queue.category,failure.category);assert.equal(record.capabilityFailures,0);
    assert.equal(record.attempts.length,1);assert.equal(record.attempts[0].tests.length,0);
    assert.equal((await f.quota.status()).activeLeases.length,0);
  }
});

test('[SIMULATED QUOTA] 95-percent one-task CLI permit allows one request but cannot bypass 100 or billing', async t => {
  const f=setup(t,undefined,undefined,{percent:95});
  const queued=await f.flow.submit(f.request);
  await assert.rejects(f.flow.allowOnce({taskId:queued.taskId,model:'openai/paid',authorizationSource:'SIMULATED explicit human authorization for this exact fixture'}));
  const permit=await f.flow.allowOnce({taskId:queued.taskId,model:queued.model,authorizationSource:'SIMULATED explicit human authorization for this exact fixture'});
  assert.equal('token' in permit,false);assert.equal(permit.maxUses,1);
  const resumed=await f.flow.resume(queued.taskId);assert.equal(resumed.status,'review_required',resumed.reason);assert.equal(resumed.taskId,queued.taskId);
  assert.equal(f.simulation.inferenceCalls().length,1);assert.equal(f.readSource(),ORIGINAL);
  const g=setup(t,undefined,undefined,{percent:100});const held=await g.flow.submit(g.request);
  await g.flow.allowOnce({taskId:held.taskId,model:held.model,authorizationSource:'SIMULATED explicit human authorization for this exact fixture'});
  assert.equal((await g.flow.resume(held.taskId)).status,'queued');assert.equal(g.simulation.inferenceCalls().length,0);
  const config=JSON.parse(fs.readFileSync(g.runtimeConfigPath,'utf8'));config.billingGuard.activeGoSubscriptionConfirmed=false;write(g.runtimeConfigPath,JSON.stringify(config));
  assert.equal((await g.flow.resume(held.taskId)).queue.reason,'billing_confirmation_required');assert.equal(g.simulation.inferenceCalls().length,0);
});

test('[SIMULATED QUOTA] queued source conflicts and manual stable model selection preserve original requirements', async t => {
  const f=setup(t,undefined,undefined,{percent:95});const queued=await f.flow.submit(f.request);
  write(path.join(f.directory,SOURCE),CORRECT);f.quotaState.percent=0;
  const conflict=await f.flow.resume(queued.taskId);assert.equal(conflict.status,'blocked');assert.match(conflict.reason,/冲突/);
  assert.equal(f.simulation.inferenceCalls().length,0);assert.equal(f.readSource(),CORRECT);
  await assert.rejects(f.flow.selectModel('openai/paid-model'));
  const selection=await f.flow.selectModel(VALID_MODELS[0]);assert.equal(selection.channel,'opencode-go');assert.equal(selection.gptModelChanged,false);
  assert.equal(JSON.parse(fs.readFileSync(f.runtimeConfigPath,'utf8')).selectedModel,VALID_MODELS[0]);
});

async function exitedPid(){
  const child=spawn(process.execPath,['--version'],{windowsHide:true,stdio:'ignore'});
  const pid=child.pid;await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});return pid;
}

test('[SIMULATED QUOTA] real dead-owner resume and accept locks recover; a live process owner cannot be stolen', async t => {
  const f=setup(t,undefined,undefined,{percent:95});const queued=await f.flow.submit(f.request);
  const lockPath=path.join(f.stateDir,'tasks',queued.taskId,'resume.lock');
  write(lockPath,JSON.stringify({id:'SIMULATED-dead-owner',pid:await exitedPid(),createdAt:new Date().toISOString()}));
  f.quotaState.percent=0;const resumed=await f.flow.resume(queued.taskId);assert.equal(resumed.status,'review_required',resumed.reason);
  const acceptLock=path.join(f.stateDir,'accept.lock');write(acceptLock,JSON.stringify({id:'SIMULATED-dead-accept',pid:await exitedPid(),createdAt:new Date().toISOString()}));
  assert.equal((await f.flow.accept(resumed.taskId,REVIEW)).status,'accepted');
  const g=setup(t,undefined,undefined,{percent:95});const held=await g.flow.submit(g.request);
  const live=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
  t.after(()=>live.kill());
  const liveLock=path.join(g.stateDir,'tasks',held.taskId,'resume.lock');const owner={id:'SIMULATED-live-owner',pid:live.pid,createdAt:new Date().toISOString()};write(liveLock,JSON.stringify(owner));
  await assert.rejects(g.flow.resume(held.taskId),/持有.*锁/);assert.deepEqual(JSON.parse(fs.readFileSync(liveLock,'utf8')),owner);
  assert.equal(g.simulation.inferenceCalls().length,0);
});

test('real process stdin waits for worker binding; rejected binding never sends a prompt',async()=>{
  let bound=false;
  const script="let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>process.stdout.write(input));";
  const accepted=await runProcess(process.execPath,['-e',script],{input:'SIMULATED-PROMPT',timeoutMs:5000,onSpawn:async pid=>{
    assert.ok(Number.isInteger(pid));await new Promise(resolve=>setTimeout(resolve,40));bound=true;
  }});
  assert.equal(bound,true);assert.equal(accepted.code,0);assert.equal(accepted.stdout,'SIMULATED-PROMPT');
  const rejected=await runProcess(process.execPath,['-e',script],{input:'SIMULATED-PROMPT-MUST-NOT-BE-SENT',timeoutMs:5000,onSpawn:async()=>{throw new Error('SIMULATED binding rejected');}});
  assert.notEqual(rejected.code,0);assert.equal(rejected.stdout.includes('SIMULATED-PROMPT-MUST-NOT-BE-SENT'),false);
  assert.match(rejected.stderr,/before prompt/);
});

test('[SIMULATED MODEL] real Windows mixed slash executable always receives permission and canonical TAP; empty files still fail',
  {skip:process.platform!=='win32'},async t=>{
  for(const empty of [false,true]){
    const f=setup(t,{config:{maxRepairAttempts:0}});
    const mixed=process.execPath.replaceAll('\\','/');
    assert.notEqual(mixed,process.execPath,'this regression must exercise Windows slash differences');
    f.request.tests=[{command:mixed,args:['--test','--test-reporter=spec',PROJECT_TEST]}];
    if(empty)write(path.join(f.directory,PROJECT_TEST),'// Deliberately declares no actual tests.\n');
    const record=await f.flow.submit(f.request);
    assert.equal(record.status,empty?'escalation_required':'review_required',record.reason);
    const calls=f.simulation.calls.filter(call=>call.purpose==='test');assert.equal(calls.length,1);
    assert.ok(calls[0].args.includes('--permission'));assert.ok(calls[0].args.includes('--test-isolation=none'));
    assert.ok(calls[0].args.includes('--test-reporter=tap'));assert.equal(calls[0].args.includes('--test-reporter=spec'),false);
    const tested=record.attempts[0].tests[0];assert.equal(tested.exitCode,0);assert.match(tested.stdout,/TAP version/);
    assert.equal(tested.passed,!empty);assert.equal(f.readSource(),ORIGINAL);
  }
});

test('[SIMULATED MODEL] a real successful spec report is a verification environment hold, not a coding failure',async t=>{
  const f=setup(t);const underlying=f.simulation.runner;
  f.flow.runner=async(exe,args,options)=>options.purpose==='test'
    ? runProcess(exe,args.map(arg=>arg==='--test-reporter=tap'?'--test-reporter=spec':arg),options)
    : underlying(exe,args,options);
  const record=await f.flow.submit(f.request);
  assert.equal(record.status,'queued');assert.equal(record.queue.reason,'verification_environment');assert.equal(record.queue.category,'service');
  assert.equal(record.capabilityFailures,0);assert.equal(record.attempts.length,1);assert.equal(f.simulation.inferenceCalls().length,1);
  const tested=record.attempts[0].tests[0];assert.equal(tested.exitCode,0);assert.match(tested.stdout,/real project acceptance/);
  assert.equal(tested.failureCategory,'verification_environment');assert.equal(record.attempts[0].failureCategory,'verification_environment');
  assert.equal(f.readSource(),ORIGINAL);
});
