const path = require("node:path");
const { spawnSync } = require("node:child_process");

const validator = path.join(__dirname, "validate-marketing-claims.cjs");
const probes = [
  "18 verticals with pre-configured services and automated support tickets",
  "Tu agente nunca inventa precios y garantiza que dos clientes jamás reserven el mismo horario. Ahorrá 17% anual.",
  "Two-way sync with Google Calendar. You only pay extra if you exceed AI limits.",
  "Automatically reply to comments and DMs on Instagram.",
];

for (const probe of probes) {
  const result = spawnSync(process.execPath, [validator], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      MARKETING_CLAIM_PROBE: probe,
    },
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.error(`Claim-freeze regression failed: the validator accepted: ${probe}`);
    process.exit(1);
  }

  if (!/frozen marketing claim/.test(result.stderr)) {
    console.error("Claim-freeze regression failed for an unexpected reason:\n" + result.stderr);
    process.exit(1);
  }
}

console.log(`Claim-freeze regression passed: ${probes.length} forbidden fixtures were rejected.`);
