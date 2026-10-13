import {normalizeUsage} from '../src/quota.mjs';
const fixture = resetsAt => ({fetchedAt:'2026-10-13T00:00:00.000Z',httpStatus:200,ok:true,
 verifiedCoverage:{verified:true,scope:'account',provider:'opencode-go',sourceSchema:'usage.percent.resetsAt-v1'},
 body:{usage:Object.fromEntries(['rolling','weekly','monthly'].map(k=>[k,{status:'ok',percent:0,resetsAt}]))}});
const naked=normalizeUsage(fixture('2026-11-01T00:00:00.000'));
const oversized=fixture('2026-11-01T00:00:00.000Z');oversized.body.usage.rolling.percent=101;
const high=normalizeUsage(oversized);
process.stdout.write(JSON.stringify({fakeOnly:true,noRealAuthOrRequests:true,missingTimezoneAccepted:naked.available&&naked.reliable,over100PercentAccepted:high.available&&high.reliable})+'\n');

