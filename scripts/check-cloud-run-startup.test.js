"use strict";

const { validateBuildpacksStartup } =
  require("./check-cloud-run-startup");

test("accepts image-default startup", () => {
  expect(validateBuildpacksStartup([], [])).toMatchObject({
    valid: true,
    mode: "image-default"
  });
});

test("accepts explicit Buildpacks launcher", () => {
  expect(validateBuildpacksStartup(
    ["/cnb/lifecycle/launcher"],
    ["node", "scripts/calendly-webhook-server.js"]
  )).toMatchObject({
    valid: true,
    mode: "explicit-launcher"
  });
});

test.each([
  [["node"], ["scripts/calendly-webhook-server.js"]],
  [["npm"], ["start"]],
  [["/bin/sh"], ["-c", "npm start"]],
  [["/cnb/lifecycle/launcher"], []]
])("rejects unsafe Buildpacks startup", (command, args) => {
  expect(() =>
    validateBuildpacksStartup(command, args)
  ).toThrow();
});
