const path = require("node:path");
const { spawnSync } = require("node:child_process");

const validator = path.join(__dirname, "validate-marketing-claims.cjs");
const result = spawnSync(process.execPath, [validator], {
  cwd: path.resolve(__dirname, ".."),
  env: {
    ...process.env,
    MARKETING_CLAIM_PROBE: "18 verticals with pre-configured services and automated support tickets",
  },
  encoding: "utf8",
});

if (result.status === 0) {
  console.error("Claim-freeze regression failed: the validator accepted a forbidden fixture.");
  process.exit(1);
}

if (!/frozen marketing claim/.test(result.stderr)) {
  console.error("Claim-freeze regression failed for an unexpected reason:\n" + result.stderr);
  process.exit(1);
}

console.log("Claim-freeze regression passed: forbidden fixture was rejected.");

