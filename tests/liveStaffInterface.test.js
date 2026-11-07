"use strict";

const fs=require("fs");
const path=require("path");
const {summarizeDashboard}=require("../src/crm/staff");

const html=fs.readFileSync(
  path.join(__dirname,"../public/staff.html"),"utf8"
);

describe("Phase 8B staff UI safety",()=>{
  test("live actions default to disabled",()=>{
    const dashboard=summarizeDashboard(
      [],[],[],{workspace:"live"}
    );

    expect(dashboard.actionsEnabled).toBe(false);
    expect(dashboard.deliveryMode).toBe("disabled");
  });

  test("client respects server capability flag",()=>{
    expect(html).toContain(
      "data.actionsEnabled===true"
    );
    expect(html).toContain(
      "Staff actions awaiting authorization setup"
    );
  });

  test("milestone form requires evidence and confirmation",()=>{
    expect(html).toContain("evidence.required=true");
    expect(html).toContain("evidence.minLength=10");
    expect(html).toContain("checkbox.required=true");
    expect(html).toContain("confirmed:true");
  });

  test("application milestones cannot jump to approval",()=>{
    expect(html).toContain(
      'APPLICATION_RECEIVED:"UNDER_LANDLORD_REVIEW"'
    );

    // Approval is now available only from landlord review.
    // The server validates the current stage and verified evidence.
    expect(html).toContain(
      'UNDER_LANDLORD_REVIEW:"APPROVED"'
    );
    expect(html).toContain(
      '"APPROVED","DENIED","MORE_INFO_REQUESTED"'
    );
    expect(html).toContain("humanDecisionConfirmed");
    expect(html).toContain("data.actionsEnabled===true");
  });

  test("live dashboard cannot enable outbound delivery",()=>{
    const dashboard=summarizeDashboard(
      [],[],[],
      {
        workspace:"live",
        deliveryMode:"simulation",
        actionsEnabled:true
      }
    );

    expect(dashboard.deliveryMode).toBe("disabled");
  });
});
