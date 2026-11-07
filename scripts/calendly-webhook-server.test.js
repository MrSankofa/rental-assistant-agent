"use strict";

const http = require("http");
const { server } = require("./calendly-webhook-server");

let port;

beforeAll(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

function request(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path
    }, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({
        status: response.statusCode,
        body: JSON.parse(body)
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("health route responds successfully", async () => {
  const response = await request("GET", "/health");
  expect(response.status).toBe(200);
  expect(response.body.status).toBe("ok");
});

test("webhook cannot process events until activated", async () => {
  const response = await request(
    "POST", "/api/integrations/calendly/webhook"
  );
  expect(response.status).toBe(404);
});

test("receiver exposes no other application routes", async () => {
  expect((await request("GET", "/")).status).toBe(404);
  expect((await request("GET", "/api/crm/status")).status).toBe(404);
  expect((await request("GET", "/staff")).status).toBe(404);
});
