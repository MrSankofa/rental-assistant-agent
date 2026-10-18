"use strict";

// Query parameters (including Cloud Shell's ?authuser=0) are not routes.
function requestPath(rawUrl) {
  return new URL(rawUrl || "/", "http://localhost").pathname;
}

module.exports = { requestPath };
