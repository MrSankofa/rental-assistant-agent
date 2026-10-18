const { requestPath } = require("./requestPath");

describe("HTTP route pathname", () => {
  test("homepage is not affected by Cloud Shell query parameters", () => {
    expect(requestPath("/")).toBe("/");
    expect(requestPath("/?authuser=0")).toBe("/");
    expect(requestPath("/?authuser=0&foo=bar")).toBe("/");
  });
  test("API and asset routes ignore query parameters", () => {
    expect(requestPath("/api/crm/status?authuser=0")).toBe("/api/crm/status");
    expect(requestPath("/api/chat?foo=bar")).toBe("/api/chat");
    expect(requestPath("/assets/brand/logo-mark-64.png?version=1")).toBe("/assets/brand/logo-mark-64.png");
  });
});
