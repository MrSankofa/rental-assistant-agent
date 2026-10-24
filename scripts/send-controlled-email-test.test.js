const {main,testMessage,guardEnvironment}=require("./send-controlled-email-test");
const env={CLOUD_RUN_JOB:"rental-email-test-staging",GOOGLE_CLOUD_PROJECT:"altruistic-platform",EMAIL_TEST_MODE:"staging-manual-only"};
test("dry-run default does not call Resend",async()=>{
 const transport=jest.fn();
 expect(await main({env,transport,log:()=>{}})).toEqual({sending:false});
 expect(transport).not.toHaveBeenCalled();
});
test("requires explicit approval before sending",async()=>{
 const transport=jest.fn();
 await expect(main({env:{...env,EMAIL_TEST_ENABLED:"true"},transport,log:()=>{}}))
 .rejects.toThrow("Explicit manual approval required");
 expect(transport).not.toHaveBeenCalled();
});
test("only explicit recipient and approved isolated job invokes transport",async()=>{
 const transport=jest.fn().mockResolvedValue({status:"accepted",provider:"resend",providerId:"test123"});
 const result=await main({env:{...env,EMAIL_TEST_ENABLED:"true",
 EMAIL_TEST_APPROVAL:"SEND_ONE_TEST_EMAIL",EMAIL_TEST_TO:"owner@gmail.com",
 RESEND_API_KEY:"re_test_example"},transport,log:()=>{}});
 expect(result.status).toBe("accepted");
 expect(transport).toHaveBeenCalledTimes(1);
 expect(transport.mock.calls[0][0].to).toBe("owner@gmail.com");
 expect(transport.mock.calls[0][0].idempotencyKey).toMatch(/^rental-test-/);
});
test("never allows fixture-only test addresses",()=>{
 expect(()=>testMessage("fictional@example.test")).toThrow("Valid user-approved");
});
test("refuses wrong execution identity",()=>{
 expect(()=>guardEnvironment({...env,CLOUD_RUN_JOB:"rental-followups-staging"})).toThrow("Refusing");
});
