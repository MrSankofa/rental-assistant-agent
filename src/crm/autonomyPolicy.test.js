const {routeFollowup}=require("./autonomyPolicy");
const baseline={domain:"rental",targetId:"ziegler",stage:"CONTACT_CAPTURED"};
const contact={email:"fictional@example.test",preferredChannel:"email",consent:{recording:true,email:true}};
test("routine opt-in follow-up routes without message-level approval",()=>{
 expect(routeFollowup(contact,baseline)).toBe("autonomous");
 expect(routeFollowup(contact,{...baseline,stage:"TOUR_OFFERED"})).toBe("autonomous");
});
test("missing explicit email opt-in or opt-out routes to review",()=>{
 expect(routeFollowup({...contact,consent:{recording:true,email:false}},baseline)).toBe("staff-review");
 expect(routeFollowup({...contact,doNotContact:true},baseline)).toBe("staff-review");
 expect(routeFollowup({...contact,preferredChannel:"sms"},baseline)).toBe("staff-review");
});
test("application decisions and unavailable properties never auto-communicate",()=>{
 for(const stage of ["APPLICATION_RECEIVED","UNDER_LANDLORD_REVIEW","APPROVED","DENIED","KEYS_RELEASED"]){
   expect(routeFollowup(contact,{...baseline,stage})).toBe("staff-review");
 }
 expect(routeFollowup(contact,{...baseline,targetId:"virginia"})).toBe("staff-review");
});
