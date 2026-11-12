"use strict";
// Property application URLs are controlled staff configuration, never public input.
const {StoreConflict}=require("./storage");
const {validateZillowUrl}=require("./tourOutcomeAutomation");
const PROPERTIES=Object.freeze({ziegler:"Dearborn Heights",virginia:"Detroit"});
const idFor=propertyId=>"pl_"+propertyId;
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
function authorize(crm,env,actor){
  const staging=crm?.scope==="rental-staging"&&crm.store?.databaseId==="rental-email-staging"&&env.CRM_SCOPE==="rental-staging"&&env.CRM_DATABASE==="rental-email-staging";
  const live=crm?.scope==="rental-live"&&crm.store?.databaseId==="rental-leads-prod"&&env.K_SERVICE==="rental-assistant-staff-live"&&env.CRM_SCOPE==="rental-live"&&env.CRM_DATABASE==="rental-leads-prod"&&env.CRM_STAFF_ENABLED==="true"&&env.CRM_REAL_STAFF_ENABLED==="true"&&env.CRM_LIVE_STAFF_ACTIONS_ENABLED==="true";
  if(!staging&&!live || env.PHASE22_PROPERTY_APPLICATION_LINKS_ENABLED!=="true"||env.CRM_PRODUCTION_EMAIL_ENABLED!=="false"||env.CRM_DELIVERY_MODE!=="disabled"||env.CRM_BACKEND!=="firestore"||env.GOOGLE_CLOUD_PROJECT!=="altruistic-platform"||env.FIRESTORE_EMULATOR_HOST||!/^staff:accounts\.google\.com:[0-9]{6,30}$/.test(actor||""))throw fail("Property application link management unauthorized",403);
}
async function getApplicationLink(crm,propertyId){
  if(!Object.hasOwn(PROPERTIES,propertyId))throw fail("Unknown property",400);
  const row=(await crm.store.get("propertylinks",idFor(propertyId)))?.value;
  return {propertyId,propertyName:PROPERTIES[propertyId],active:row?.active===true,url:row?.url||null,updatedAt:row?.updatedAt||null};
}
async function setApplicationLink(crm,propertyId,{url=null,active=false,confirmed=false}={}, {env={},actor="",now=new Date()}={}){
  authorize(crm,env,actor);
  if(!Object.hasOwn(PROPERTIES,propertyId)||confirmed!==true||typeof active!=="boolean")throw fail("Invalid property link update",400);
  if(url!==null && (typeof url!=="string" || !url.trim()))throw fail("Invalid application URL",400);
  const normalized=url===null?null:validateZillowUrl(url);
  if(active && !normalized)throw fail("Active application URL required",400);
  const at=new Date(now).toISOString();
  if(at==="Invalid Date")throw fail("Invalid clock",400);
  const key=idFor(propertyId);
  for(let i=0;i<5;i++){
    const current=await crm.store.get("propertylinks",key);
    const next={id:key,propertyId,scope:crm.scope,url:normalized,active,updatedAt:at,updatedBy:actor};
    try {
      if(!current){if(!await crm.store.create("propertylinks",key,next))continue;}
      else await crm.store.replace("propertylinks",key,next,current.version);
      return {propertyId,active,url:normalized,updatedAt:at};
    }catch(e){if(e instanceof StoreConflict)continue;throw e;}
  }
  throw fail("Concurrent property configuration update");
}
module.exports={PROPERTIES,getApplicationLink,setApplicationLink,authorize};
