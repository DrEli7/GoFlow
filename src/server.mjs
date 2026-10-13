import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoFlow } from './core.mjs';

const base = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const requestSchema = {
  type:'object', additionalProperties:false,
  properties:{ directory:{type:'string'}, task:{type:'string'}, files:{type:'array',items:{type:'string'}},
    editableFiles:{type:'array',items:{type:'string'}},
    tests:{type:'array',minItems:1,items:{type:'object',additionalProperties:false,properties:{command:{type:'string'},args:{type:'array',items:{type:'string'}}},required:['command','args']}},
    risk:{type:'string',enum:['low','high']}, complexity:{type:'string',enum:['simple','moderate','high']},
    mode:{type:'string',enum:['auto','gpt','go','off']}, priority:{type:'string',enum:['low','normal','high']} },
  required:['directory','task','files','editableFiles','tests','risk','complexity']
};
const routeSchema={type:'object',additionalProperties:false,properties:{task:{type:'string'},risk:{type:'string',enum:['low','high']},complexity:{type:'string',enum:['simple','moderate','high']},mode:{type:'string',enum:['auto','gpt','go','off']}},required:['task','risk','complexity']};
function toolDefinitions(flow) { return [
 ['goflow_status','Read current mode, billing guard, and local runtime status.',{type:'object',properties:{},additionalProperties:false},()=>flow.status(),true],
 ['goflow_models','Refresh real opencode-go model list; no inference.',{type:'object',properties:{},additionalProperties:false},()=>flow.models(),true],
 ['goflow_route','Classify a task; high risk/complexity stays with current GPT. No inference.',routeSchema,(a)=>flow.route(a),true],
 ['goflow_submit','Delegate bounded low risk work to Go in isolated snapshot. Requires billing confirmation. Tests run locally; successful output still needs GPT review. Never edits original project.',requestSchema,(a)=>flow.submit(a),false],
 ['goflow_task','Read saved task evidence and test results.',{type:'object',properties:{taskId:{type:'string'}},required:['taskId'],additionalProperties:false},(a)=>flow.task(a.taskId),true],
 ['goflow_accept','After GPT review, apply tested editable files only if originals have not changed. Reviewer must be GPT.',{type:'object',properties:{taskId:{type:'string'},reviewer:{type:'string',enum:['GPT']},reviewSummary:{type:'string',minLength:12}},required:['taskId','reviewer','reviewSummary'],additionalProperties:false},(a)=>flow.accept(a.taskId,a),false],
 ['goflow_set_mode','Persist auto/gpt/go/off on user request. Force Go still cannot bypass billing, safety, tests or review.',{type:'object',properties:{mode:{type:'string',enum:['auto','gpt','go','off']}},required:['mode'],additionalProperties:false},(a)=>flow.setMode(a.mode),false]
 ,['goflow_usage','Read OpenCode Go shared rolling/weekly/monthly usage. Cached for at most 60 seconds; force refresh is read-only. Does not authorize inference.',{type:'object',properties:{force:{type:'boolean'}},additionalProperties:false},(a)=>flow.usage(a),true]
 ,['goflow_queue','List queued exact task IDs and safe hold reasons. Quota/service failures do not automatically move ordinary work to GPT.',{type:'object',properties:{},additionalProperties:false},()=>flow.queue(),true]
 ,['goflow_resume','Retry the exact queued task ID after quota reset or a resolved hold. Rechecks current billing, quota, model and original hashes. No new task is created.',{type:'object',properties:{taskId:{type:'string'},mode:{type:'string',enum:['auto','gpt','go','off']}},required:['taskId'],additionalProperties:false},(a)=>flow.resume(a.taskId,{mode:a.mode}),false]
]; }
function validate(a,s){
  if(!a||typeof a!=='object'||Array.isArray(a))throw new Error('Arguments must be object');
  for(const k of s.required??[])if(!(k in a))throw new Error('Missing '+k);
  for(const [k,v] of Object.entries(a)){
    if(!Object.hasOwn(s.properties,k))throw new Error('Unknown argument '+k);
    const p=s.properties[k];
    if(p.type==='string'&&typeof v!=='string')throw new Error('Expected string '+k);
    if(p.type==='boolean'&&typeof v!=='boolean')throw new Error('Expected boolean '+k);
    if(p.type==='number'&&(typeof v!=='number'||!Number.isFinite(v)))throw new Error('Expected number '+k);
    if(p.type==='object')validate(v,p);
    if(p.enum&&!p.enum.includes(v))throw new Error('Invalid '+k);
    if(p.minLength&&v.length<p.minLength)throw new Error('Too short '+k);
    if(p.type==='array'){
      if(!Array.isArray(v)||(p.minItems&&v.length<p.minItems))throw new Error('Invalid array '+k);
      for(const item of v){if(p.items.type==='object')validate(item,p.items);else if(typeof item!==p.items.type)throw new Error('Invalid item '+k);}
    }
  }
}
export function createHandler(flow, output) {
  const definitions = toolDefinitions(flow);
  return async function handle(msg){
  if(!msg||typeof msg!=='object'||Array.isArray(msg))return;
  if(!('id' in msg))return;
  try{
    let result;
    if(msg.method==='initialize')result={protocolVersion:msg.params?.protocolVersion??'2024-11-05',capabilities:{tools:{listChanged:false}},serverInfo:{name:'goflow',version:'1.1.0'},instructions:'Codex GPT coordinates and reviews. Channel is opencode-go with shared quota. Billing guard fails closed. Quota, authorization and service failures queue ordinary tasks; current GPT handles genuine capability escalations. A 95-percent one-task permit requires explicit human authorization through the local CLI, never an MCP tool.'};
    else if(msg.method==='ping')result={};
    else if(msg.method==='tools/list')result={tools:definitions.map(([name,description,inputSchema,,readOnlyHint])=>({name,description,inputSchema,annotations:{readOnlyHint,destructiveHint:name==='goflow_accept',openWorldHint:name==='goflow_submit'}}))};
    else if(msg.method==='tools/call'){
      const tool=definitions.find(d=>d[0]===msg.params?.name);if(!tool)throw new Error('Unknown tool');
      const args=msg.params.arguments??{};validate(args,tool[2]);
      const value=await tool[3](args);result={content:[{type:'text',text:JSON.stringify(value)}]};
    }else{output({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}});return;}
    output({jsonrpc:'2.0',id:msg.id,result});
  }catch(error){output({jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:String(error.message)}]}});}
}; }
export function startStdio(flow, { input=process.stdin, output=process.stdout } = {}) {
  const write = value => output.write(JSON.stringify(value)+'\n');
  const handle = createHandler(flow, write);
  let queue=Promise.resolve();
  const lines = readline.createInterface({input,crlfDelay:Infinity});
  lines.on('line',line=>{
  let msg;try{msg=JSON.parse(line);}catch{write({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});return;}
  queue=queue.then(()=>handle(msg));
  });
  return lines;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  startStdio(new GoFlow({ stateDir:path.join(base,'state'), runtimeConfigPath:path.join(base,'runtime-config.json') }));
}
