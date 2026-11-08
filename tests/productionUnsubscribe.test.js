"use strict";
const {MemoryStore}=require("../src/crm/storage");
const {tokenFor,contactIdFromToken,suppressByToken,unsubscribeUrl}
  =require("../src/crm/unsubscribe");
const {handler,validate,REQUIRED}=require("../scripts/run-unsubscribe-live");
const secret="a".repeat(64);
const contactId="c_"+"b".repeat(40);
function crm(){
  const store=new MemoryStore();
  store.databaseId="rental-leads-prod";
  return {store,scope:"rental-live"};
}
describe("signed production unsubscribe",()=>{
  test("accepts genuine token but rejects tampering",()=>{
    const token=tokenFor(contactId,secret);
    expect(contactIdFromToken(token,secret)).toBe(contactId);
    expect(contactIdFromToken(token.replace(/.$/,"0"),secret)).toBeNull();
    expect(contactIdFromToken("bad",secret)).toBeNull();
    expect(token.includes("@")).toBe(false);
  });
  test("rejects unsafe service configuration before any database client",()=>{
    expect(()=>validate({...REQUIRED,CRM_UNSUBSCRIBE_SIGNING_SECRET:secret})).not.toThrow();
    expect(()=>validate({...REQUIRED,CRM_UNSUBSCRIBE_SIGNING_SECRET:secret,
      RESEND_API_KEY:"re_test"})).toThrow("unsafe");
    expect(()=>validate({...REQUIRED,CRM_UNSUBSCRIBE_SIGNING_SECRET:secret,
      CRM_DELIVERY_MODE:"enabled"})).toThrow("unauthorized");
  });
  test("signed link contains no email",()=>{
    const url=unsubscribeUrl(contactId,{
      CRM_UNSUBSCRIBE_ORIGIN:"https://rental-unsubscribe-live-951837038410.us-east5.run.app",
      CRM_UNSUBSCRIBE_SIGNING_SECRET:secret
    });
    expect(url).toContain("/unsubscribe/"+contactId+".");
    expect(url).not.toContain("@");
    expect(()=>unsubscribeUrl(contactId,{
      CRM_UNSUBSCRIBE_ORIGIN:"http://example.com",
      CRM_UNSUBSCRIBE_SIGNING_SECRET:secret
    })).toThrow("origin invalid");
  });
  test("POST suppression is monotonic and repeat-safe",async()=>{
    const x=crm();
    await x.store.create("contacts",contactId,{
      id:contactId,email:"synthetic@example.invalid",
      consent:{recording:true,email:true},preferredChannel:"email"
    });
    const token=tokenFor(contactId,secret);
    expect((await suppressByToken(x,token,secret)).outcome).toBe("processed");
    const first=(await x.store.get("contacts",contactId)).value;
    expect(first).toMatchObject({doNotContact:true,suppressionReason:"unsubscribe"});
    expect(first.optedOutAt).toBeTruthy();
    expect((await suppressByToken(x,token,secret)).outcome).toBe("processed");
    const second=(await x.store.get("contacts",contactId)).value;
    expect(second.optedOutAt).toBe(first.optedOutAt);
  });
  test("invalid token cannot write",async()=>{
    const x=crm();
    expect((await suppressByToken(x,"invalid",secret)).outcome).toBe("invalid");
    expect((await x.store.list("contacts")).length).toBe(0);
  });
  test("GET displays confirmation without accessing CRM",async()=>{
    const makeCrm=jest.fn(()=>{throw Error("GET must not read CRM");});
    const route=handler({env:{...REQUIRED,CRM_UNSUBSCRIBE_SIGNING_SECRET:secret},makeCrm});
    const response={writeHead:jest.fn(),end:jest.fn(),headersSent:false};
    await route({url:"/unsubscribe/"+tokenFor(contactId,secret),method:"GET"},response);
    expect(response.writeHead).toHaveBeenCalledWith(200,expect.any(Object));
    expect(response.end.mock.calls[0][0]).toContain("Unsubscribe");
    expect(makeCrm).not.toHaveBeenCalled();
  });
  test("GET invalid token does not access CRM",async()=>{
    const makeCrm=jest.fn();
    const route=handler({env:{...REQUIRED,CRM_UNSUBSCRIBE_SIGNING_SECRET:secret},makeCrm});
    const response={writeHead:jest.fn(),end:jest.fn(),headersSent:false};
    await route({url:"/unsubscribe/"+contactId+"."+"0".repeat(64),method:"GET"},response);
    expect(response.writeHead).toHaveBeenCalledWith(404,expect.any(Object));
    expect(makeCrm).not.toHaveBeenCalled();
  });
});
