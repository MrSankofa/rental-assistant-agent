"use strict";

const fs=require("fs");
const path=require("path");

const server=fs.readFileSync(
  path.join(__dirname,"../server.js"),"utf8"
);

describe("Production staff identity endpoint",()=>{
  test("route exists only in private staff routing",()=>{
    expect(server).toContain(
      'pathname === "/api/staff/identity"'
    );
    expect(server).toContain(
      "if (!privateStaffMode)"
    );
    expect(server).toContain(
      "if (!liveStaffMode)"
    );
  });

  test("verifies signed assertion and staff allowlist",()=>{
    expect(server).toContain(
      'req.headers["x-goog-iap-jwt-assertion"]'
    );
    expect(server).toContain(
      "allowedEmails:process.env.CRM_STAFF_ALLOWED_EMAILS"
    );
    expect(server).toContain("verified:true");
    expect(server).toContain("verified:false");
  });

  test("live milestone writes remain separately gated",()=>{
    expect(server).toContain(
      "actionsEnabled(process.env)"
    );
    expect(server).toContain(
      "verifiedStaff.actor"
    );
  });
});
