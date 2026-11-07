"use strict";

const {makeStore}=require("../src/crm/storage");

const ENGAGEMENT_ID="e_p9b_fixture_20261107";
const BOOKING_ID="b_p9b_fixture_20261107";

function validate(env) {
  const expected={
    GOOGLE_CLOUD_PROJECT:"altruistic-platform",
    CRM_BACKEND:"firestore",
    CRM_DATABASE:"rental-email-staging",
    CRM_SCOPE:"rental-p9b-test",
    CRM_DELIVERY_MODE:"disabled",
    CRM_TOUR_FIXTURE_APPROVAL:"FICTIONAL_P9B_ONLY"
  };

  for(const [key,value] of Object.entries(expected)){
    if(env[key]!==value)
      throw Error("Phase 9B fixture environment rejected");
  }

  if(env.RESEND_API_KEY ||
     env.FIRESTORE_EMULATOR_HOST ||
     env.CRM_REAL_STAFF_ENABLED==="true" ||
     env.CRM_LIVE_STAFF_ACTIONS_ENABLED==="true" ||
     env.CRM_REAL_INTAKE_ENABLED==="true")
    throw Error("Phase 9B fixture environment rejected");
}

function checkIdentity(e,b) {
  if(!e || !b ||
     e.id!==ENGAGEMENT_ID ||
     e.domain!=="rental" ||
     e.targetId!=="ziegler" ||
     e.source!=="fictional-p9b-test" ||
     b.id!==BOOKING_ID ||
     b.provider!=="calendly" ||
     b.engagementId!==ENGAGEMENT_ID ||
     b.propertyId!=="ziegler")
    throw Error("Unexpected fixture identity");
}

async function run(action,env=process.env) {
  validate(env);

  const store=makeStore(env);
  const existingE=await store.get("engagements",ENGAGEMENT_ID);
  const existingB=await store.get("bookings",BOOKING_ID);

  if(action==="seed"){
    for(const collection of [
      "contacts","engagements","bookings","tasks","audits"
    ]){
      const rows=await store.list(collection,200);
      if(rows.length)
        throw Error("Isolated fixture scope must be empty");
    }

    const now=Date.now();
    const start=new Date(now+2*3600000).toISOString();
    const end=new Date(now+3*3600000).toISOString();

    const engagement={
      id:ENGAGEMENT_ID,
      domain:"rental",
      targetId:"ziegler",
      source:"fictional-p9b-test",
      stage:"TOUR_SCHEDULED",
      createdAt:new Date(now).toISOString(),
      updatedAt:new Date(now).toISOString()
    };

    const booking={
      id:BOOKING_ID,
      provider:"calendly",
      status:"scheduled",
      crmSyncStatus:"completed",
      engagementId:ENGAGEMENT_ID,
      propertyId:"ziegler",
      startsAt:start,
      endsAt:end,
      createdAt:new Date(now).toISOString()
    };

    if(!await store.create("engagements",ENGAGEMENT_ID,engagement))
      throw Error("Engagement collision");

    if(!await store.create("bookings",BOOKING_ID,booking))
      throw Error("Booking collision");

    console.log("P9B_FICTIONAL_FIXTURE_SEEDED_PASS");
    return;
  }

  checkIdentity(existingE?.value,existingB?.value);

  const tasks=(await store.list("tasks")).filter(
    t=>t.source==="tour-reminder-planner"
  );

  if(action==="verify-pending"){
    if(tasks.length!==1 ||
       tasks[0].bookingId!==BOOKING_ID ||
       tasks[0].type!=="TOUR_REMINDER_REVIEW" ||
       tasks[0].status!=="pending-approval" ||
       tasks[0].automatedDelivery!==false ||
       existingB.value.status!=="scheduled")
      throw Error("Pending reminder verification failed");

    console.log("P9B_PERSISTENCE_AND_IDEMPOTENCY_PASS");
    return;
  }

  if(action==="cancel"){
    if(existingB.value.status!=="scheduled")
      throw Error("Booking not scheduled");

    await store.replace("bookings",BOOKING_ID,{
      ...existingB.value,
      status:"cancelled",
      updatedAt:new Date().toISOString()
    },existingB.version);

    console.log("P9B_FICTIONAL_BOOKING_CANCELLED_PASS");
    return;
  }

  if(action==="verify-cancelled"){
    if(tasks.length!==1 ||
       tasks[0].status!=="cancelled" ||
       tasks[0].automatedDelivery!==false ||
       existingB.value.status!=="cancelled")
      throw Error("Cancellation reconciliation failed");

    console.log("P9B_CANCELLATION_RECONCILIATION_PASS");
    return;
  }

  throw Error("Unsupported fixture action");
}

if(require.main===module){
  run(process.argv[2]).catch(e=>{
    console.error(e.message);
    process.exitCode=1;
  });
}

module.exports={run,validate};
