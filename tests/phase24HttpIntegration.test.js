"use strict";

const http=require("http");

jest.mock("../src/crm/storage",()=>{
  const actual=jest.requireActual("../src/crm/storage");
  const store=new actual.MemoryStore();
  return {
    ...actual,
    makeStore:()=>store,
    __testStore:store
  };
});

jest.mock("../src/http/iapIdentity",()=>({
  verifyIapIdentity:jest.fn(async assertion=>{
    if(assertion!=="fictional-valid-iap-assertion"){
      throw Object.assign(new Error("Forbidden"),{status:403});
    }
    return {
      actor:"staff:accounts.google.com:123456789",
      email:"fictional-owner@example.test"
    };
  })
}));

jest.mock("../src/http/prospectSessionRoutes",()=>{
  const actual=jest.requireActual(
    "../src/http/prospectSessionRoutes"
  );
  return {
    ...actual,
    handleProspectSession:jest.fn(async()=>false)
  };
});

const env={
  K_SERVICE:"rental-assistant-staff-live",
  CRM_STAFF_ENABLED:"true",
  CRM_REAL_STAFF_ENABLED:"true",
  CRM_LIVE_STAFF_ACTIONS_ENABLED:"true",
  CRM_BACKEND:"firestore",
  CRM_DATABASE:"rental-leads-prod",
  CRM_SCOPE:"rental-live",
  GOOGLE_CLOUD_PROJECT:"altruistic-platform",
  CRM_DELIVERY_MODE:"disabled",
  CRM_PRODUCTION_EMAIL_ENABLED:"false",
  PHASE24_PARALLEL_MILESTONES_ENABLED:"true",
  CRM_PUBLIC_INTAKE_ENABLED:"false",
  CRM_REAL_INTAKE_ENABLED:"false",
  CRM_STAGING_TEST_MODE:"false"
};

const previous={};
for(const [key,value] of Object.entries(env)){
  previous[key]=process.env[key];
  process.env[key]=value;
}

const {server}=require("../server");
const {__testStore:store}=require("../src/crm/storage");

const engagementId="e_phase24httpfictional001";
const host="phase24-test.us-east5.run.app";

let port;

function request(pathname,{
  method="POST",
  origin="https://"+host,
  assertion="fictional-valid-iap-assertion",
  body={
    track:"lease",
    status:"prepared",
    confirmed:true,
    evidence:"Owner independently verified document preparation",
    eventId:"fictional_http_event_001"
  }
}={}){
  return new Promise((resolve,reject)=>{
    const data=JSON.stringify(body);

    const req=http.request({
      hostname:"127.0.0.1",
      port,
      path:pathname,
      method,
      headers:{
        Host:host,
        Origin:origin,
        "Content-Type":"application/json",
        "Content-Length":Buffer.byteLength(data),
        "X-Goog-Iap-Jwt-Assertion":assertion
      }
    },res=>{
      const chunks=[];
      res.on("data",c=>chunks.push(c));
      res.on("end",()=>{
        const raw=Buffer.concat(chunks).toString();
        let parsed;
        try {parsed=JSON.parse(raw);}
        catch {parsed={raw};}
        resolve({status:res.statusCode,body:parsed});
      });
    });

    req.on("error",reject);
    req.end(data);
  });
}

const endpoint=
  "/api/staff/engagements/"+engagementId+
  "/parallel-milestones";

beforeAll(async()=>{
  await store.create("engagements",engagementId,{
    id:engagementId,
    domain:"rental",
    targetId:"ziegler",
    stage:"APPROVED",
    handoff:{
      decision:{
        status:"approved",
        reference:"fictional_owner_approved"
      }
    },
    history:[]
  });

  await new Promise(resolve=>
    server.listen(0,"127.0.0.1",resolve)
  );

  port=server.address().port;
});

afterAll(async()=>{
  await new Promise((resolve,reject)=>
    server.close(error=>error?reject(error):resolve())
  );

  for(const [key,value] of Object.entries(previous)){
    if(value===undefined) delete process.env[key];
    else process.env[key]=value;
  }
});

describe("Phase 24 real HTTP routing",()=>{
  test("rejects incorrect browser origin",async()=>{
    const result=await request(endpoint,{
      origin:"https://untrusted.example.test"
    });
    expect(result.status).toBe(403);
  });

  test("rejects missing or unverified staff assertion",async()=>{
    const result=await request(endpoint,{assertion:""});
    expect(result.status).toBe(403);
  });

  test("feature flag disables write endpoint",async()=>{
    const old=process.env.PHASE24_PARALLEL_MILESTONES_ENABLED;
    process.env.PHASE24_PARALLEL_MILESTONES_ENABLED="false";

    try{
      const result=await request(endpoint);
      expect(result.status).toBe(403);
    }finally{
      process.env.PHASE24_PARALLEL_MILESTONES_ENABLED=old;
    }
  });

  test("rejects unconfirmed milestone",async()=>{
    const result=await request(endpoint,{
      body:{
        track:"lease",
        status:"prepared",
        confirmed:false,
        evidence:"Owner independently verified preparation",
        eventId:"fictional_http_rejected_001"
      }
    });
    expect(result.status).toBe(403);
  });

  test("authorized milestone writes and retries safely",async()=>{
    const first=await request(endpoint);
    const retry=await request(endpoint);

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(first.body.parallelMoveIn.tracks.lease.status)
      .toBe("prepared");

    const row=await store.get("engagements",engagementId);
    expect(row.value.parallelMoveIn.events).toHaveLength(1);

    const audits=await store.list("audits");
    expect(audits).toHaveLength(1);
  });

  test("old key-release endpoint is blocked",async()=>{
    const result=await request(
      "/api/staff/engagements/"+engagementId+"/stage",
      {
        body:{
          stage:"KEYS_RELEASED",
          confirmed:true,
          evidence:"Fictional owner confirms physical handover"
        }
      }
    );

    expect(result.status).toBe(409);
  });

  test("wrong HTTP method cannot modify milestones",async()=>{
    const result=await request(endpoint,{method:"PUT"});
    expect(result.status).toBe(403);
  });
});
