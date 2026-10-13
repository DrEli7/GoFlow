import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GoFlow} from './core.mjs';
const base=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configFile=path.join(base,'runtime-config.json');
const flow=new GoFlow({stateDir:path.join(base,'state'),runtimeConfigPath:configFile});
const [cmd,arg,...rest]=process.argv.slice(2);
let result;
if(cmd==='status')result=await flow.status();
else if(cmd==='mode')result=await flow.setMode(arg);
else if(cmd==='models')result=await flow.models();
else if(cmd==='usage') {
  if(arg!==undefined&&arg!=='--force')throw new Error('usage仅支持可选--force，不接受key、bearer或URL');
  result=await flow.usage({force:arg==='--force'});
}
else if(cmd==='queue')result=await flow.queue();
else if(cmd==='resume')result=await flow.resume(arg);
else if(cmd==='model')result=await flow.selectModel(arg);
else if(cmd==='allow-once')result=await flow.allowOnce({taskId:arg,model:rest[0],authorizationSource:rest.slice(1).join(' ')});
else if(cmd==='route')result=await flow.route(JSON.parse(fs.readFileSync(arg,'utf8')));
else if(cmd==='submit')result=await flow.submit(JSON.parse(fs.readFileSync(arg,'utf8')));
else if(cmd==='task')result=await flow.task(arg);
else if(cmd==='accept')result=await flow.accept(arg,{reviewer:'GPT',reviewSummary:rest.join(' ')});
else if(cmd==='billing-confirm'&&arg==='--use-balance-is-off'&&rest.length===1&&rest[0]==='--go-subscription-is-active'){
  const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  config.billingGuard={useBalanceDisabledConfirmed:true,activeGoSubscriptionConfirmed:true,confirmedAt:new Date().toISOString(),confirmationSource:'human-local-cli-attestation'};
  fs.writeFileSync(configFile,JSON.stringify(config,null,2)+'\n');
  result={status:'confirmed',warning:'Only use this command after personally checking that Go subscription is ACTIVE and Go console Use balance is OFF. This local guard cannot observe later account/subscription changes and is not a per-request billing guarantee.'};
}else if(cmd==='billing-revoke'){
  const config=JSON.parse(fs.readFileSync(configFile,'utf8'));config.billingGuard={useBalanceDisabledConfirmed:false,activeGoSubscriptionConfirmed:false,confirmedAt:null,confirmationSource:null};fs.writeFileSync(configFile,JSON.stringify(config,null,2)+'\n');result={status:'revoked'};
}else{
  result={version:'1.1.0',channel:'opencode-go',usage:['status (cached quota only)','usage [--force] (read-only official shared quota)','queue','resume EXACT_TASK_ID','models','model opencode-go/STABLE_MODEL','allow-once EXACT_TASK_ID EXACT_GO_MODEL 用户明确授权说明 (human explicit authorization only, one request, expires in ten minutes)','mode auto|gpt|go|off','route request.json','submit request.json','task ID','accept ID review summary','billing-confirm --use-balance-is-off --go-subscription-is-active (human only)','billing-revoke']};
}
process.stdout.write(JSON.stringify(result,null,2)+'\n');
