/** GoFlow quota admission control. Sanitized official usage only; no keys or billing estimates. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const WINDOWS = ['rolling', 'weekly', 'monthly'];
const CATEGORIES = new Set(['authorization', 'quota', 'service', 'network', 'schema', 'ok']);
const FAILURE_CODES = new Set(['credential_mismatch', 'missing_native_go_auth', 'missing_login', 'unsupported_auth_store',
  'unsafe_response_rejected', 'not_exposed', 'timeout', 'rate_limited', 'service_unavailable', 'network_error', 'schema_unknown', 'source_changed']);
const failureCode = (...values) => values.find(value => typeof value === 'string' && FAILURE_CODES.has(value)) ?? null;
const safeText = value => String(value ?? '').slice(0, 500)
  .replace(/\b(?:sk-[\w-]{12,}|(?:ghp|github_pat)_[\w]{12,})\b/g, '[REDACTED]')
  .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]');
const timestamp = value => {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(hourText) > 23
    || Number(minuteText) > 59 || Number(secondText) > 59
    || (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) return null;
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
};
const modelId = value => typeof value === 'string' && /^opencode-go\/[A-Za-z0-9._:-]+$/.test(value);
const taskIdValid = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value);
const tokenValid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const percentValid = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const bindingValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Accept only the reviewed legacy and current three-window subscription schemas.
 * verifiedCoverage is transport-supplied provenance, never inferred from a model.
 * No per-model wallet, local token total, multiplier or cost estimate is invented.
 */
export function normalizeUsage(raw) {
  const body = raw?.body ?? raw;
  const fetchedAt = timestamp(raw?.fetchedAt) ?? null;
  const coverageInput = raw?.verifiedCoverage ?? body?.verifiedCoverage;
  const verified = coverageInput?.verified === true && coverageInput?.provider === 'opencode-go'
    && ['account', 'account-shared'].includes(coverageInput?.scope)
    && typeof coverageInput?.sourceSchema === 'string' && coverageInput.sourceSchema.length > 0;
  const coverage = { verified, scope: verified ? 'account-shared' : 'unknown', provider: 'opencode-go',
    sourceSchema: verified ? safeText(coverageInput.sourceSchema) : null,
    provenance: verified && typeof coverageInput?.provenance === 'string' ? safeText(coverageInput.provenance) : null };
  const useBalance = typeof body?.useBalance === 'boolean' ? body.useBalance : null;
  const result = { schemaVersion: 1, available: false, reliable: false, reason: 'quota_unknown', fetchedAt,
    useBalance, useBalanceSource: useBalance === null ? 'not_exposed' : 'official_api', coverage, windows: [], modelGroups: [],
    windowCoverage: verified ? 'account-subscription-windows-verified-live' : 'unknown', modelWallets: 'not-exposed',
    accountingScope: 'shared account quota; model-specific wallets not reported' };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return result;
  let schema;
  if (body.usage && typeof body.usage === 'object' && WINDOWS.every(id => body.usage[id] && typeof body.usage[id] === 'object')) schema = 'current';
  else if (WINDOWS.every(id => body[`${id}Usage`] && typeof body[`${id}Usage`] === 'object')) schema = 'legacy';
  if (!schema) return result;
  const fetchedMillis = fetchedAt ? Date.parse(fetchedAt) : NaN;
  for (const id of WINDOWS) {
    const source = schema === 'current' ? body.usage[id] : body[`${id}Usage`];
    const percent = schema === 'current' ? source.percent : source.usagePercent;
    const status = source.status;
    let resetAt = schema === 'current' ? timestamp(source.resetsAt) : null;
    if (schema === 'legacy' && Number.isSafeInteger(source.resetInSec) && source.resetInSec >= 0
      && source.resetInSec <= 366 * 86_400 && Number.isFinite(fetchedMillis)) {
      const resetMillis = fetchedMillis + source.resetInSec * 1000;
      if (Number.isSafeInteger(resetMillis) && Number.isFinite(new Date(resetMillis).getTime())) {
        resetAt = timestamp(new Date(resetMillis).toISOString());
      }
    }
    if (!percentValid(percent) || !['ok', 'rate-limited'].includes(status) || !resetAt) return result;
    result.windows.push({ id, status, percent, resetAt, scope: 'account-shared',
      sourceField: schema === 'current' ? `usage.${id}` : `${id}Usage` });
  }
  result.available = true;
  result.reliable = verified;
  result.reason = verified ? null : 'quota_unknown';
  result.sourceSchema = schema;
  result.maxPercent = Math.max(...result.windows.map(w => w.percent));
  return result;
}

async function readJson(filename, fallback) {
  try { return JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function atomicJson(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try { await fs.rename(temporary, filename); }
  finally { try { await fs.unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
const leaseHeld = (lease, now) => pidAlive(lease.pid) || pidAlive(lease.workerPid) || Date.parse(lease.expiresAt) > now;

export class QuotaManager {
  constructor(options = {}, dependencies = {}) {
    this.stateDir = path.resolve(options.stateDir ?? path.join(os.homedir(), '.codex', 'goflow', 'state'));
    this.runtimeConfigPath = path.resolve(options.runtimeConfigPath ?? path.join(path.dirname(this.stateDir), 'runtime-config.json'));
    this.directory = path.join(this.stateDir, 'quota');
    this.query = dependencies.queryUsage ?? (async (config, options) => {
      const { queryUsage } = await import('./usage-transport.mjs');
      return queryUsage(config, options);
    });
    this.inspect = dependencies.credentialBinding ?? (async config => {
      const { inspectCredentialBinding } = await import('./usage-transport.mjs');
      return inspectCredentialBinding(config);
    });
    this.now = () => {
      const value = dependencies.now ? dependencies.now() : Date.now();
      const millis = value instanceof Date ? value.getTime() : Number(value);
      if (!Number.isFinite(millis)) throw new Error('quota clock invalid');
      return millis;
    };
  }

  file(name) { return path.join(this.directory, name); }
  at() { return new Date(this.now()).toISOString(); }

  async config() {
    const full = await readJson(this.runtimeConfigPath, {});
    const input = full.quota ?? {};
    const bounded = (value, fallback, min, max) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
    return { full, cacheTtlMs: bounded(input.cacheTtlMs, 60_000, 100, 60_000),
      leaseMs: bounded(input.leaseMs, 900_000, 1000, 1800_000),
      queryTimeoutMs: bounded(input.queryTimeoutMs, 15_000, 5, 30_000),
      maxConcurrent: 1, queueLimit: 200 };
  }

  async event(record) {
    await fs.mkdir(this.directory, { recursive: true });
    await fs.appendFile(this.file('events.jsonl'), `${JSON.stringify({ at: this.at(), ...record })}\n`, { mode: 0o600 });
  }

  async locked(action) {
    await fs.mkdir(this.directory, { recursive: true });
    const filename = this.file('quota.lock');
    const id = randomUUID(), deadline = Date.now() + 35_000;
    let handle;
    while (!handle) {
      if (Date.now() > deadline) throw new Error('quota_lock_busy');
      try {
        handle = await fs.open(filename, 'wx');
        await handle.writeFile(JSON.stringify({ id, pid: process.pid, createdAt: Date.now(), expiresAt: Date.now() + 35_000 }));
      } catch (error) {
        if (error.code !== 'EEXIST') { if (handle) await handle.close(); throw error; }
        let stale = false;
        try {
          const existing = await readJson(filename, null);
          stale = existing && !pidAlive(existing.pid);
        } catch {
          try { stale = Date.now() - (await fs.stat(filename)).mtimeMs > 35_000; } catch {}
        }
        if (stale) {
          const recoveryPath = this.file('quota-recovery.lock');
          let recovery;
          try {
            recovery = await fs.open(recoveryPath, 'wx');
            await recovery.writeFile(JSON.stringify({ id: randomUUID(), pid: process.pid }));
            // Re-read under the recovery guard: a stale-lock contender must
            // never delete a replacement acquired by another live process.
            let current;
            try { current = await readJson(filename, null); }
            catch {
              try { if (Date.now() - (await fs.stat(filename)).mtimeMs > 35_000) await fs.unlink(filename); }
              catch (removeError) { if (removeError.code !== 'ENOENT') throw removeError; }
            }
            if (current && !pidAlive(current.pid)) {
              try { await fs.unlink(filename); } catch (removeError) { if (removeError.code !== 'ENOENT') throw removeError; }
            }
          } catch (recoveryError) {
            if (recoveryError.code !== 'EEXIST') throw recoveryError;
            const currentGuard = await readJson(recoveryPath, null).catch(() => null);
            if (currentGuard && !pidAlive(currentGuard.pid)) {
              try { await fs.unlink(recoveryPath); } catch (removeError) { if (removeError.code !== 'ENOENT') throw removeError; }
            } else if (!currentGuard) {
              try {
                if (Date.now() - (await fs.stat(recoveryPath)).mtimeMs > 35_000) await fs.unlink(recoveryPath);
              } catch (removeError) { if (removeError.code !== 'ENOENT') throw removeError; }
            }
          } finally {
            if (recovery) { await recovery.close(); await fs.unlink(recoveryPath); }
          }
          await pause(5); continue;
        }
        if (Date.now() > deadline) throw new Error('quota_lock_busy');
        await pause(20);
      }
    }
    try { return await action(); }
    finally {
      await handle.close();
      const current = await readJson(filename, null);
      if (current?.id === id) await fs.unlink(filename);
    }
  }

  async cache() { return readJson(this.file('usage-cache.json'), null); }

  view(cache, cfg) {
    if (!cache) return { ok: false, fresh: false, stale: true, category: 'schema', reason: 'quota_unknown',
      queryFailureReason: null, lastSuccessAt: null, fetchedAt: null, quota: null, retryAt: null };
    const age = this.now() - Date.parse(cache.lastSuccessAt ?? '');
    const resetCrossed = (cache.quota?.windows ?? []).some(window => Date.parse(window.resetAt) <= this.now());
    const fresh = !cache.invalidatedAt && !cache.error && Number.isFinite(age) && age >= 0
      && age < cfg.cacheTtlMs && !resetCrossed && cache.quota?.available === true;
    return { ok: !cache.error && cache.quota?.available === true, fresh, stale: !fresh,
      category: cache.error?.category ?? (cache.quota?.available ? 'ok' : 'schema'),
      reason: fresh ? null : cache.error?.reason ?? 'quota_unknown',
      queryFailureReason: cache.error?.queryFailureReason ?? null,
      fetchedAt: cache.quota?.fetchedAt ?? null, lastSuccessAt: cache.lastSuccessAt ?? null,
      quota: cache.quota ?? null, retryAt: cache.nextRetryAt ?? null, errorAt: cache.error?.at ?? null,
      auth: { available: cache.auth?.available === true, source: cache.auth?.source ?? null,
        inferenceCredentialMatches: cache.auth?.inferenceCredentialMatches === true }, endpoint: cache.endpoint ?? null,
      consoleFallback: cache.consoleFallback ?? null };
  }

  async cached() { const cfg = await this.config(); return this.view(await this.cache(), cfg); }

  async status() {
    const usage = await this.cached();
    const leases = await readJson(this.file('leases.json'), []);
    const queue = await readJson(this.file('queue.json'), []);
    const permits = await readJson(this.file('overrides.json'), []);
    return { ...usage, activeLeases: leases.filter(lease => leaseHeld(lease, this.now()))
      .map(lease => ({ ...lease, ownerAlive: pidAlive(lease.pid), workerAlive: pidAlive(lease.workerPid), expired: Date.parse(lease.expiresAt) <= this.now() })),
      overrides: permits.filter(permit => Date.parse(permit.expiresAt) > this.now()).map(({ model, taskId, remainingUses, expiresAt }) => ({ model, taskId, remainingUses, expiresAt })),
      deferredCount: queue.length, maxConcurrent: 1 };
  }

  async usage({ force = false } = {}) {
    return this.locked(async () => this.usageUnlocked(await this.config(), force));
  }

  async usageUnlocked(cfg, force = false, admission = false) {
    let previous = await this.cache();
    let inspected;
    try { inspected = await this.inspect(cfg.full); } catch { inspected = { ok: false, auth: { available: false } }; }
    const localAuth = { available: inspected?.auth?.available === true,
      source: typeof inspected?.auth?.source === 'string' ? safeText(inspected.auth.source) : null,
      inferenceCredentialMatches: inspected?.auth?.inferenceCredentialMatches === true,
      bindingId: bindingValid(inspected?.auth?.bindingId) ? inspected.auth.bindingId : null };
    const localBindingValid = inspected?.ok === true && localAuth.available && localAuth.inferenceCredentialMatches && localAuth.bindingId !== null;
    const bindingChanged = previous && (previous.auth?.bindingId !== localAuth.bindingId || previous.auth?.source !== localAuth.source);
    if (!localBindingValid || bindingChanged) {
      previous = { ...(previous ?? {}), version: 1, auth: localAuth, invalidatedAt: this.at(),
        error: localBindingValid ? null : { category: 'authorization', reason: 'authorization', at: this.at(),
          queryFailureReason: failureCode(inspected?.queryFailureReason, inspected?.reason, inspected?.auth?.reason)
            ?? (localAuth.available && !localAuth.inferenceCredentialMatches ? 'credential_mismatch' : 'missing_login') }, nextRetryAt: null };
      await atomicJson(this.file('usage-cache.json'), previous);
      await this.event({ type: 'credential_binding_invalidated', available: localAuth.available,
        inferenceCredentialMatches: localAuth.inferenceCredentialMatches, changed: !!bindingChanged });
      if (!localBindingValid) return this.view(previous, cfg);
      force = true;
    }
    const existing = this.view(previous, cfg);
    if (!force && existing.fresh) return existing;
    if ((!force || admission) && previous?.nextRetryAt && Date.parse(previous.nextRetryAt) > this.now()) return existing;
    const controller = new AbortController();
    let timer;
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve({ ok: false, category: 'network', fetchedAt: this.at(), timeout: true }); }, cfg.queryTimeoutMs);
    });
    let response;
    try {
      response = await Promise.race([Promise.resolve().then(() => this.query(cfg.full, { signal: controller.signal })), timeout]);
    } catch { response = { ok: false, category: 'network', fetchedAt: this.at() }; }
    finally { clearTimeout(timer); }
    const fetchedAt = timestamp(response?.fetchedAt) ?? this.at();
    const auth = { available: response?.auth?.available === true,
      source: typeof response?.auth?.source === 'string' ? safeText(response.auth.source) : null,
      inferenceCredentialMatches: response?.auth?.inferenceCredentialMatches === true,
      bindingId: bindingValid(response?.auth?.bindingId) ? response.auth.bindingId : null };
    const endpoint = typeof response?.endpoint === 'string' && /^https:\/\/[^\s?]+$/.test(response.endpoint) ? response.endpoint : null;
    const consoleFallback = typeof response?.consoleFallback === 'boolean' ? response.consoleFallback
      : typeof response?.consoleFallback === 'string' && /^https:\/\/[^\s?]+$/.test(response.consoleFallback) ? response.consoleFallback : null;
    const normalized = normalizeUsage({ body: response?.body, fetchedAt, verifiedCoverage: response?.verifiedCoverage });
    const responseBindingValid = auth.available && auth.inferenceCredentialMatches && auth.bindingId === localAuth.bindingId && auth.source === localAuth.source;
    const successful = response?.ok === true && responseBindingValid && normalized.available && normalized.reliable;
    if (successful) {
      const cache = { version: 1, lastSuccessAt: fetchedAt, quota: normalized, auth, endpoint, consoleFallback,
        error: null, nextRetryAt: null, invalidatedAt: null };
      await atomicJson(this.file('usage-cache.json'), cache);
      await this.event({ type: 'usage_success', maxPercent: normalized.maxPercent,
        windows: normalized.windows.map(({ id, percent, resetAt }) => ({ id, percent, resetAt })) });
      return this.view(cache, cfg);
    }
    const category = response?.ok === true ? responseBindingValid ? 'schema' : 'authorization'
      : CATEGORIES.has(response?.category) && response.category !== 'ok' ? response.category : 'network';
    const retrySeconds = category === 'authorization' ? 300 : category === 'quota'
      ? Math.max(1, Math.min(3600, Number(response?.retryAfterSeconds) || 60))
      : category === 'service' ? 60 : category === 'schema' ? 300 : 30;
    const reason = category === 'schema' ? 'quota_unknown' : category;
    const cache = { version: 1, lastSuccessAt: previous?.lastSuccessAt ?? null, quota: previous?.quota ?? null,
      auth: localAuth, endpoint, consoleFallback, invalidatedAt: previous?.invalidatedAt ?? this.at(),
      error: { category, reason, at: this.at(), httpStatus: Number.isInteger(response?.httpStatus) ? response.httpStatus : null,
        queryFailureReason: failureCode(response?.queryFailureReason, response?.reason, response?.auth?.reason)
          ?? (response?.ok === true && !responseBindingValid ? 'credential_mismatch' : response?.timeout === true ? 'timeout' : null),
        timeout: response?.timeout === true }, nextRetryAt: new Date(this.now() + retrySeconds * 1000).toISOString() };
    await atomicJson(this.file('usage-cache.json'), cache);
    await this.event({ type: 'usage_unavailable', category, reason, retryAt: cache.nextRetryAt, httpStatus: cache.error.httpStatus });
    return this.view(cache, cfg);
  }

  async knownModel(model) {
    if (!modelId(model)) return false;
    const catalog = await readJson(path.join(this.stateDir, 'models.json'), null);
    return Array.isArray(catalog?.models) && catalog.models.includes(model);
  }

  async decision(model, usage, { overrideToken, taskId } = {}) {
    const base = { allowed: false, level: 'unknown', reason: 'quota_unknown', maxPercent: null,
      queryFailureReason: usage?.queryFailureReason ?? null,
      preferLowCost: false, pauseAll: true, windows: usage?.quota?.windows ?? [], overrideUsed: false };
    if (!await this.knownModel(model)) return { ...base, reason: 'unknown_model_coverage' };
    if (!usage?.fresh || !usage?.quota?.reliable || usage.quota.coverage?.verified !== true) {
      return { ...base, reason: usage?.category && usage.category !== 'ok' && usage.category !== 'schema' ? usage.category : 'quota_unknown' };
    }
    const quota = usage.quota;
    const manualBalanceOff = (await this.config()).full.billingGuard?.useBalanceDisabledConfirmed === true;
    if (quota.useBalance === true || (quota.useBalance === null && !manualBalanceOff)) {
      return { ...base, level: 'blocked', reason: quota.useBalance === true ? 'use_balance_enabled' : 'use_balance_unknown',
        queryFailureReason: quota.useBalance === null ? 'not_exposed' : null };
    }
    const maxPercent = Math.max(...quota.windows.map(window => window.percent));
    const decision = { ...base, maxPercent, level: 'allow', pauseAll: false,
      useBalanceSource: quota.useBalance === null ? 'human_attestation' : 'official_api' };
    if (maxPercent >= 100 || quota.windows.some(window => window.status === 'rate-limited')) return { ...decision, level: 'blocked', reason: 'quota_100', pauseAll: true };
    if (maxPercent >= 95) {
      const permits = await readJson(this.file('overrides.json'), []);
      const permit = tokenValid(overrideToken) ? permits.find(item => item.token === overrideToken && item.model === model
        && item.taskId === taskId && item.remainingUses === 1 && Date.parse(item.expiresAt) > this.now()) : null;
      return permit ? { ...decision, allowed: true, level: 'warn', reason: 'quota_95_override', preferLowCost: true, overrideUsed: true }
        : { ...decision, level: 'blocked', reason: 'quota_95', preferLowCost: true, pauseAll: true };
    }
    return { ...decision, allowed: true, level: maxPercent >= 80 ? 'warn' : 'allow',
      reason: maxPercent >= 80 ? 'quota_80' : 'quota_available', preferLowCost: maxPercent >= 80 };
  }

  async evaluate(model, options = {}) { return this.decision(model, await this.usage(), options); }

  async deferred({ taskId, model, priority }, reason, usage, decision) {
    const queue = await readJson(this.file('queue.json'), []);
    const item = { taskId, model, priority: ['low', 'normal', 'high'].includes(priority) ? priority : 'normal',
      reason, deferredAt: this.at(), source: 'quota admission controller' };
    const updated = [...queue.filter(previous => previous.taskId !== taskId), item];
    await atomicJson(this.file('queue.json'), updated);
    await this.event({ type: 'task_deferred', taskId, model, reason });
    return { allowed: false, status: 'deferred', reason, decision, usage, lease: null };
  }

  async reserve({ model, taskId, overrideToken, priority = 'normal' }) {
    if (!taskIdValid(taskId) || !modelId(model)) throw new Error('quota reservation requires a valid exact taskId and Go model');
    priority = ['low', 'normal', 'high'].includes(priority) ? priority : 'normal';
    return this.locked(async () => {
      const cfg = await this.config();
      const stored = await readJson(this.file('leases.json'), []);
      // An expired timestamp cannot prove a live owner's model call stopped.
      // After a lost owner, hold the slot for its effective timeout as well.
      const active = stored.filter(lease => leaseHeld(lease, this.now()));
      if (active.length !== stored.length) {
        await atomicJson(this.file('leases.json'), active);
        const cache = await this.cache();
        if (cache) { cache.invalidatedAt = this.at(); await atomicJson(this.file('usage-cache.json'), cache); }
        await this.event({ type: 'stale_leases_removed', count: stored.length - active.length });
      }
      if (active.length >= cfg.maxConcurrent) return this.deferred({ taskId, model, priority }, 'busy', this.view(await this.cache(), cfg), null);
      const usage = await this.usageUnlocked(cfg, true, true);
      const decision = await this.decision(model, usage, { overrideToken, taskId });
      if (!decision.allowed) return this.deferred({ taskId, model, priority }, decision.reason, usage, decision);
      if (decision.overrideUsed) {
        const permits = await readJson(this.file('overrides.json'), []);
        const permit = permits.find(item => item.token === overrideToken);
        if (!permit || permit.remainingUses !== 1) return this.deferred({ taskId, model, priority }, 'quota_95', usage, decision);
        permit.remainingUses = 0; permit.usedAt = this.at();
        await atomicJson(this.file('overrides.json'), permits);
      }
      const lease = { id: randomUUID(), model, taskId, pid: process.pid, createdAt: this.at(),
        expiresAt: new Date(this.now() + cfg.leaseMs).toISOString(), priority,
        overrideUsed: decision.overrideUsed };
      const cache = await this.cache();
      if (cache) { cache.invalidatedAt = this.at(); await atomicJson(this.file('usage-cache.json'), cache); }
      await atomicJson(this.file('leases.json'), [...active, lease]);
      const queue = await readJson(this.file('queue.json'), []);
      await atomicJson(this.file('queue.json'), queue.filter(item => item.taskId !== taskId));
      await this.event({ type: 'lease_reserved', leaseId: lease.id, taskId, model, maxPercent: decision.maxPercent, overrideUsed: decision.overrideUsed });
      return { allowed: true, status: 'reserved', reason: decision.reason, lease, decision, usage };
    });
  }

  async renew(leaseId) {
    if (!tokenValid(leaseId)) throw new Error('invalid lease ID');
    return this.locked(async () => {
      const leases = await readJson(this.file('leases.json'), []);
      const lease = leases.find(item => item.id === leaseId && item.pid === process.pid && Date.parse(item.expiresAt) > this.now());
      if (!lease) return { renewed: false, reason: 'lease_expired' };
      lease.expiresAt = new Date(this.now() + (await this.config()).leaseMs).toISOString();
      await atomicJson(this.file('leases.json'), leases);
      return { renewed: true, lease };
    });
  }

  /** Bind the actual native child before its prompt is sent, so an orphan holds its slot. */
  async bindWorker(leaseId, workerPid) {
    if (!tokenValid(leaseId) || !Number.isInteger(workerPid) || workerPid < 1) throw new Error('invalid lease ID or worker PID');
    return this.locked(async () => {
      const leases = await readJson(this.file('leases.json'), []);
      const lease = leases.find(item => item.id === leaseId && item.pid === process.pid);
      if (!lease) return { bound: false, reason: 'lease_not_owned' };
      if (Date.parse(lease.expiresAt) <= this.now()) return { bound: false, reason: 'lease_expired' };
      if (lease.workerPid && lease.workerPid !== workerPid && pidAlive(lease.workerPid)) return { bound: false, reason: 'worker_already_bound' };
      lease.workerPid = workerPid; lease.workerStartedAt = this.at();
      await atomicJson(this.file('leases.json'), leases);
      await this.event({ type: 'lease_worker_bound', leaseId, taskId: lease.taskId, workerPid });
      return { bound: true, lease };
    });
  }

  async release(leaseId, { outcome = 'completed', category } = {}) {
    if (!tokenValid(leaseId)) throw new Error('invalid lease ID');
    return this.locked(async () => {
      const leases = await readJson(this.file('leases.json'), []);
      const lease = leases.find(item => item.id === leaseId && item.pid === process.pid);
      if (!lease) return { released: false, reason: 'lease_not_owned' };
      if (pidAlive(lease.workerPid)) return { released: false, reason: 'worker_still_active' };
      await atomicJson(this.file('leases.json'), leases.filter(item => item.id !== leaseId));
      const cache = await this.cache();
      if (cache) {
        cache.invalidatedAt = this.at();
        if (CATEGORIES.has(category) && category !== 'ok') {
          cache.error = { category, reason: category === 'schema' ? 'quota_unknown' : category, at: this.at() };
          cache.nextRetryAt = new Date(this.now() + (category === 'authorization' ? 300 : category === 'network' ? 30 : 60) * 1000).toISOString();
        }
        await atomicJson(this.file('usage-cache.json'), cache);
      }
      await this.event({ type: 'lease_released', leaseId, taskId: lease.taskId, outcome: safeText(outcome), category: CATEGORIES.has(category) ? category : null });
      return { released: true, usageInvalidated: true };
    });
  }

  /** CLI-only. Do not expose this method or its token via an MCP authorization tool. */
  async createOverride({ model, taskId, source, ttlSeconds = 600, maxUses = 1 }) {
    if (!modelId(model) || !taskIdValid(taskId) || typeof source !== 'string' || source.trim().length < 12 || maxUses !== 1
      || !Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 600) throw new Error('one-task override requires exact model/taskId, explicit user authorization source, maxUses=1, ttl<=600s');
    if (!await this.knownModel(model)) throw new Error('unknown_model_coverage');
    return this.locked(async () => {
      const permits = await readJson(this.file('overrides.json'), []);
      const permit = { token: randomUUID(), model, taskId, source: safeText(source), createdAt: this.at(),
        expiresAt: new Date(this.now() + ttlSeconds * 1000).toISOString(), remainingUses: 1 };
      await atomicJson(this.file('overrides.json'), [...permits.filter(p => Date.parse(p.expiresAt) > this.now()), permit]);
      await this.event({ type: 'manual_one_task_override', model, taskId, source: permit.source, expiresAt: permit.expiresAt });
      return permit;
    });
  }

  async queue() { return readJson(this.file('queue.json'), []); }

  /** This only retries admission for the exact queue ID; it never executes code. */
  async resume(taskId, options = {}) {
    if (!taskIdValid(taskId)) throw new Error('invalid exact taskId');
    const item = (await this.queue()).find(entry => entry.taskId === taskId);
    if (!item) return { allowed: false, status: 'deferred', reason: 'queue_task_missing', lease: null };
    return this.reserve({ ...item, taskId, overrideToken: options.overrideToken });
  }
}
