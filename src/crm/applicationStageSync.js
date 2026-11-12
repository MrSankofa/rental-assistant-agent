"use strict";
// Owner-only staging CRM bridge. Never invokes a provider or authorizes sending.
const crypto=require('node:crypto');
const {StoreConflict}=require('./storage');
const {validateZillowUrl}=require('./tourOutcomeAutomation');
const {INBOX}=require('./applicationOwnerResend');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

function authorize(crm,env){
 const required={GOOGLE_CLOUD_PROJECT:'altruistic-platform',CRM_BACKEND:'firestore',
 CRM_DATABASE:'rental-email-staging',CRM_SCOPE:'rental-staging',
 CRM_DELIVERY_MODE:'disabled',CRM_PRODUCTION_EMAIL_ENABLED:'false',
 K_SERVICE:'rental-application-resend-webhook-staging',
 PHASE22_APPLICATION_WEBHOOK_ENABLED:'true',PHASE22_APPLICATION_CRM_SYNC_ENABLED:'true'};
 if(crm?.scope!=='rental-staging'||crm.store?.databaseId!=='rental-email-staging'||
   Object.entries(required).some(([k,v])=>env?.[k]!==v)||env.RESEND_API_KEY||
   env.FIRESTORE_EMULATOR_HOST||env.PHASE22_APPLICATION_DELIVERY_SIMULATION==='true')
   throw fail('Application CRM sync not authorized',403);
}
async function reconcileDeliveredInvitationStage(crm,taskId,{env={},now=new Date()}={}){
 authorize(crm,env);
 const at=new Date(now).toISOString();
 if(at==='Invalid Date'||!/^to_[a-f0-9]{40}$/.test(taskId||''))throw fail('Invalid request',400);
 const task=(await crm.store.get('tasks',taskId))?.value;
 if(!task||task.source!=='phase22-tour-outcome'||task.type!=='APPLICATION_INVITATION_REVIEW'||
    task.outcome!=='attended-interested'||task.status!=='application-delivery-confirmed'||
    task.invitation?.status!=='delivery-confirmed'||
    task.invitation?.policyVersion!=='phase22-application-invitation-v1'||
    !task.invitation?.deliveryConfirmation?.eventHash||
    task.invitation.deliveryConfirmation.providerId!==task.delivery?.providerId||
    task.delivery?.status!=='accepted'||task.delivery?.mode!=='owner-provider-test'||
    task.invitation?.approvedBy?.startsWith('staff:accounts.google.com:')!==true)
    throw fail('Verified owner invitation required');
 const booking=(await crm.store.get('bookings',task.bookingId))?.value;
 const contact=(await crm.store.get('contacts',task.recipientContactId))?.value;
 if(!booking||booking.id!==task.bookingId||booking.engagementId!==task.engagementId||
    booking.propertyId==null||booking.provider!=='calendly'||booking.status!=='scheduled'||
    booking.crmSyncStatus!=='completed'||booking.startsAt!==task.scheduledStart||
    !Number.isFinite(Date.parse(booking.endsAt))||Date.parse(booking.endsAt)>Date.parse(at)||
    !contact||contact.id!==task.recipientContactId||contact.email!==INBOX)
    throw fail('Booking or owner fixture changed');
 const url=validateZillowUrl(task.applicationUrl);
 let changed=false;
 for(let n=0;n<8;n++){
   const row=await crm.store.get('engagements',task.engagementId);
   if(!row)throw fail('Missing engagement');
   const e=row.value;
   if(e.id!==task.engagementId||e.domain!=='rental'||
      e.contactId!==contact.id||e.targetId!==booking.propertyId||
      e.optedOutAt||e.needsStaffReview||
      contact.optedOutAt||contact.doNotContact===true||
      contact.consent?.recording!==true||contact.consent?.email!==true||
      contact.preferredChannel!=='email')throw fail('Engagement or consent changed');
   if(e.stage==='APPLICATION_INVITED'){
     if(e.application?.sourceTaskId!==taskId||e.application?.deliveryMethod!=='resend-verified'||
        e.application?.url!==url||e.application?.providerId!==task.delivery.providerId)
       throw fail('Conflicting invitation');
     break;
   }
   if(!['TOUR_SCHEDULED','TOUR_COMPLETED'].includes(e.stage))
      throw fail('Unsafe CRM stage');
   const target=e.stage==='TOUR_SCHEDULED'?'TOUR_COMPLETED':'APPLICATION_INVITED';
   const evidence='Verified staff tour outcome '+taskId;
   const history=[...(e.history||[]),{at,actor:'phase22-owner-verified-delivery',
     from:e.stage,stage:target,evidence:target==='TOUR_COMPLETED'?evidence:
     'Signed Resend delivery '+task.invitation.deliveryConfirmation.eventHash}];
   const next={...e,history,stage:target,updatedAt:at,
     nextAction:target==='TOUR_COMPLETED'?'Prepare application invitation':'Await application submission',
     nextActionOwner:'staff',nextActionAt:at};
   if(target==='APPLICATION_INVITED')next.application={
      status:'invited',url,deliveryMethod:'resend-verified',deliveryConfirmed:true,
      sourceTaskId:taskId,providerId:task.delivery.providerId,invitedAt:at};
   try{await crm.store.replace('engagements',e.id,next,row.version);changed=true;}
   catch(err){if(err instanceof StoreConflict)continue;throw err;}
 }
 const updated=(await crm.store.get('engagements',task.engagementId))?.value;
 if(updated?.stage!=='APPLICATION_INVITED'||updated.application?.sourceTaskId!==taskId)
   throw fail('CRM stage reconciliation incomplete',503);
 const auditId='a_'+hash('phase22-owner-app-crm-sync|'+taskId).slice(0,40);
 const audit={id:auditId,scope:crm.scope,actor:'phase22-owner-verified-delivery',
   type:'phase22-application-stage-synchronized',entityId:task.engagementId,
   details:{taskId,providerId:task.delivery.providerId,
     eventHash:task.invitation.deliveryConfirmation.eventHash},at};
 if(!(await crm.store.create('audits',auditId,audit))){
   const prior=(await crm.store.get('audits',auditId))?.value;
   if(prior?.details?.taskId!==taskId||prior?.details?.eventHash!==audit.details.eventHash)
     throw fail('CRM stage audit conflict');
 }
 return {status:'APPLICATION_INVITED',changed,taskId};
}
module.exports={authorize,reconcileDeliveredInvitationStage};
