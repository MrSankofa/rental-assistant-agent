"use strict";

const crypto=require("crypto");
const {verifyIapIdentity,AUDIENCE}=
  require("../src/http/iapIdentity");

const {CRM}=require("../src/crm/workflows");
const {MemoryStore}=require("../src/crm/storage");

const {privateKey,publicKey}=crypto.generateKeyPairSync(
  "ec",{namedCurve:"prime256v1"}
);

const jwk=publicKey.export({format:"jwk"});
const now=Date.now();
const seconds=Math.floor(now/1000);
const email="authorized@example.test";
const sub="accounts.google.com:123456789012345678901";

const fetchFn=async()=>({
  ok:true,
  json:async()=>({
    keys:[{...jwk,kid:"test-key",alg:"ES256",use:"sig"}]
  })
});

function token(changes={},key=privateKey) {
  const header={alg:"ES256",kid:"test-key",typ:"JWT"};

  const payload={
    iss:"https://cloud.google.com/iap",
    aud:AUDIENCE,
    iat:seconds,
    exp:seconds+600,
    email,
    sub,
    ...changes
  };

  const encode=o=>Buffer.from(
    JSON.stringify(o)
  ).toString("base64url");

  const data=encode(header)+"."+encode(payload);
  const signature=crypto.sign(
    "sha256",Buffer.from(data),
    {key,dsaEncoding:"ieee-p1363"}
  ).toString("base64url");

  return data+"."+signature;
}

const options={
  allowedEmails:email,
  fetchFn,
  now
};

describe("IAP individual staff verification",()=>{
  test("verifies a valid signed staff assertion",async()=>{
    const result=await verifyIapIdentity(
      token(),options
    );

    expect(result.email).toBe(email);
    expect(result.actor).toBe("staff:"+sub);
  });

  test("rejects missing or client-forged assertions",async()=>{
    await expect(
      verifyIapIdentity(undefined,options)
    ).rejects.toHaveProperty("status",403);

    const forged=token();
    const parts=forged.split(".");
    parts[1]=Buffer.from(JSON.stringify({
      iss:"https://cloud.google.com/iap",
      aud:AUDIENCE,
      iat:seconds,
      exp:seconds+600,
      email,
      sub:"accounts.google.com:999999999"
    })).toString("base64url");

    await expect(
      verifyIapIdentity(parts.join("."),options)
    ).rejects.toHaveProperty("status",403);
  });

  test("rejects wrong audience, issuer and expired tokens",async()=>{
    for(const changes of [
      {aud:"wrong-audience"},
      {iss:"https://attacker.example"},
      {exp:seconds-120},
      {iat:seconds+120},
      {email:"unauthorized@example.test"}
    ]) {
      await expect(
        verifyIapIdentity(token(changes),options)
      ).rejects.toHaveProperty("status",403);
    }
  });

  test("rejects a missing staff allowlist",async()=>{
    await expect(
      verifyIapIdentity(token(),{
        fetchFn,now,allowedEmails:""
      })
    ).rejects.toHaveProperty("status",403);
  });

  test("verified actor is recorded in CRM stage history",async()=>{
    const store=new MemoryStore();
    const crm=new CRM(store,"rental-identity-test");

    const intake=await crm.intake({
      name:"Fictional Applicant",
      email:"fictional@example.test",
      preferredChannel:"none",
      domain:"rental",
      targetId:"ziegler",
      source:"unit-test",
      interest:"Property tour",
      consent:{recording:true,email:false,sms:false}
    },{origin:"staff"});

    await crm.transition(intake.engagementId,{
      stage:"TOUR_OFFERED"
    });

    await crm.transition(intake.engagementId,{
      stage:"TOUR_SCHEDULED"
    });

    const identity=await verifyIapIdentity(token(),options);

    await crm.transition(intake.engagementId,{
      stage:"TOUR_COMPLETED",
      evidence:"Staff verified the completed tour"
    },identity.actor);

    const record=await crm.history(intake.engagementId);
    const audits=await store.list("audits");

    expect(record.history.at(-1).actor).toBe(
      "staff:"+sub
    );

    expect(audits.some(a=>
      a.type==="stage-transition" &&
      a.actor==="staff:"+sub &&
      a.entityId===intake.engagementId
    )).toBe(true);
  });
});
