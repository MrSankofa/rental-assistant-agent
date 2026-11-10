"use strict";
const { EventEmitter } = require("events");
const { MemoryStore } = require("../src/crm/storage");
const { issueReturnLink } = require("../src/crm/prospectIdentity");
const { handleProspectSession, parseSessionCookie, authorizedOrigin } =
  require("../src/http/prospectSessionRoutes");

const origin = "https://rental.example.test";
const contactId = "c_" + "a".repeat(40);
const engagementId = "e_" + "b".repeat(40);
const env = {PUBLIC_ORIGIN: origin, PROSPECT_SESSION_ENABLED:"true"};
function response() {
  const res = {status:0,headers:{},body:""};
  res.writeHead = (status,headers) => {res.status=status;res.headers=headers;};
  res.end = body => {res.body=JSON.parse(body);};
  return res;
}
function request(method, pathname, headers={}, payload) {
  const req = new EventEmitter();
  req.method=method;
  req.headers=headers;
  req[Symbol.asyncIterator] = async function* () {
    if (payload !== undefined) yield Buffer.from(JSON.stringify(payload));
  };
  return {req,res:response(),pathname};
}
async function fixture() {
  const store = new MemoryStore();
  await store.create("contacts", contactId,
    {id:contactId,email:"fictional@example.test",name:"Fictional"});
  await store.create("engagements", engagementId,
    {id:engagementId,contactId,targetId:"ziegler",domain:"rental",
      stage:"TOUR_SCHEDULED",nextAction:"Attend showing"});
  return {store,crm:{store}};
}
async function invoke(input, crm, environment=env) {
  const handled = await handleProspectSession({...input,crm,env:environment});
  return {handled,...input.res};
}
describe("Phase 21 prospect session HTTP boundary", () => {
  test("disabled by default, no endpoint exposure", async () => {
    const {crm} = await fixture();
    const x = request("GET","/api/prospect/context");
    expect((await invoke(x,crm,{PUBLIC_ORIGIN:origin})).handled).toBe(false);
  });
  test("same-origin exchange creates HttpOnly cookie and scoped context", async () => {
    const {store,crm} = await fixture();
    const {token} = await issueReturnLink(store,
      {contactId,engagementId,email:"fictional@example.test"});
    const exchange = request("POST","/api/prospect/session",
      {origin,"content-type":"application/json"}, {token});
    const sent = await invoke(exchange,crm);
    expect(sent.status).toBe(200);
    expect(sent.body.sessionToken).toBeUndefined();
    const setCookie=sent.headers["Set-Cookie"];
    expect(setCookie).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const rawCookie=setCookie.split(";")[0];
    const context = await invoke(request("GET","/api/prospect/context",
      {cookie:rawCookie}),crm);
    expect(context.status).toBe(200);
    expect(context.body).toEqual({propertyId:"ziegler",
      stage:"TOUR_SCHEDULED",nextAction:"Attend showing",prospectName:"Fictional"});
    const replay=await invoke(request("POST","/api/prospect/session",
      {origin,"content-type":"application/json"},{token}),crm);
    expect(replay.status).toBe(401);
    const logout=await invoke(request("DELETE","/api/prospect/session",
      {origin,"content-type":"application/json",cookie:rawCookie}),crm);
    expect(logout.status).toBe(200);
    expect((await invoke(request("GET","/api/prospect/context",
      {cookie:rawCookie}),crm)).status).toBe(401);
  });
  test("rejects cross-site exchange, missing session and malformed cookies", async () => {
    const {crm} = await fixture();
    const denied=await invoke(request("POST","/api/prospect/session",
      {origin:"https://attacker.example","content-type":"application/json"},
      {token:"a".repeat(43)}),crm);
    expect(denied.status).toBe(403);
    expect((await invoke(request("GET","/api/prospect/context"),crm)).status).toBe(401);
    expect(parseSessionCookie("__Host-rental_prospect=x")).toBeNull();
    expect(parseSessionCookie("__Host-rental_prospect="+"a".repeat(43)+"; __Host-rental_prospect="+"b".repeat(43))).toBeNull();
    expect(authorizedOrigin({origin,"content-type":"text/plain"},origin)).toBe(false);
  });
});
