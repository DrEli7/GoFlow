import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const helper=fileURLToPath(new URL('../scripts/secure_usage.py',import.meta.url));
export const USAGE_ENDPOINT='https://opencode.ai/zen/go/v1/usage';
async function helperCall(config={},options={},operation='query'){
  if(options.signal?.aborted)return {ok:false,category:'network',consoleFallback:true,httpStatus:null,endpoint:USAGE_ENDPOINT,fetchedAt:new Date().toISOString()};
  const executable=config.pythonExe??'';
  if(!path.isAbsolute(executable)||!/\.exe$/i.test(executable))return {ok:false,category:'service',consoleFallback:true,httpStatus:null,endpoint:USAGE_ENDPOINT,fetchedAt:new Date().toISOString()};
  const source=config.quota?.credentialSource==='windows-vault'?'windows-vault':'opencode';
  return new Promise(resolve=>{
    const env={};for(const name of ['SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','HOME','HOMEDRIVE','HOMEPATH','APPDATA','LOCALAPPDATA','XDG_DATA_HOME'])if(process.env[name])env[name]=process.env[name];
    env.PYTHONUTF8='1';env.PYTHONIOENCODING='utf-8';
    const child=spawn(executable,['-I','-S','-X','utf8',helper,operation,source],{env,shell:false,windowsHide:true,stdio:['ignore','pipe','ignore']});
    let stdout='',settled=false;
    const done=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
    const failed=()=>({ok:false,category:'network',httpStatus:null,consoleFallback:true,endpoint:USAGE_ENDPOINT,fetchedAt:new Date().toISOString()});
    const timer=setTimeout(()=>{child.kill();done(failed());},15000);
    options.signal?.addEventListener('abort',()=>{child.kill();done(failed());},{once:true});
    child.stdout.on('data',data=>{stdout+=data.toString('utf8');if(stdout.length>400000){child.kill();done({...failed(),category:'schema'});}});
    child.on('error',()=>done(failed()));
    child.on('close',code=>{if(code!==0){done(failed());return;}try{
      const value=JSON.parse(stdout);if(operation==='query'&&value.endpoint!==USAGE_ENDPOINT)throw new Error();
      // These shared windows are verified in public Go quota accounting source.
      // Do not manufacture independent model balances or infer Use balance.
      if(value.ok&&value.httpStatus===200&&!value.schemaExtrasPresent&&value.auth?.inferenceCredentialMatches===true&&value.body?.usage&&['rolling','weekly','monthly'].every(k=>value.body.usage[k]&&Object.hasOwn(value.body.usage[k],'percent')&&Object.hasOwn(value.body.usage[k],'resetsAt'))){
        value.verifiedCoverage={verified:true,scope:'account',provider:'opencode-go',sourceSchema:'usage.percent.resetsAt-v1',provenance:'OpenCode v1.18.15 handler.ts shared LiteTable accounting; current authenticated usage response'};
        value.modelDifferences={status:'not_returned_by_usage_api',semantics:'Models consume shared Go windows at provider-defined costMultipliers; no independent model wallet inferred.'};
      }
      done(value);
    }catch{done({...failed(),category:'schema'});}});
  });
}
export const queryUsage=(config={},options={})=>helperCall(config,options,'query');
export const inspectCredentialBinding=(config={},options={})=>helperCall(config,options,'auth-status');
