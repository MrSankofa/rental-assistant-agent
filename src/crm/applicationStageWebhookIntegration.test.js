"use strict";
const crypto=require('node:crypto');
const {MemoryStore}=require('./storage');
const {handleSignedOwnerWebhook}=require('./applicationOwnerWebhook');
const now='2026-12-01T16:00:00Z',eventId='msg_phase22_owner_sync_0001';
const signingBytes=Buffer.alloc(32,7),secret='whsec_'+signingBytes.toString('base64');
const env={GOOGLE_CLOUD_PROJECT:'altruistic-platform',CRM_BACKEND:'firestore',
 CRM_SCOPE:'rental-staging',CRM_DATABASE:'rental-email-staging',CRM_DELIVERY_MODE:'disabled',
 CRM_PRODUCTION_EMAIL_ENABLED:'false',K_SERVICE:'rental-application-resend-webhook-staging',
 PHASE22_APPLICATION_WEBHOOK_ENABLED:'true',PHASE22_APPLICATION_CRM_SYNC_ENABLED:'true',
 RESEND_WEBHOOK_SIGNING_SECRET:secret};
const taskId='to_'+'d'.repeat(40);
function event(){
 const raw=Buffer.from(JSON.stringify({type:'email.delivered',data:{email_id:'real-accepted-owner-123'}}));
 const stamp=String(Date.parse(now)/1000);
 const digest=crypto.createHmac('sha256',signingBytes).update(Buffer.concat([Buffer.from(eventId+'.'+stamp+'.'),raw])).digest('base64');
 return [raw,{'svix-id':eventId,'svix-timestamp':stamp,'svix-signature':'v1,'+digest}];
}
async function fixture(){
 const store=new MemoryStore();store.databaseId='rental-email-staging';const crm={scope:'rental-staging',store};
 const c={id:'c_owner0001',email:'brett@altruisticdevelopment.com',preferredChannel:'email',consent:{recording:true,email:true}};
 const e={id:'e_owner0001',contactId:c.id,domain:'rental',targetId:'ziegler',stage:'TOUR_SCHEDULED',history:[]};
 const b={id:'b_owner0001',engagementId:e.id,propertyId:'ziegler',provider:'calendly',status:'scheduled',crmSyncStatus:'completed',startsAt:'2026-12-01T15:00:00Z',endsAt:'2026-12-01T15:30:00Z'};
 const t={id:taskId,source:'phase22-tour-outcome',type:'APPLICATION_INVITATION_REVIEW',
 outcome:'attended-interested',engagementId:e.id,bookingId:b.id,recipientContactId:c.id,scheduledStart:b.startsAt,
 applicationUrl:'https://www.zillow.com/renter-hub/applications/',status:'application-provider-accepted',
 invitation:{status:'provider-accepted-not-delivery-confirmed',policyVersion:'phase22-application-invitation-v1',approvedBy:'staff:accounts.google.com:123456789'},
 delivery:{mode:'owner-provider-test',status:'accepted',providerId:'real-accepted-owner-123'}};
 for(const [name,value] of [['contacts',c],['engagements',e],['bookings',b],['tasks',t]])await store.create(name,value.id,value);
 return {crm,store,e};
}
test('signed receipt synchronizes owner staging CRM once and safely replays',async()=>{
 const f=await fixture();const [raw,headers]=event();
 expect(await handleSignedOwnerWebhook(f.crm,raw,headers,{env,now})).toMatchObject({outcome:'confirmed',crmStage:'APPLICATION_INVITED'});
 expect(await handleSignedOwnerWebhook(f.crm,raw,headers,{env,now})).toMatchObject({outcome:'duplicate',crmStage:'APPLICATION_INVITED'});
 const e=(await f.store.get('engagements',f.e.id)).value;
 expect(e.history.map(h=>h.stage)).toEqual(['TOUR_COMPLETED','APPLICATION_INVITED']);
 expect(e.application.deliveryMethod).toBe('resend-verified');
 expect(await f.store.list('audits')).toHaveLength(2);
});
