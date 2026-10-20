'use strict';
const { randomUUID } = require('node:crypto');
const EXPECTED={CLOUD_RUN_JOB:'rental-crm-email-test-staging',GOOGLE_CLOUD_PROJECT:'altruistic-platform',CRM_BACKEND:'firestore',CRM_DATABASE:'rental-email-staging',CRM_SCOPE:'rental-staging',CRM_EMAIL_TEST_ENABLED:'false',CRM_WRITE_PROBE_APPROVAL:'VERIFY_STAGING_FIRESTORE_WRITES'};
function validate(env){for(const [k,v] of Object.entries(EXPECTED))if(env[k]!==v)throw Error('Write probe unauthorized');if(env.CRM_EMAIL_TEST_APPROVAL||env.FIRESTORE_EMULATOR_HOST||env.RESEND_API_KEY)throw Error('Write probe unauthorized');}
function assertRecord(row,id,phase){if(row?.fields?.nonce?.stringValue!==id||row.fields.kind?.stringValue!=='fictional-probe'||row.fields.phase?.stringValue!==phase||!row.updateTime)throw Error('Unexpected probe record');return row.updateTime;}
async function run({env=process.env,fetchFn=globalThis.fetch,uuid=randomUUID,log=console.log}={}){
 validate(env);
 const raw=uuid();if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(raw))throw Error('Invalid ID');
 const id='iamwrite_'+raw.replace(/-/g,''); const root='projects/altruistic-platform/databases/rental-email-staging/documents/scopes/rental-staging/iam-write-probes'; const uri='https://firestore.googleapis.com/v1/'+root+'/'+id;
 const response=await fetchFn('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',{method:'GET',headers:{'Metadata-Flavor':'Google'}});
 if(!response?.ok)throw Error('Credentials unavailable');const token=(await response.json()).access_token;if(typeof token!=='string'||!token)throw Error('Credentials unavailable');
 const req=(method,url,body)=>fetchFn(url,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const document=phase=>({fields:{kind:{stringValue:'fictional-probe'},nonce:{stringValue:id},phase:{stringValue:phase}}});
 const get=async()=>{const r=await req('GET',uri);if(r.status!==200)throw Error('Read unsuccessful');return r.json();};
 let created=false,verified=false,cleaned=false,ambiguous=false;log('IAM_WRITE_PROBE_ID',id);
 try{
  const r=await req('POST','https://firestore.googleapis.com/v1/'+root+'?documentId='+id,document('created'));
  if(r.status!==200)throw Error('Create unsuccessful');created=true;
  const before=await get();const version=assertRecord(before,id,'created');
  const update=await req('PATCH',uri+'?updateMask.fieldPaths=phase&currentDocument.updateTime='+encodeURIComponent(version),{fields:{phase:{stringValue:'updated'}}});
  if(update.status!==200)throw Error('Update unsuccessful');const after=await get();assertRecord(after,id,'updated');verified=true;
  log('IAM_WRITE_PROBE_READ_UPDATE_OK');
 }catch(_){ambiguous=true;}
 if(created){
  try{const row=await get();if(!['created','updated'].includes(row?.fields?.phase?.stringValue))throw Error('Unexpected phase');const version=assertRecord(row,id,row.fields.phase.stringValue);
   const deletion=await req('DELETE',uri+'?currentDocument.updateTime='+encodeURIComponent(version));if(deletion.status!==200)throw Error('Delete unsuccessful');
   const gone=await req('GET',uri);if(gone.status!==404)throw Error('Delete unconfirmed');cleaned=true;log('IAM_WRITE_PROBE_CLEANUP_OK');
  }catch(_){log('IAM_WRITE_PROBE_MANUAL_RECONCILIATION_REQUIRED',id);}
 }else if(ambiguous){log('IAM_WRITE_PROBE_MANUAL_RECONCILIATION_REQUIRED',id);}
 if(!verified||!cleaned||ambiguous)throw Error('Write test inconclusive');
 log('IAM_WRITE_PROBE_VERIFIED');return {verified:true,cleaned:true};
}
if(require.main===module)run().catch(()=>{console.error('IAM_WRITE_PROBE_FAILED');process.exitCode=1;});
module.exports={run,validate,assertRecord};
