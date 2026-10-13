/** Guarded fallback to the enabled, registered user GoFlow MCP. No alternative executables or credential operations. */
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

export const ALLOWED_TOOLS = Object.freeze(['goflow_status','goflow_models','goflow_route','goflow_submit','goflow_task',
  'goflow_accept','goflow_set_mode','goflow_usage','goflow_queue','goflow_resume']);
export const MAX_INPUT_BYTES = 512_000;
const MAX_OUTPUT_BYTES = 4_000_000;
const PLUGIN_ID = 'goflow@goflow-local';
const EXIT = { INPUT:2, CONFIG:3, DISABLED:4, TRANSPORT:5, TIMEOUT:6, SERVER:7 };
export class ClientError extends Error {
  constructor(code,message,exitCode) { super(message);this.name='GoFlowClientError';this.code=code;this.exitCode=exitCode; }
}
const fail=(code,message,exitCode=EXIT.CONFIG)=>{throw new ClientError(code,message,exitCode);};
const inputFail=()=>fail('INVALID_INPUT','Arguments must be a JSON object matching the selected GoFlow tool.',EXIT.INPUT);
const normalizedPath=value=>path.resolve(value).replaceAll('\\','/').toLowerCase();

function splitOutside(value,delimiter) {
  let quote=null,escaped=false,depth=0,start=0;const parts=[];
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if(quote){if(quote==='"'&&escaped){escaped=false;continue;}if(quote==='"'&&c==='\\'){escaped=true;continue;}if(c===quote)quote=null;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='['||c==='{')depth++;if(c===']'||c==='}')depth--;
    if(c===delimiter&&depth===0){parts.push(value.slice(start,i));start=i+1;}
  }
  if(quote||depth!==0)fail('CONFIG_FORMAT','GoFlow registration contains an unsupported or incomplete TOML value.');
  parts.push(value.slice(start));return parts;
}
function withoutComment(value) {
  let quote=null,escaped=false;
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if(quote){if(quote==='"'&&escaped){escaped=false;continue;}if(quote==='"'&&c==='\\'){escaped=true;continue;}if(c===quote)quote=null;continue;}
    if(c==='"'||c==="'")quote=c;else if(c==='#')return value.slice(0,i);
  }
  return value;
}
function stringValue(value) {
  value=value.trim();
  if(value.startsWith("'")&&value.endsWith("'")&&!value.slice(1,-1).includes("'"))return value.slice(1,-1);
  if(value.startsWith('"')&&value.endsWith('"')){try{const parsed=JSON.parse(value);if(typeof parsed==='string')return parsed;}catch{}}
  fail('CONFIG_FORMAT','GoFlow registration uses an unsupported TOML string.');
}
function tomlValue(value) {
  value=value.trim();
  if(value==='true'||value==='false')return value==='true';
  if(/^\d+(?:\.\d+)?$/.test(value))return Number(value);
  if(value.startsWith('[')&&value.endsWith(']')){
    const inner=value.slice(1,-1).trim();if(!inner)return [];
    return splitOutside(inner,',').filter(part=>part.trim()).map(part=>stringValue(part));
  }
  return stringValue(value);
}
function headerParts(line) {
  if(!line.startsWith('[')||!line.endsWith(']')||line.startsWith('[['))return null;
  return splitOutside(line.slice(1,-1),'.').map(part=>{
    part=part.trim();return part.startsWith('"')||part.startsWith("'")?stringValue(part):part;
  });
}

/** Own-section parser; it never returns unrelated configuration values. Unsupported GoFlow syntax fails closed. */
export function parseOwnSections(toml) {
  if(typeof toml!=='string'||Buffer.byteLength(toml)>1_000_000)fail('CONFIG_FORMAT','Codex configuration is missing or exceeds the supported size.');
  const registration={},plugin={};let section=[],seen=false;
  const lines=toml.replace(/^\uFEFF/,'').split(/\r?\n/);
  for(let i=0;i<lines.length;i++){
    let line=withoutComment(lines[i]).trim();if(!line)continue;
    if(line.startsWith('[')){
      if(line.startsWith('[[')&&line.endsWith(']]')){if(/mcp_servers.*goflow/.test(line))fail('CONFIG_FORMAT','GoFlow registration must be a table.');section=[];continue;}
      section=headerParts(line);if(!section)fail('CONFIG_FORMAT','Codex configuration contains an incomplete table header.');
      if(section[0]==='mcp_servers'&&section[1]==='goflow'){
        if(section.length!==2)fail('CONFIG_OVERRIDE','GoFlow environment or nested transport overrides are unsupported.');
        if(seen)fail('CONFIG_DUPLICATE','Duplicate GoFlow registration is not allowed.');seen=true;
      }
      continue;
    }
    const own=section.length===2&&section[0]==='mcp_servers'&&section[1]==='goflow';
    const ownPlugin=section.length===2&&section[0]==='plugins'&&section[1]===PLUGIN_ID;
    const pluginParent=section.length===1&&section[0]==='plugins';
    if(!own&&!ownPlugin&&!pluginParent)continue;
    const equals=line.indexOf('=');if(equals<0)fail('CONFIG_FORMAT','GoFlow configuration contains an invalid assignment.');
    const key=line.slice(0,equals).trim();let value=line.slice(equals+1).trim();
    if(pluginParent){
      let pieces;try{pieces=splitOutside(key,'.').map(p=>p.trim().startsWith('"')||p.trim().startsWith("'")?stringValue(p):p.trim());}catch{continue;}
      if(pieces[0]!==PLUGIN_ID)continue;
      if(pieces.length===2&&pieces[1]==='enabled'){if(Object.hasOwn(plugin,'enabled'))fail('CONFIG_DUPLICATE','Duplicate GoFlow plugin enable flag.');plugin.enabled=tomlValue(value);continue;}
      if(pieces.length===1){const inline=value.match(/^\{\s*enabled\s*=\s*(true|false)\s*\}$/);if(!inline)fail('PLUGIN_FORMAT','GoFlow plugin enable state could not be verified.');if(Object.hasOwn(plugin,'enabled'))fail('CONFIG_DUPLICATE','Duplicate GoFlow plugin enable flag.');plugin.enabled=inline[1]==='true';continue;}
      fail('PLUGIN_FORMAT','GoFlow plugin enable state could not be verified.');
    }
    if(ownPlugin){if(key==='enabled'){if(Object.hasOwn(plugin,key))fail('CONFIG_DUPLICATE','Duplicate GoFlow plugin enable flag.');plugin.enabled=tomlValue(value);}continue;}
    if(['env','env_vars','cwd','url','bearer_token_env_var','http_headers'].includes(key))fail('CONFIG_OVERRIDE','GoFlow transport overrides are unsupported by this fallback.');
    if(!['enabled','command','args','startup_timeout_sec','tool_timeout_sec','enabled_tools','disabled_tools','required'].includes(key))fail('CONFIG_FORMAT','GoFlow registration has an unsupported field.');
    if(Object.hasOwn(registration,key))fail('CONFIG_DUPLICATE','Duplicate GoFlow registration field.');
    if(value.startsWith('[')){
      while(true){try{splitOutside(value,',');break;}catch(error){if(i+1>=lines.length)throw error;value+='\n'+withoutComment(lines[++i]).trim();}}
    }
    registration[key]=tomlValue(value);
  }
  return {found:seen,registration,plugin};
}

/** Pure validation helper for meaningful configuration fixtures. CLI paths are never supplied by argv or tool args. */
export function validateRegistration(own,{home,nodeExe},tool) {
  if(!ALLOWED_TOOLS.includes(tool))fail('TOOL_NOT_ALLOWED','Only the ten guarded GoFlow MCP tools are allowed.',EXIT.INPUT);
  if(!own.found)fail('SERVICE_MISSING','The user-level GoFlow MCP registration is missing.');
  const registration=own.registration;
  if(registration.enabled===false)fail('SERVICE_DISABLED','The user-level GoFlow MCP service is disabled.',EXIT.DISABLED);
  if(registration.enabled!==undefined&&registration.enabled!==true)fail('CONFIG_FORMAT','GoFlow enabled must be a boolean.');
  if(own.plugin.enabled===false)fail('PLUGIN_DISABLED','The GoFlow plugin is explicitly disabled.',EXIT.DISABLED);
  if(own.plugin.enabled!==undefined&&own.plugin.enabled!==true)fail('PLUGIN_FORMAT','GoFlow plugin enabled must be a boolean.');
  if(typeof nodeExe!=='string'||!path.isAbsolute(nodeExe)||!/^(?:node|node\.exe)$/i.test(path.basename(nodeExe))||(/\.(?:cmd|bat|ps1)$/i.test(nodeExe))
    ||(process.platform==='win32'&&!/\.exe$/i.test(nodeExe)))fail('RUNTIME_PATH','The installed GoFlow Node path is invalid.');
  const server=path.join(home,'.codex','goflow','src','server.mjs');
  if(typeof registration.command!=='string'||!path.isAbsolute(registration.command)||normalizedPath(registration.command)!==normalizedPath(nodeExe)
    ||!Array.isArray(registration.args)||registration.args.length!==1||typeof registration.args[0]!=='string'
    ||!path.isAbsolute(registration.args[0])||normalizedPath(registration.args[0])!==normalizedPath(server))fail('COMMAND_MISMATCH','The registered command must match the installed GoFlow Node and server paths exactly.');
  for(const field of ['enabled_tools','disabled_tools'])if(registration[field]!==undefined&&(!Array.isArray(registration[field])||registration[field].some(item=>typeof item!=='string')))
    fail('CONFIG_FORMAT','GoFlow tool filters must be arrays of strings.');
  if((registration.enabled_tools&&!registration.enabled_tools.includes(tool))||registration.disabled_tools?.includes(tool))
    fail('TOOL_DISABLED','This GoFlow tool is disabled in the user registration.',EXIT.DISABLED);
  return {command:nodeExe,args:[server],cwd:path.dirname(path.dirname(server)),startupTimeoutMs:20_000,
    toolTimeoutMs:['goflow_submit','goflow_resume'].includes(tool)?900_000:60_000};
}

async function projectGuards(tool,home) {
  const userConfig=path.join(home,'.codex','config.toml');
  let cursor=process.cwd();
  while(true){
    const directory=path.join(cursor,'.codex'),filename=path.join(directory,'config.toml');
    if(normalizedPath(filename)!==normalizedPath(userConfig)){
      try{
        const container=await fs.lstat(directory);if(container.isSymbolicLink())fail('PROJECT_CONFIG_UNSUPPORTED','A project Codex config directory is a link; the fallback refuses unverified overrides.');
        const st=await fs.lstat(filename);if(!st.isFile()||st.isSymbolicLink()||st.nlink>1||st.size>1_000_000)
          fail('PROJECT_CONFIG_UNSUPPORTED','A project Codex config file could not be verified safely.');
        const own=parseOwnSections(await fs.readFile(filename,'utf8'));
        if(own.plugin.enabled===false)fail('PLUGIN_DISABLED','GoFlow is disabled by an applicable project configuration.',EXIT.DISABLED);
        if(own.plugin.enabled!==undefined&&own.plugin.enabled!==true)fail('PLUGIN_FORMAT','The project GoFlow plugin enabled flag is invalid.');
        if(own.found){
          const registration=own.registration;
          if(registration.enabled===false)fail('SERVICE_DISABLED','GoFlow is disabled by an applicable project configuration.',EXIT.DISABLED);
          if(registration.enabled!==undefined&&registration.enabled!==true)fail('CONFIG_FORMAT','The project GoFlow enabled flag is invalid.');
          for(const field of ['enabled_tools','disabled_tools'])if(registration[field]!==undefined&&(!Array.isArray(registration[field])||registration[field].some(item=>typeof item!=='string')))
            fail('CONFIG_FORMAT','Project GoFlow tool filters must be arrays of strings.');
          if((registration.enabled_tools&&!registration.enabled_tools.includes(tool))||registration.disabled_tools?.includes(tool))
            fail('TOOL_DISABLED','The selected GoFlow tool is disabled by an applicable project configuration.',EXIT.DISABLED);
          if(Object.keys(registration).some(key=>!['enabled','enabled_tools','disabled_tools'].includes(key)))
            fail('PROJECT_OVERRIDE_UNSUPPORTED','The fallback refuses project GoFlow command or transport overrides.');
        }
      }catch(error){
        if(error instanceof ClientError)throw error;
        if(error.code!=='ENOENT')fail('PROJECT_CONFIG_UNAVAILABLE','An applicable project Codex configuration could not be read safely.');
      }
    }
    const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;
  }
}

async function loadRegistration(tool) {
  const home=os.homedir(),base=path.join(home,'.codex','goflow');let toml,runtime;
  if(process.env.CODEX_HOME&&normalizedPath(process.env.CODEX_HOME)!==normalizedPath(path.join(home,'.codex')))
    fail('CONFIG_HOME_UNSUPPORTED','A custom CODEX_HOME is active; the fallback refuses to use a different user registration.');
  await projectGuards(tool,home);
  try{
    toml=await fs.readFile(path.join(home,'.codex','config.toml'),'utf8');
    const filename=path.join(base,'runtime-config.json');if((await fs.stat(filename)).size>1_000_000)throw new Error();
    runtime=JSON.parse(await fs.readFile(filename,'utf8'));
  }catch{fail('CONFIG_UNAVAILABLE','The expected user GoFlow configuration could not be read safely.');}
  const result=validateRegistration(parseOwnSections(toml),{home,nodeExe:runtime?.nodeExe},tool);
  for(const target of [result.command,result.args[0]]){
    try{const st=await fs.lstat(target);if(!st.isFile()||st.isSymbolicLink())throw new Error();}catch{fail('INSTALLATION_MISSING','The expected installed GoFlow executable or server file is unavailable.');}
  }
  return result;
}

export async function readJsonInput(stream) {
  if(stream.isTTY)return {};
  const chunks=[];let bytes=0;
  for await(const chunk of stream){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=buffer.length;if(bytes>MAX_INPUT_BYTES)fail('INPUT_TOO_LARGE','GoFlow JSON input exceeds 512000 bytes.',EXIT.INPUT);chunks.push(buffer);}
  const input=Buffer.concat(chunks).toString('utf8').trim();if(!input)return {};
  let parsed;try{parsed=JSON.parse(input);}catch{inputFail();}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))inputFail();return parsed;
}
export function validateArguments(value,schema) {
  if(schema.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))inputFail();
    for(const required of schema.required??[])if(!Object.hasOwn(value,required))inputFail();
    for(const [key,item] of Object.entries(value)){if(!Object.hasOwn(schema.properties??{},key))inputFail();validateArguments(item,schema.properties[key]);}
  }else if(schema.type==='array'){
    if(!Array.isArray(value)||(schema.minItems&&value.length<schema.minItems))inputFail();for(const item of value)validateArguments(item,schema.items);
  }else if(schema.type==='number') {if(typeof value!=='number'||!Number.isFinite(value))inputFail();}
  else if(typeof value!==schema.type)inputFail();
  if(schema.enum&&!schema.enum.includes(value))inputFail();if(schema.minLength&&value.length<schema.minLength)inputFail();
}
export function sanitize(value) {
  if(typeof value==='string'){
    try{const decoded=JSON.parse(value);if(decoded&&typeof decoded==='object')return JSON.stringify(sanitize(decoded));}catch{}
    return value.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|(?:ghp|gho|github_pat)_[A-Za-z0-9_]{12,})\b/g,'[REDACTED]')
    .replace(/Bearer\s+[^\s"']+/gi,'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["']?\s*[=:]\s*)["']?[^\s,;}"']+/gi,'$1[REDACTED]')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]');
  }
  if(Array.isArray(value))return value.map(sanitize);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
    /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|bindingId)$/i.test(key)?'[REDACTED]':sanitize(item)]));
  return value;
}

/** RPC transport accepts an already created child; production spawn is confined to callGoflow. */
export class StdioMcpClient {
  constructor(child) {
    this.child=child;this.pending=new Map();this.sequence=0;this.outputBytes=0;this.closed=false;
    this.lines=readline.createInterface({input:child.stdout,crlfDelay:Infinity});
    child.stdout.on('data',chunk=>{this.outputBytes+=chunk.length;if(this.outputBytes>MAX_OUTPUT_BYTES)this.abort(new ClientError('OUTPUT_LIMIT','GoFlow MCP response exceeded the allowed size.',EXIT.TRANSPORT));});
    child.stderr.on('data',()=>{}); // Never forward raw server diagnostics or environment contents.
    child.on('error',()=>this.abort(new ClientError('SERVER_START','The registered GoFlow MCP server could not start.',EXIT.TRANSPORT)));
    child.on('close',()=>{if(!this.closed)this.abort(new ClientError('SERVER_CLOSED','The registered GoFlow MCP server closed unexpectedly.',EXIT.TRANSPORT));});
    this.lines.on('line',line=>{
      let response;try{response=JSON.parse(line);}catch{this.abort(new ClientError('PROTOCOL','GoFlow MCP emitted invalid JSON.',EXIT.TRANSPORT));return;}
      const entry=this.pending.get(response?.id);if(!entry)return;this.pending.delete(response.id);clearTimeout(entry.timer);entry.resolve(response);
    });
    child.stdin.on('error',()=>this.abort(new ClientError('STDIN_CLOSED','The GoFlow MCP request channel closed.',EXIT.TRANSPORT)));
  }
  call(method,params={},timeoutMs=60_000) {
    if(this.closed)return Promise.reject(new ClientError('SERVER_CLOSED','The GoFlow MCP client is closed.',EXIT.TRANSPORT));
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;const timer=setTimeout(()=>{this.pending.delete(id);reject(new ClientError('TIMEOUT','The guarded GoFlow MCP call timed out.',EXIT.TIMEOUT));this.close();},timeoutMs);
      this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    });
  }
  abort(error) {for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();this.close();}
  close() {if(this.closed)return;this.closed=true;
    for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(new ClientError('SERVER_CLOSED','The GoFlow MCP client closed.',EXIT.TRANSPORT));}this.pending.clear();
    this.lines.close();this.child.stdin.end();this.child.kill();}
}

export async function callGoflow(tool,args={}) {
  const registration=await loadRegistration(tool);
  const env={};for(const name of ['SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','HOME','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','XDG_DATA_HOME'])if(typeof process.env[name]==='string')env[name]=process.env[name];
  env.PATH=path.dirname(registration.command);
  const child=spawn(registration.command,registration.args,{cwd:registration.cwd,env,shell:false,detached:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const client=new StdioMcpClient(child);
  try{
    const initialized=await client.call('initialize',{protocolVersion:'2024-11-05',clientInfo:{name:'goflow-guarded-desktop-fallback',version:'1'},capabilities:{}},registration.startupTimeoutMs);
    if(initialized.error||initialized.result?.serverInfo?.name!=='goflow'||initialized.result?.protocolVersion!=='2024-11-05')
      fail('SERVER_IDENTITY','The registered service did not identify as the expected GoFlow MCP.',EXIT.TRANSPORT);
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const listing=await client.call('tools/list',{},registration.startupTimeoutMs);
    const definition=listing.result?.tools?.find(item=>item.name===tool);
    if(!definition?.inputSchema)fail('SCHEMA_UNAVAILABLE','The enabled GoFlow MCP did not provide the selected tool schema.',EXIT.TRANSPORT);
    validateArguments(args,definition.inputSchema);
    const response=await client.call('tools/call',{name:tool,arguments:args},registration.toolTimeoutMs);
    if(response.error)fail('MCP_ERROR','The enabled GoFlow MCP returned a protocol error.',EXIT.SERVER);
    return sanitize(response.result);
  }finally{client.close();}
}

async function main() {
  try{
    if(process.argv.length!==3||!ALLOWED_TOOLS.includes(process.argv[2]))fail('USAGE','Usage: node client.mjs <allowed-goflow-tool>; pass only its JSON arguments on stdin.',EXIT.INPUT);
    const result=await callGoflow(process.argv[2],await readJsonInput(process.stdin));
    process.stdout.write(JSON.stringify(result)+'\n');
    if(result?.isError){process.stderr.write('GOFLOW_SERVER_ERROR: The guarded MCP tool reported an error; inspect its sanitized response.\n');process.exitCode=EXIT.SERVER;}
  }catch(error){const safe=error instanceof ClientError?error:new ClientError('CLIENT_FAILURE','The GoFlow fallback failed safely.',EXIT.TRANSPORT);
    process.stderr.write(`${safe.code}: ${safe.message}\n`);process.exitCode=safe.exitCode;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
