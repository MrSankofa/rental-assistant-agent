"use strict";

const LAUNCHER = "/cnb/lifecycle/launcher";

function validateBuildpacksStartup(command, args) {
  if (!Array.isArray(command) || !Array.isArray(args)) {
    throw new Error("Command and args must be arrays");
  }

  // An empty override uses the image's configured entrypoint.
  if (command.length === 0 && args.length === 0) {
    return { valid: true, mode: "image-default" };
  }

  if (
    command.length !== 1 ||
    command[0] !== LAUNCHER ||
    args.length < 1 ||
    !args.every(arg => typeof arg === "string" && arg.length > 0)
  ) {
    throw new Error(
      "Buildpacks startup must use /cnb/lifecycle/launcher"
    );
  }

  const executable = args[0];

  if (executable !== "node" && executable !== "npm") {
    throw new Error("Unsupported Buildpacks startup executable");
  }

  return { valid: true, mode: "explicit-launcher" };
}

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);

  const result = validateBuildpacksStartup(
    command ? [command] : [],
    args
  );

  console.log("BUILDPACKS_STARTUP_GUARD_PASS:", result.mode);
}

module.exports = { validateBuildpacksStartup };
