"use strict";

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(
  path.resolve(__dirname, "../../public/index.html"),
  "utf8"
);

describe("Turnstile browser initialization", () => {
  test("Cloudflare onload callback invokes rendering", () => {
    const match = html.match(
      /window\.onRentalTurnstileLoaded = \(\) => \{([\s\S]*?)\n    \};/
    );

    expect(match).not.toBeNull();

    const renderTurnstile = jest.fn();
    const executeCallback = new Function(
      "renderTurnstile",
      match[1]
    );

    executeCallback(renderTurnstile);

    expect(renderTurnstile).toHaveBeenCalledTimes(1);
  });

  test("uses Cloudflare explicit rendering callback", () => {
    expect(html).toContain(
      "api.js?render=explicit&onload=onRentalTurnstileLoaded"
    );

    expect(html).toContain(
      'typeof window.turnstile.render !== "function"'
    );

    expect(html).toContain(
      'turnstileWidgetId !== null'
    );

    expect(html).toContain(
      'action: "rental_inquiry"'
    );

    expect(html).not.toContain("script.onload =");
  });

  test("keeps server verification token wired to intake", () => {
    expect(html).toContain(
      "window.turnstile.getResponse(turnstileWidgetId)"
    );

    expect(html).toContain(
      'fetch("/api/crm/intake"'
    );
  });
});

test("defers Turnstile until its parent form is visible", () => {
  const openForm = html.match(
    /function openLeadForm\(mode\) \{([\s\S]*?)\n    \}/
  );
  expect(openForm).not.toBeNull();
  expect(openForm[1]).toMatch(
    /contactIntakeTurn\.hidden = false;[\s\S]*?renderTurnstile\(\)/
  );

  const renderFunction = html.match(
    /renderTurnstile = \(\) => \{([\s\S]*?)\n        \};/
  );
  expect(renderFunction).not.toBeNull();
  expect(renderFunction[1]).toContain(
    "if (contactIntakeTurn.hidden || contactIntake.hidden) return;"
  );
});
