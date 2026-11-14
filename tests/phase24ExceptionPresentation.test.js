"use strict";
const fs=require("fs");
const vm=require("vm");
const html=fs.readFileSync("public/staff.html","utf8");
const server=fs.readFileSync("server.js","utf8");

describe("Phase 24 exception display",()=>{
  test("browser scripts parse",()=>{
    const scripts=[...html.matchAll(
      /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g
    )].map(match=>match[1]);
    expect(scripts.length).toBeGreaterThan(0);
    scripts.forEach(s=>new vm.Script(s));
  });

  test("exception panel requires server feature flag",()=>{
    expect(html).toContain("data.phase24Enabled===true");
    expect(html).toContain("inspection incomplete");
    expect(html).toContain("report?.issues");
  });

  test("server does not report clean on audit read failure",()=>{
    expect(server).toContain("buildPhase24ExceptionReport");
    expect(server).toContain('coverage:"unavailable"');
    expect(server).toContain("requiresStaffReview:true");
  });
});
