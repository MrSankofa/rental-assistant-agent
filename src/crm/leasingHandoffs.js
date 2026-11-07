"use strict";

const {validateExternalUrl} = require("./applicationTracking");

const DECISIONS=new Set([
  "APPROVED","DENIED","MORE_INFO_REQUESTED"
]);

const EXTERNAL_STAGES=new Set([
  "RENTREDI_ONBOARDING",
  "LEASE_SIGNING_SCHEDULED",
  "DISCLOSURES_READY_AND_DELIVERED",
  "LEASE_SIGNED"
]);

function fail(message,status=400){
  throw Object.assign(new Error(message),{status});
}

function reference(value){
  if(typeof value!=="string" ||
     !/^[A-Za-z0-9][A-Za-z0-9 _.-]{7,99}$/.test(value))
    fail("External reference must be 8-100 characters");
  return value.trim();
}

function validateHandoffStep(stage,input,{fromStage=""}={}){
  // Initial review is part of the existing application workflow.
  // Only a return after an information request needs a new reference.
  if(stage==="UNDER_LANDLORD_REVIEW" &&
     fromStage!=="MORE_INFO_REQUESTED") return null;

  if(!DECISIONS.has(stage) &&
     !EXTERNAL_STAGES.has(stage) &&
     stage!=="UNDER_LANDLORD_REVIEW") return null;

  const result={
    reference:reference(input.externalReference)
  };

  if(DECISIONS.has(stage)){
    if(input.humanDecisionConfirmed!==true)
      fail("Independent landlord decision confirmation required",403);
  }

  if(EXTERNAL_STAGES.has(stage)){
    if(input.externalActionConfirmed!==true)
      fail("Confirm external provider milestone",403);
  }

  if(stage==="RENTREDI_ONBOARDING" ||
     stage==="LEASE_SIGNING_SCHEDULED"){
    result.url=validateExternalUrl(input.providerUrl);
  }

  if(stage==="LEASE_SIGNING_SCHEDULED"){
    if(typeof input.scheduledAt!=="string" ||
       !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.scheduledAt) ||
       !Number.isFinite(Date.parse(input.scheduledAt)))
      fail("Signing time must include a valid time zone");

    result.scheduledAt=new Date(input.scheduledAt).toISOString();
  }

  return result;
}

function recordHandoff(current,application,stage,details,now){
  if(!details) fail("Verified external handoff required");
  const previous=current||{};

  if(DECISIONS.has(stage)){
    if(application?.status!=="under-review")
      fail("Application must be under landlord review",409);

    if(previous.decision &&
       previous.decision.status!=="more-info-requested")
      fail("Existing landlord decision cannot be overwritten",409);

    const outcome={
      APPROVED:"approved",
      DENIED:"denied",
      MORE_INFO_REQUESTED:"more-info-requested"
    }[stage];

    return {
      ...previous,
      decision:{
        status:outcome,
        reference:details.reference,
        at:now
      },
      status:outcome
    };
  }

  if(stage==="UNDER_LANDLORD_REVIEW"){
    if(previous.decision?.status!=="more-info-requested")
      fail("Additional information was not requested",409);

    return {
      ...previous,
      responseReference:details.reference,
      responseAt:now,
      status:"review-resumed",
      decision:null
    };
  }

  if(previous.decision?.status!=="approved")
    fail("Landlord approval required before lease handoff",409);

  const expected={
    RENTREDI_ONBOARDING:null,
    LEASE_SIGNING_SCHEDULED:"onboarding",
    DISCLOSURES_READY_AND_DELIVERED:"signing-scheduled",
    LEASE_SIGNED:"disclosures-delivered"
  };

  if(stage==="RENTREDI_ONBOARDING"){
    if(previous.lease)
      fail("Lease onboarding already recorded",409);
  }else if(previous.lease?.status!==expected[stage]){
    fail("Previous lease handoff must be verified first",409);
  }

  const status={
    RENTREDI_ONBOARDING:"onboarding",
    LEASE_SIGNING_SCHEDULED:"signing-scheduled",
    DISCLOSURES_READY_AND_DELIVERED:"disclosures-delivered",
    LEASE_SIGNED:"signed"
  }[stage];

  return {
    ...previous,
    status,
    lease:{
      ...previous.lease,
      status,
      reference:details.reference,
      ...(details.url?{url:details.url}:{}),
      ...(details.scheduledAt?{
        signingScheduledAt:details.scheduledAt
      }:{}),
      updatedAt:now
    }
  };
}

module.exports={
  DECISIONS,
  EXTERNAL_STAGES,
  validateHandoffStep,
  recordHandoff
};
