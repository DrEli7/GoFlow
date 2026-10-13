import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { QuotaManager } from '../src/quota.mjs';

const [action = 'disable', requestedRoot] = process.argv.slice(2);
if (process.platform !== 'win32' || !['preflight', 'register', 'disable', 'enable', 'rollback'].includes(action)) {
  throw new Error('Windows only; action must be preflight, register, disable, enable or rollback.');
}
const codexRoot = path.resolve(requestedRoot ?? path.join(process.env.USERPROFILE ?? os.homedir(), '.codex'));
if (!/^[A-Za-z]:[\\/]/.test(codexRoot)) throw new Error('Codex root must be an absolute local Windows path.');
const runtime = path.join(codexRoot, 'goflow');
const skill = path.join(codexRoot, 'skills/goflow');
const owner = 'GoFlow public export v1.1';
const configPath = path.join(codexRoot, 'config.toml');
const agentsPath = path.join(codexRoot, 'AGENTS.md');
const configBegin = '# GOFLOW PUBLIC MCP BEGIN v1.1';
const configEnd = '# GOFLOW PUBLIC MCP END v1.1';
const rulesBegin = '<!-- GOFLOW PUBLIC RULES BEGIN v1.1 -->';
const rulesEnd = '<!-- GOFLOW PUBLIC RULES END v1.1 -->';

function regular(filename) {
  for (let current = path.resolve(filename);;) {
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw new Error('Linked control path refused.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function owned(directory, required = false) {
  regular(directory);
  if (!fs.existsSync(directory)) {
    if (required) throw new Error('Owned GoFlow runtime is missing; install first.');
    return false;
  }
  const marker = path.join(directory, '.goflow-owned');
  regular(marker);
  if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8').trim() !== owner) throw new Error('Unowned directory; existing files preserved.');
  return true;
}
function read(filename) { regular(filename); return fs.existsSync(filename) ? fs.readFileSync(filename) : Buffer.alloc(0); }
function region(buffer, begin, end) {
  const beginBytes = Buffer.from(begin), endBytes = Buffer.from(end);
  const raw = buffer.indexOf(beginBytes), rawEnd = buffer.indexOf(endBytes);
  if (raw < 0 && rawEnd < 0) return null;
  if (raw < 1 || buffer[raw - 1] !== 10 || rawEnd < raw || buffer.indexOf(beginBytes, raw + beginBytes.length) >= 0 || buffer.indexOf(endBytes, rawEnd + endBytes.length) >= 0) {
    throw new Error('Malformed or duplicate owned block; original bytes preserved.');
  }
  let finish = rawEnd + endBytes.length;
  if (buffer[finish] === 13 && buffer[finish + 1] === 10) finish += 2;
  else if (buffer[finish] === 10) finish++;
  else throw new Error('Owned block missing its terminal newline; original preserved.');
  return { start: raw - 1, end: finish };
}
const without = (buffer, location) => location ? Buffer.concat([buffer.subarray(0, location.start), buffer.subarray(location.end)]) : buffer;
const replace = (buffer, location, block) => location ? Buffer.concat([buffer.subarray(0, location.start), Buffer.from(block), buffer.subarray(location.end)]) : Buffer.concat([buffer, Buffer.from(block)]);
function plans() {
  const config = read(configPath), agents = read(agentsPath);
  try { new TextDecoder('utf-8', { fatal: true }).decode(config); new TextDecoder('utf-8', { fatal: true }).decode(agents); }
  catch { throw new Error('Codex configuration and rules must be UTF-8; originals preserved.'); }
  const configRegion = region(config, configBegin, configEnd), rulesRegion = region(agents, rulesBegin, rulesEnd);
  const outside = without(config, configRegion).toString('utf8');
  if (/^\s*\[\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\s*\.\s*(?:goflow|"goflow"|'goflow')(?:\s*\]|\s*\.)/m.test(outside)
    || /^\s*(?:goflow|"goflow"|'goflow')\s*(?:=|\.)/m.test(outside)) throw new Error('Existing goflow MCP registration is not owned by this export; preserved.');
  return { config, agents, configRegion, rulesRegion };
}
function assertIdle() {
  const filename = path.join(runtime, 'state/quota/leases.json');
  const bytes = read(filename);
  if (!bytes.length) return;
  const leases = JSON.parse(bytes.toString('utf8'));
  const alive = pid => { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
  if (!Array.isArray(leases) || leases.some(entry => !entry || typeof entry !== 'object' || !Number.isFinite(Date.parse(entry.expiresAt)) || alive(entry.pid) || alive(entry.workerPid) || Date.parse(entry.expiresAt) > Date.now())) {
    throw new Error('Active, unexpired or invalid Go lease; finish tasks before maintenance.');
  }
}
const exists = owned(runtime, action !== 'preflight');
regular(path.join(runtime, 'runtime-config.json'));
owned(skill);
plans();
async function perform() {
  if (action === 'preflight') { assertIdle(); return; }
  const { config, agents, configRegion, rulesRegion } = plans();
  if (action === 'register') {
    assertIdle();
    const settings = JSON.parse(read(path.join(runtime, 'runtime-config.json')).toString('utf8'));
    if (typeof settings.nodeExe !== 'string' || !/^[A-Za-z]:[\\/].*\.exe$/i.test(settings.nodeExe)) throw new Error('Native Node path required.');
    const literal = value => {
      if (/[\r\n\0]/.test(value)) throw new Error('Unsupported character in TOML executable path.');
      return JSON.stringify(value);
    };
    const server = path.join(runtime, 'src/server.mjs');
    regular(server);
    const mcpBlock = `\n${configBegin}\n[mcp_servers.goflow]\ncommand = ${literal(settings.nodeExe)}\nargs = [${literal(server)}]\nenabled = true\nstartup_timeout_sec = 20\ntool_timeout_sec = 900\n${configEnd}\n`;
    const fragment = read(path.join(runtime, 'AGENTS.fragment.md')).toString('utf8').trimEnd();
    if (!fragment.includes('GOFLOW BEGIN v1') || !fragment.includes('GOFLOW QUOTA BEGIN v1.1')) throw new Error('Global rules fragment incomplete.');
    const rulesBlock = `\n${rulesBegin}\n${fragment}\n${rulesEnd}\n`;
    const skillBytes = read(path.join(runtime, 'skills/goflow/SKILL.md'));
    regular(path.join(skill, 'SKILL.md'));
    fs.mkdirSync(codexRoot, { recursive: true });
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, '.goflow-owned'), owner + '\n');
    fs.writeFileSync(path.join(skill, 'SKILL.md'), skillBytes);
    fs.writeFileSync(configPath, replace(config, configRegion, mcpBlock));
    fs.writeFileSync(agentsPath, replace(agents, rulesRegion, rulesBlock));
  } else if (action === 'rollback') {
    assertIdle();
    const configResult = without(config, configRegion), agentsResult = without(agents, rulesRegion);
    if (fs.existsSync(skill)) {
      owned(skill, true);
      const archive = path.join(runtime, `disabled-skill-${Date.now()}`);
      regular(archive);
      if (fs.existsSync(archive)) throw new Error('Skill archive collision; retry later.');
      fs.renameSync(skill, archive);
    }
    if (configRegion) fs.writeFileSync(configPath, configResult);
    if (rulesRegion) fs.writeFileSync(agentsPath, agentsResult);
  } else {
    if (!configRegion) throw new Error('Owned MCP registration missing; install first.');
    const block = config.subarray(configRegion.start, configRegion.end).toString('utf8');
    if (!/^enabled = (?:true|false)$/m.test(block)) throw new Error('Owned enabled setting missing.');
    const changed = block.replace(/^enabled = (?:true|false)$/m, `enabled = ${action === 'enable'}`);
    fs.writeFileSync(configPath, replace(config, configRegion, changed));
  }
}
if (exists) {
  for (const filename of ['leases.json', 'quota.lock', 'quota-recovery.lock']) regular(path.join(runtime, 'state/quota', filename));
  const quota = new QuotaManager({ stateDir: path.join(runtime, 'state'), runtimeConfigPath: path.join(runtime, 'runtime-config.json') });
  await quota.locked(perform);
} else await perform();
console.log(JSON.stringify({ action, completed: true, runtimeAndStatePreserved: true, credentialStoresModified: false, needsNewSession: action !== 'preflight' }));
