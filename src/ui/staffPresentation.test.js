"use strict";

const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(
  path.resolve(__dirname, "../../public/staff.html"),
  "utf8"
);

describe("Live staff presentation", () => {
  test("distinguishes staff messaging from routine production delivery", () => {
    expect(source).toContain(
      "Routine production email follow-ups run separately"
    );
    expect(source).toContain(
      "This staff workspace does not send email or SMS."
    );
    expect(source).not.toContain(
      "Automated messages and follow-up delivery remain disabled."
    );
  });

  test("contact detail lines use real line breaks", () => {
    expect(source).toContain('].join("\\n");');
    expect(source).not.toContain('].join("\\\\n");');
  });
});
