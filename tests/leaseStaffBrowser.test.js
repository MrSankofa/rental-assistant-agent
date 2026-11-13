"use strict";
const fs=require("fs");
const path=require("path");
const vm=require("vm");
describe("Phase 23M-3C lease owner browser integration",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../public/staff.html"),"utf8");
 const server=fs.readFileSync(path.join(__dirname,"../server.js"),"utf8");
 test("browser code parses and retains explicit review before approval",()=>{
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
  expect(scripts.length).toBeGreaterThan(0);
  scripts.forEach(s=>new vm.Script(s));
  expect(html).toContain('Download unapproved review copy');
  expect(html).toContain('I reviewed this exact DOCX');
  expect(html).toContain('Download approved DOCX');
 });
 test("feature hidden by default; only displayed from server flag",()=>{
  expect(html).toContain('id="leaseOwnerSection" hidden');
  expect(html).toContain('data.leaseOwnerWorkflowEnabled===true');
  expect(server).toContain('dashboard.leaseOwnerWorkflowEnabled = leaseWorkflowEnabled;');
  expect(server).toContain('handleLeaseOwnerRoute({req,res,pathname,');
 });
});
