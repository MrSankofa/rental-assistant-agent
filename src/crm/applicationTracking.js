"use strict";

function fail(message,status=400){
  throw Object.assign(new Error(message),{status});
}

function validateExternalUrl(value){
  if(typeof value!=="string" || value.length>500)
    fail("External application URL required");

  let url;
  try{url=new URL(value);}catch{
    fail("Invalid external application URL");
  }

  if(url.protocol!=="https:" ||
     !url.hostname.includes(".") ||
     url.hostname==="localhost" ||
     url.hostname.endsWith(".local") ||
     url.username || url.password ||
     url.search || url.hash ||
     url.port && url.port!=="443"){
    fail("Use a clean HTTPS application URL without credentials or tokens");
  }

  return url.toString();
}

function validateApplicationStep(stage,input){
  if(stage==="APPLICATION_INVITED"){
    if(input.externalDeliveryConfirmed!==true)
      fail("Confirm invitation was sent outside the CRM",403);

    return {
      url:validateExternalUrl(input.applicationUrl),
      deliveryMethod:"external-manual",
      deliveryConfirmed:true
    };
  }

  if(stage==="APPLICATION_RECEIVED"){
    const ref=input.submissionReference;

    if(typeof ref!=="string" ||
       !/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{7,99}$/.test(ref))
      fail("Provider confirmation reference must be 8-100 characters");

    return {
      submissionReference:ref.trim()
    };
  }

  return null;
}

function recordApplication(current,stage,details,now){
  const previous=current||{};

  if(stage==="APPLICATION_INVITED"){
    if(!details?.deliveryConfirmed)
      fail("Verified invitation required",403);

    return {
      status:"invited",
      url:details.url,
      deliveryMethod:"external-manual",
      invitedAt:now
    };
  }

  if(stage==="APPLICATION_RECEIVED"){
    if(previous.status!=="invited" || !previous.url)
      fail("Verified invitation must exist before receipt",409);

    if(!details?.submissionReference)
      fail("Provider confirmation required");

    return {
      ...previous,
      status:"received",
      submissionReference:details.submissionReference,
      receivedAt:now
    };
  }

  if(stage==="UNDER_LANDLORD_REVIEW"){
    if(previous.status!=="received")
      fail("Application receipt must be recorded first",409);

    return {
      ...previous,
      status:"under-review",
      underReviewAt:now
    };
  }

  return previous;
}

module.exports={
  validateExternalUrl,
  validateApplicationStep,
  recordApplication
};
