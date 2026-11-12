"use strict";
const {MemoryStore}=require('./storage');
const {reconcileDeliveredInvitationStage:sync}=require('./applicationStageSync');
const env={GOOGLE_CLOUD_PROJECT:'altruistic-platform',CRM_BACKEND:'firestore',
 CRM_DATABASE:'rental-email-staging',CRM_SCOPE:'rental-staging',CRM_DELIVERY_MODE:'disabled',
 CRM_PRODUCTION_EMAIL_ENABLED:'false',K_SERVICE:'rental-application-resend-webhook-staging',
 PHASE22_APPLICATION_WEBHOOK_ENABLED:'true',PHASE22_APPLICATION_CRM_SYNC_ENABLED:'true'};
const now='2026-12-01T16:00:00Z',tid='to_'+'a'.repeat(40);
async function setup(){
 const store=new MemoryStore();store.databaseId='rental-email-staging';
 const crm={scope:'rental-staging',store};
 const c={id:'c_owner0001',email:'brett@altruisticdevelopment.com',preferredChannel:'email',consent:{recording:true,email:true}};
 const e={id:'e_owner0001',domain:'rental',contactId:c.id,targetId:'ziegler',stage:'TOUR_SCHEDULED',history:[]};
 const b={id:'b_owner0001',engagementId:e.id,propertyId:e.targetId,provider:'calendly',status:'scheduled',crmSyncStatus:'completed',startsAt:'2026-12-01T15:00:00Z',endsAt:'2026-12-01T15:30:00Z'};
 const t={id:tid,source:'phase22-tour-outcome',type:'APPLICATION_INVITATION_REVIEW',outcome:'attended-interested',
   bookingId:b.id,engagementId:e.id,recipientContactId:c.id,scheduledStart:b.startsAt,
   status:'application-delivery-confirmed',applicationUrl:'https://www.zillow.com/renter-hub/applications/',
   invitation:{status:'delivery-confirmed',policyVersion:'phase22-application-invitation-v1',
     approvedBy:'staff:accounts.google.com:123456789',deliveryConfirmation:{eventHash:'a'.repeat(64),providerId:'resend-msg-001'}},
   delivery:{mode:'owner-provider-test',status:'accepted',providerId:'resend-msg-001'}};
 for(const [collection,row] of [['contacts',c],['engagements',e],['bookings',b],['tasks',t]])await store.create(collection,row.id,row);
 return {store,crm,c,e,b,t};
}
async function patch(f,collection,id,values){const row=await f.store.get(collection,id);await f.store.replace(collection,id,{...row.value,...values},row.version)}
describe('Phase22 verified owner application CRM reconciliation',()=>{
 test('delivery receipt reconciles two stages and application evidence',async()=>{
  const f=await setup();const r=await sync(f.crm,tid,{env,now});
  expect(r).toMatchObject({status:'APPLICATION_INVITED',changed:true});
  const row=(await f.store.get('engagements',f.e.id)).value;
  expect(row.history.map(h=>h.stage)).toEqual(['TOUR_COMPLETED','APPLICATION_INVITED']);
  expect(row.application).toMatchObject({status:'invited',deliveryMethod:'resend-verified',sourceTaskId:tid});
  expect((await f.store.list('audits'))).toHaveLength(1);
 });
 test('duplicate reconciliation is idempotent',async()=>{
  const f=await setup();await sync(f.crm,tid,{env,now});
  expect(await sync(f.crm,tid,{env,now})).toMatchObject({changed:false});
  expect((await f.store.get('engagements',f.e.id)).value.history).toHaveLength(2);
  expect(await f.store.list('audits')).toHaveLength(1);
 });
 test('unconfirmed receipt or changed consent cannot advance stage',async()=>{
  const f=await setup();await patch(f,'tasks',tid,{status:'application-provider-accepted'});
  await expect(sync(f.crm,tid,{env,now})).rejects.toHaveProperty('status',409);
  await patch(f,'tasks',tid,{status:'application-delivery-confirmed'});
  await patch(f,'contacts',f.c.id,{optedOutAt:now});
  await expect(sync(f.crm,tid,{env,now})).rejects.toHaveProperty('status',409);
  expect((await f.store.get('engagements',f.e.id)).value.stage).toBe('TOUR_SCHEDULED');
 });
 test('wrong scope or production release cannot mutate CRM',async()=>{
  const f=await setup();
  for(const change of [{CRM_SCOPE:'rental-live'},{CRM_PRODUCTION_EMAIL_ENABLED:'true'},
      {PHASE22_APPLICATION_CRM_SYNC_ENABLED:'false'},{RESEND_API_KEY:'re_fake'}])
    await expect(sync(f.crm,tid,{env:{...env,...change},now})).rejects.toHaveProperty('status',403);
  expect((await f.store.get('engagements',f.e.id)).value.stage).toBe('TOUR_SCHEDULED');
 });
 test('stale booking and unrelated stage cannot be overwritten',async()=>{
  const f=await setup();await patch(f,'bookings',f.b.id,{status:'cancelled'});
  await expect(sync(f.crm,tid,{env,now})).rejects.toHaveProperty('status',409);
  await patch(f,'bookings',f.b.id,{status:'scheduled'});
  await patch(f,'engagements',f.e.id,{stage:'APPLICATION_RECEIVED'});
  await expect(sync(f.crm,tid,{env,now})).rejects.toHaveProperty('status',409);
 });
});
