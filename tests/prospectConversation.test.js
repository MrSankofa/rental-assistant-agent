"use strict";
const {MemoryStore}=require("../src/crm/storage");
const {loadConversation,appendConversation,MAX_TURNS}=require("../src/crm/prospectConversation");
const id="e_"+"a".repeat(40);
const pair=(n)=>[{role:"user",content:"Question "+n},{role:"assistant",content:"Answer "+n}];
describe("Phase 21 bounded durable conversation",()=>{
 test("persists and loads previous turns, never stores contact credentials",async()=>{
   const store=new MemoryStore();
   const first=await loadConversation(store,id);
   expect(first).toEqual({turns:[],version:null});
   await appendConversation(store,id,null,pair(1),{now:1000});
   const result=await loadConversation(store,id,{now:2000});
   expect(result.turns).toEqual(pair(1));
   expect(JSON.stringify(await store.list("prospectconversations"))).not.toContain("sessionToken");
 });
 test("rejects stale competing tab update",async()=>{
   const store=new MemoryStore();
   await appendConversation(store,id,null,pair(1),{now:1000});
   const snapshot=await loadConversation(store,id,{now:2000});
   await appendConversation(store,id,snapshot.version,pair(2),{now:3000});
   await expect(appendConversation(store,id,snapshot.version,pair(3),{now:4000}))
     .rejects.toMatchObject({status:409});
 });
 test("conversation window is capped and retention expires",async()=>{
   const store=new MemoryStore();
   for(let i=0;i<15;i++){
     const snapshot=await loadConversation(store,id,{now:1000+i});
     await appendConversation(store,id,snapshot.version,pair(i),{now:1000+i});
   }
   const row=await loadConversation(store,id,{now:2000});
   expect(row.turns).toHaveLength(MAX_TURNS);
   expect(row.turns[0].content).toBe("Question 5");
   expect((await loadConversation(store,id,{now:31*86400000})).turns).toEqual([]);
 });
 test("rejects invalid or oversized input",async()=>{
   const store=new MemoryStore();
   await expect(loadConversation(store,"e_bad")).rejects.toMatchObject({status:400});
   await expect(appendConversation(store,id,null,[
     {role:"user",content:"x".repeat(4001)},{role:"assistant",content:"ok"}
   ])).rejects.toMatchObject({status:400});
 });
});
