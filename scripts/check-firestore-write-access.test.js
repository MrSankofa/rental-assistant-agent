'use strict';
const assert=require('node:assert/strict');const {run}=require('./check-firestore-write-access');
const env={CLOUD_RUN_JOB:'rental-crm-email-test-staging',GOOGLE_CLOUD_PROJECT:'altruistic-platform',CRM_BACKEND:'firestore',CRM_DATABASE:'rental-email-staging',CRM_SCOPE:'rental-staging',CRM_EMAIL_TEST_ENABLED:'false',CRM_WRITE_PROBE_APPROVAL:'VERIFY_STAGING_FIRESTORE_WRITES'};
const id='iamwrite_12345678123442348234123456789abc';const path='projects/altruistic-platform/databases/rental-email-staging/documents/scopes/rental-staging/iam-write-probes/'+id;
const record=(phase,time)=>({name:path,updateTime:time,fields:{kind:{stringValue:'fictional-probe'},nonce:{stringValue:id},phase:{stringValue:phase}}});
const reply=(status,data={})=>({ok:status>=200&&status<300,status,json:async()=>data});
test('creates, reads, updates, conditionally deletes and confirms absence',async()=>{
 const sequence=[reply(200,{access_token:'token'}),reply(200),reply(200,record('created','v1')),reply(200),reply(200,record('updated','v2')),reply(200,record('updated','v2')),reply(200),reply(404)];const calls=[];const log=[];
 const value=await run({env,uuid:()=> '12345678-1234-4234-8234-123456789abc',fetchFn:async(url,options)=>{calls.push({url,options});return sequence.shift();},log:(...v)=>log.push(v)});
 assert.deepEqual(value,{verified:true,cleaned:true});assert.deepEqual(calls.map(c=>c.options.method),['GET','POST','GET','PATCH','GET','GET','DELETE','GET']);assert(calls.every(c=>!c.url.includes('/databases/(default)')));assert(log.some(v=>v[0]==='IAM_WRITE_PROBE_VERIFIED'));assert(!JSON.stringify(log).includes('token'));
});
test('fails before network access on invalid environment',async()=>{let count=0;await assert.rejects(()=>run({env:{...env,CRM_DATABASE:'(default)'},fetchFn:async()=>{count++;}}));assert.equal(count,0);});
test('a failed create does not trigger delete',async()=>{const methods=[];const log=[];await assert.rejects(()=>run({env,uuid:()=> '12345678-1234-4234-8234-123456789abc',fetchFn:async(_url,options)=>{methods.push(options.method);return methods.length===1?reply(200,{access_token:'token'}):reply(403);},log:(...v)=>log.push(v)}));assert.deepEqual(methods,['GET','POST']);assert(log.some(v=>v[0]==='IAM_WRITE_PROBE_MANUAL_RECONCILIATION_REQUIRED'));});

test('failed update still cleans up the verified fictional record',async()=>{
 const sequence=[reply(200,{access_token:'token'}),reply(200),reply(200,record('created','v1')),reply(412),reply(200,record('created','v1')),reply(200),reply(404)];
 const methods=[],messages=[];
 await assert.rejects(()=>run({env,uuid:()=> '12345678-1234-4234-8234-123456789abc',
  fetchFn:async(_url,options)=>{methods.push(options.method);return sequence.shift();},
  log:(...v)=>messages.push(v)}));
 assert.deepEqual(methods,['GET','POST','GET','PATCH','GET','DELETE','GET']);
 assert(messages.some(v=>v[0]==='IAM_WRITE_PROBE_CLEANUP_OK'));
 assert(!messages.some(v=>v[0]==='IAM_WRITE_PROBE_VERIFIED'));
});
test('failed delete requests manual reconciliation and does not report success',async()=>{
 const sequence=[reply(200,{access_token:'token'}),reply(200),reply(200,record('created','v1')),reply(200),reply(200,record('updated','v2')),reply(200,record('updated','v2')),reply(403)];
 const methods=[],messages=[];
 await assert.rejects(()=>run({env,uuid:()=> '12345678-1234-4234-8234-123456789abc',
  fetchFn:async(_url,options)=>{methods.push(options.method);return sequence.shift();},
  log:(...v)=>messages.push(v)}));
 assert.deepEqual(methods,['GET','POST','GET','PATCH','GET','GET','DELETE']);
 assert(messages.some(v=>v[0]==='IAM_WRITE_PROBE_MANUAL_RECONCILIATION_REQUIRED'));
 assert(!messages.some(v=>v[0]==='IAM_WRITE_PROBE_VERIFIED'));
});
test('unexpected record identity is never deleted',async()=>{
 const foreign={...record('created','v1'),fields:{...record('created','v1').fields,nonce:{stringValue:'someone-else'}}};
 const sequence=[reply(200,{access_token:'token'}),reply(200),reply(200,foreign),reply(200,foreign)];
 const methods=[],messages=[];
 await assert.rejects(()=>run({env,uuid:()=> '12345678-1234-4234-8234-123456789abc',
  fetchFn:async(_url,options)=>{methods.push(options.method);return sequence.shift();},
  log:(...v)=>messages.push(v)}));
 assert.deepEqual(methods,['GET','POST','GET','GET']);
 assert(messages.some(v=>v[0]==='IAM_WRITE_PROBE_MANUAL_RECONCILIATION_REQUIRED'));
});
test('delete acknowledgement without confirmed absence is not success',async()=>{
 const sequence=[reply(200,{access_token:'token'}),reply(200),reply(200,record('created','v1')),reply(200),reply(200,record('updated','v2')),reply(200,record('updated','v2')),reply(200),reply(200,record('updated','v2'))];
 const messages=[];
 await assert.rejects(()=>run({env,uuid:()=> '12345678-1234-4234-8234-123456789abc',
  fetchFn:async()=>sequence.shift(),log:(...v)=>messages.push(v)}));
 assert(messages.some(v=>v[0]==='IAM_WRITE_PROBE_MANUAL_RECONCILIATION_REQUIRED'));
 assert(!messages.some(v=>v[0]==='IAM_WRITE_PROBE_VERIFIED'));
});
