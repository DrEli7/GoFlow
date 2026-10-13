/** Real MCP protocol/stdio; all quota/provider data are SIMULATED. No secret transport. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHandler} from '../src/server.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function mockFlow(){
  const calls=[];
  return {calls,status:async()=>({version:'1.1.0',channel:'opencode-go',quota:{fresh:false},inferenceAllowed:false}),
    models:async()=>({models:['opencode-go/SIMULATED-model']}),
    route:async request=>({executor:request.risk==='high'?'gpt':'go',channel:'opencode-go'}),
    submit:async()=>({status:'queued',channel:'opencode-go'}),task:async taskId=>({taskId,status:'queued'}),
    accept:async taskId=>({taskId,status:'accepted'}),setMode:async mode=>({mode}),
    usage:async args=>{calls.push({type:'usage',...args});return {channel:'opencode-go',SIMULATED:true,quota:{maxPercent:95}};},
    queue:async()=>({channel:'opencode-go',tasks:[{taskId:'SIMULATED-EXACT-ID',status:'queued'}]}),
    resume:async(taskId,args)=>{calls.push({type:'resume',taskId,...args});return {channel:'opencode-go',taskId,status:'queued'};}};
}

test('MCP 1.1 schemas expose shared usage/queue/exact resume without permit or credentials',async()=>{
  const flow=mockFlow(),responses=[];
  const handle=createHandler(flow,response=>responses.push(response));
  const call=async(method,params={})=>{await handle({jsonrpc:'2.0',id:responses.length+1,method,params});return responses.at(-1);};
  assert.equal((await call('initialize')).result.serverInfo.version,'1.1.0');
  const tools=(await call('tools/list')).result.tools;
  assert.equal(tools.length,10);
  for(const name of ['goflow_usage','goflow_queue','goflow_resume'])assert.ok(tools.some(tool=>tool.name===name));
  assert.equal(tools.some(tool=>/allow.once|override|permit|billing.*confirm/i.test(tool.name)),false);
  for(const tool of tools)assert.equal(Object.keys(tool.inputSchema.properties).some(key=>/secret|bearer|api.?key|url|endpoint/i.test(key)),false);
  for(const args of [{force:'true'},{force:1},{force:null},{force:[]},{force:true,apiKey:'SIMULATED-NOT-A-CREDENTIAL'},{endpoint:'https://example.invalid'}]){
    const invalid=await call('tools/call',{name:'goflow_usage',arguments:args});assert.equal(invalid.result.isError,true);
  }
  assert.equal(flow.calls.length,0);
  const usage=await call('tools/call',{name:'goflow_usage',arguments:{force:true}});
  assert.equal(JSON.parse(usage.result.content[0].text).channel,'opencode-go');
  assert.deepEqual(flow.calls,[{type:'usage',force:true}]);
  const resumed=await call('tools/call',{name:'goflow_resume',arguments:{taskId:'SIMULATED-EXACT-ID'}});
  assert.equal(JSON.parse(resumed.result.content[0].text).taskId,'SIMULATED-EXACT-ID');
  assert.equal(flow.calls.at(-1).taskId,'SIMULATED-EXACT-ID');
});

test('real stdio MCP initialize, queued usage and invalid boolean with SIMULATED dependencies',async t=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'goflow-mcp-test-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(temporary)).toLowerCase(),path.resolve(os.tmpdir()).toLowerCase());assert.ok(path.basename(temporary).startsWith('goflow-mcp-test-'));fs.rmSync(temporary,{recursive:true,force:true});});
  const launcher=path.join(temporary,'mock-launcher.mjs');
  fs.writeFileSync(launcher,`import {startStdio} from ${JSON.stringify(pathToFileURL(path.join(root,'src/server.mjs')).href)};
    const flow={status:async()=>({channel:'opencode-go',inferenceAllowed:false,quota:{fresh:false}}),route:async()=>({executor:'gpt'}),setMode:async mode=>({mode}),usage:async({force})=>({channel:'opencode-go',SIMULATED:true,force,quota:{maxPercent:95}}),queue:async()=>({channel:'opencode-go',tasks:[]}),resume:async taskId=>({taskId,status:'queued'})};startStdio(flow);`,'utf8');
  const child=spawn(process.execPath,[launcher],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const pending=new Map();let seq=0;
  const lines=readline.createInterface({input:child.stdout});
  lines.on('line',line=>{const message=JSON.parse(line);const handler=pending.get(message.id);if(handler){pending.delete(message.id);handler(message);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('MCP response timeout'));},5000);pending.set(id,message=>{clearTimeout(timer);resolve(message);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  try{
    assert.equal((await call('initialize')).result.serverInfo.version,'1.1.0');
    assert.equal((await call('tools/list')).result.tools.length,10);
    const status=await call('tools/call',{name:'goflow_status',arguments:{}});assert.equal(JSON.parse(status.result.content[0].text).inferenceAllowed,false);
    assert.equal((await call('tools/call',{name:'goflow_usage',arguments:{force:'not-boolean'}})).result.isError,true);
    const usage=await call('tools/call',{name:'goflow_usage',arguments:{force:true}});assert.deepEqual(JSON.parse(usage.result.content[0].text),{channel:'opencode-go',SIMULATED:true,force:true,quota:{maxPercent:95}});
    const high=await call('tools/call',{name:'goflow_route',arguments:{task:'Production authentication',risk:'high',complexity:'high',mode:'go'}});assert.equal(JSON.parse(high.result.content[0].text).executor,'gpt');
  }finally{lines.close();child.stdin.end();child.kill();}
});
