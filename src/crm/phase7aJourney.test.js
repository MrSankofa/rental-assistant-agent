"use strict";

// Phase 7A contract test. No browser, network, Calendly, Cloud Run, or Firestore writes.
const crypto=require("crypto");
const {CRM}=require("./workflows");
const {MemoryStore}=require("./storage");
const {acceptPublicInquiry}=require("./publicIntake");
const {makeCalendlyCandidateLookup}=require("./calendlyCandidates");
const {dispatchCalendlyWebhook}=require("./calendlyDispatcher");
const {bookingId}=require("./calendlyBookings");
const {summarizeDashboard}=require("./staff");

const origin="https://8080-cs-test-default.cs-us-east1.cloudshell.dev";
const staging={
  K_SERVICE:"rental-assistant-staging",
  CRM_STAGING_TEST_MODE:"true",
  CRM_PUBLIC_INTAKE_ENABLED:"true",
  CRM_BACKEND:"firestore",
  CRM_DATABASE:"rental-email-staging",
  CRM_SCOPE:"rental-staging",
  GOOGLE_CLOUD_PROJECT:"altruistic-platform",
  PUBLIC_ORIGIN:origin
};
const email="fictional-phase7a@example.test";
const showingUrl="https://calendly.com/altruistic-re/ziegler-house-showing";
const eventUri="https://api.calendly.com/scheduled_events/phase7a-event";
const inviteeUri=eventUri+"/invitees/phase7a-invitee";
const eventTypeUri="https://api.calendly.com/event_types/ziegler-fixture";
const hostUri="https://api.calendly.com/users/ziegler-host";
const signingKey="fictional-phase7a-signing-key-only";
const now=Date.parse("2026-10-24T12:00:00Z");

const inquiry=overrides=>({
  name:"Fictional Journey",email,phone:"",
  preferredChannel:"email",domain:"rental",targetId:"ziegler",
  source:"untrusted-browser-source",interest:"Tour inquiry",
  consent:{recording:true,email:false,sms:false},...overrides
});
const property=(id)=>({
  found:id==="ziegler",
  property:{available:true,showingUrl}
});
function fixture(){
  const crm=new CRM(new MemoryStore(),"rental-staging");
  const submit=(body=inquiry(),lookupProperty=property)=>acceptPublicInquiry({
    env:staging,crm,headers:{origin,"content-type":"application/json"},
    body,lookupProperty
  });
  return {crm,submit};
}
function signed(type) {
  const rawBody=Buffer.from(JSON.stringify({
    event:type==="created"?"invitee.created":"invitee.canceled",
    payload:{uri:inviteeUri,event:eventUri,email}
  }));
  const timestamp=String(Math.floor(now/1000));
  const digest=crypto.createHmac("sha256",signingKey)
    .update(timestamp+".").update(rawBody).digest("hex");
  return {rawBody,signatureHeader:"t="+timestamp+",v1="+digest};
}
function webhook(crm,provider,type="created",overrides={}) {
  return dispatchCalendlyWebhook({
    crm,...signed(type),signingKey,
    expectedEventTypeUri:eventTypeUri,expectedHostUri:hostUri,
    fetchProviderResources:jest.fn(async()=>provider),
    loadCrmCandidates:makeCalendlyCandidateLookup(crm),
    writesEnabled:true,
    allowedEmailHash:crypto.createHash("sha256").update(email).digest("hex"),
    now,...overrides
  });
}
function provider(){
  return {
    scheduledEvent:{
      uri:eventUri,event_type:eventTypeUri,
      event_memberships:[{user:hostUri}],status:"active",
      start_time:"2026-11-02T18:00:00Z",end_time:"2026-11-02T18:30:00Z"
    },
    invitee:{uri:inviteeUri,event:eventUri,email,status:"active"}
  };
}

test("fictional browser intake offers verified Calendly URL and signed booking updates dashboard",async()=>{
  const {crm,submit}=fixture();
  const response=await submit();
  expect(response).toMatchObject({
    received:true,
    nextSteps:{showingAvailable:true,showingUrl,bookingRecorded:false,propertyId:"ziegler"}
  });
  expect(response).not.toHaveProperty("engagementId");
  expect(response).not.toHaveProperty("contactId");

  const contacts=await crm.listContacts(), engagements=await crm.listEngagements();
  expect(contacts).toHaveLength(1);
  expect(contacts[0].consent.email).toBe(false);
  expect(engagements).toHaveLength(1);
  expect(engagements[0]).toMatchObject({
    stage:"TOUR_OFFERED",source:"private-staging-form",
    nextAction:"Await confirmed Calendly booking"
  });
  expect(await crm.store.list("bookings")).toHaveLength(0);

  const data=provider();
  expect((await webhook(crm,data)).status).toBe("scheduled");
  const booking=await crm.store.get("bookings",bookingId(inviteeUri));
  expect(booking.value).toMatchObject({
    status:"scheduled",crmSyncStatus:"completed",
    engagementId:engagements[0].id,propertyId:"ziegler"
  });
  const dashboard=summarizeDashboard(
    await crm.listContacts(),await crm.listEngagements(),await crm.listTasks()
  );
  expect(dashboard.pipeline[0]).toMatchObject({
    stage:"TOUR_SCHEDULED",property:"ziegler",
    contact:{email}
  });

  expect((await webhook(crm,data)).status).toBe("duplicate");
  data.invitee.status="canceled";
  expect((await webhook(crm,data,"canceled")).status).toBe("cancelled");
  expect((await crm.history(engagements[0].id)).stage).toBe("TOUR_CANCELLED");
  expect(await crm.store.list("bookings")).toHaveLength(1);
  expect(await crm.listTasks()).toHaveLength(0);
});

test("repeating intake never re-offers or reverses an already booked showing",async()=>{
  const {crm,submit}=fixture();
  expect((await submit()).nextSteps.showingUrl).toBe(showingUrl);
  expect((await submit()).nextSteps.showingUrl).toBe(showingUrl);
  expect(await crm.listContacts()).toHaveLength(1);
  expect(await crm.listEngagements()).toHaveLength(1);
  await webhook(crm,provider());
  const receipt=await submit();
  expect(receipt).toEqual({received:true,message:expect.any(String)});
  expect((await crm.listEngagements())[0].stage).toBe("TOUR_SCHEDULED");
});

test.each([
  ["other inquiry",{interest:"Application information"},property],
  ["unavailable property",{},()=>({found:true,property:{available:false,showingUrl}})],
  ["unsafe link",{},()=>({found:true,property:{available:true,showingUrl:"https://calendly.com.evil.test/a/b"}})]
])("%s is recorded but not falsely marked as offered",async(_label,override,lookup)=>{
  const {crm,submit}=fixture();
  const result=await submit(inquiry(override),lookup);
  expect(result).not.toHaveProperty("nextSteps");
  expect((await crm.listEngagements())[0].stage).toBe("CONTACT_CAPTURED");
});

test("untrusted source and wrong staging scope cannot trigger offer helper",async()=>{
  const {offerStagingShowing}=require("./stagingShowingHandoff");
  const {crm,submit}=fixture();
  await submit(inquiry({interest:"Application information"}));
  expect(await offerStagingShowing(crm,inquiry(),property)).toBeNull();
  const another=new CRM(crm.store,"another-scope");
  expect(await offerStagingShowing(another,{
    ...inquiry(),source:"private-staging-form"
  },property)).toBeNull();
  expect((await crm.listEngagements())[0].stage).toBe("CONTACT_CAPTURED");
});

test("failed stage persistence preserves intake for human review without offering booking",async()=>{
  const {crm,submit}=fixture();
  const transition=crm.transition.bind(crm);
  crm.transition=jest.fn().mockRejectedValue(new Error("Firestore unavailable"));
  const receipt=await submit();
  expect(receipt).not.toHaveProperty("nextSteps");
  expect((await crm.listEngagements())[0].stage).toBe("CONTACT_CAPTURED");
  expect(await crm.listContacts()).toHaveLength(1);
  crm.transition=transition;
});

test("wrong signed invitee and invalid signature never turn the offered link into a booking",async()=>{
  const {crm,submit}=fixture();
  await submit();
  const data=provider();
  data.invitee.email="other@example.test";
  expect((await webhook(crm,data)).status).toBe("requires-review");
  expect(await crm.store.list("bookings")).toHaveLength(0);
  await expect(webhook(crm,provider(),"created",{
    signatureHeader:"t=1,v1="+ "0".repeat(64)
  })).rejects.toHaveProperty("status",401);
  expect((await crm.listEngagements())[0].stage).toBe("TOUR_OFFERED");
});
