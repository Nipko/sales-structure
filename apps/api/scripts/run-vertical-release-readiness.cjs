const fs = require('node:fs');
const path = require('node:path');

const requiredExternalGates = {
  postgres: Boolean(process.env.DATABASE_URL),
  redis: Boolean(process.env.REDIS_HOST || process.env.REDIS_URL),
  bullmqWorkers: Boolean(process.env.VERTICAL_BULLMQ_READY === 'true'),
  realModelCredentials: Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY),
  realModelEvaluation: Boolean(process.env.VERTICAL_REAL_MODEL_EVAL_READY === 'true'),
  channelSandbox: Boolean(process.env.VERTICAL_CHANNEL_SANDBOX_READY === 'true'),
  providerSandbox: Boolean(process.env.VERTICAL_PROVIDER_SANDBOX_READY === 'true'),
  performanceEnvironment: Boolean(process.env.VERTICAL_PERF_ENV_READY === 'true'),
  chaosEnvironment: Boolean(process.env.VERTICAL_CHAOS_ENV_READY === 'true'),
  rollbackEvidence: Boolean(process.env.VERTICAL_ROLLBACK_EVIDENCE_READY === 'true'),
  canaryEnvironment: Boolean(process.env.VERTICAL_CANARY_READY === 'true'),
};

const canonicalIndustries = new Set([
  'salud', 'moda_belleza', 'inmobiliaria', 'restaurantes', 'automotriz', 'turismo',
  'education', 'finanzas', 'servicios_profesionales', 'retail', 'technology',
  'veterinaria', 'gimnasios', 'seguros', 'servicios_hogar', 'pet_services',
  'fotografia', 'otro',
]);
const requiredArtifactKinds = new Set([
  'postgres_bootstrap', 'redis_bullmq', 'real_model_eval', 'channel_sandbox',
  'provider_sandbox', 'performance', 'chaos', 'rollback', 'canary',
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const RUN_ID_PATTERN = /^\d+$/;

function validateReleaseEvidence() {
  const raw = process.env.VERTICAL_RELEASE_EVIDENCE_JSON;
  if (!raw) return { provided: false, valid: false, reasons: ['release_evidence_missing'] };
  let evidence;
  try {
    evidence = JSON.parse(raw);
  } catch {
    return { provided: true, valid: false, reasons: ['release_evidence_invalid_json'] };
  }

  const reasons = [];
  const issuedAt = Date.parse(String(evidence.issuedAt || ''));
  const expiresAt = Date.parse(String(evidence.expiresAt || ''));
  const certifiedVerticals = Array.isArray(evidence.certifiedVerticals)
    ? evidence.certifiedVerticals : [];
  const artifacts = Array.isArray(evidence.artifacts) ? evidence.artifacts : [];
  if (evidence.version !== 1) reasons.push('release_evidence_version_invalid');
  if (evidence.attestationSource !== 'github_environment_protected') {
    reasons.push('release_evidence_source_invalid');
  }
  if (evidence.approved !== true
      || String(evidence.approvedBy || '').trim().length < 3
      || !/^[A-Za-z0-9._:@/-]{8,200}$/.test(String(evidence.approvalId || ''))) {
    reasons.push('release_evidence_not_approved');
  }
  if (!process.env.GITHUB_SHA || evidence.commitSha !== process.env.GITHUB_SHA) {
    reasons.push('release_evidence_commit_mismatch');
  }
  if (!Number.isFinite(issuedAt)
      || !Number.isFinite(expiresAt)
      || issuedAt > Date.now()
      || expiresAt <= Date.now()
      || expiresAt <= issuedAt
      || expiresAt - issuedAt > 7 * 24 * 60 * 60 * 1000) {
    reasons.push('release_evidence_expired');
  }
  const certifiedVerticalSet = new Set(certifiedVerticals);
  if (certifiedVerticalSet.size !== canonicalIndustries.size
      || certifiedVerticalSet.size !== certifiedVerticals.length
      || certifiedVerticals.some((industry) => !canonicalIndustries.has(industry))
      || [...canonicalIndustries].some((industry) => !certifiedVerticalSet.has(industry))) {
    reasons.push('release_evidence_vertical_scope_invalid');
  }
  const repository = String(process.env.GITHUB_REPOSITORY || '');
  const artifactKinds = new Set();
  if (!repository || artifacts.length !== requiredArtifactKinds.size) {
    reasons.push('release_evidence_artifacts_missing');
  } else {
    for (const artifact of artifacts) {
      const runId = String(artifact?.runId || '');
      const verifiedAt = Date.parse(String(artifact?.verifiedAt || ''));
      const expectedUrlPrefix = `https://github.com/${repository}/actions/runs/${runId}`;
      if (!artifact || typeof artifact !== 'object'
          || !requiredArtifactKinds.has(artifact.kind)
          || artifactKinds.has(artifact.kind)
          || artifact.outcome !== 'passed'
          || artifact.commitSha !== process.env.GITHUB_SHA
          || !RUN_ID_PATTERN.test(runId)
          || typeof artifact.url !== 'string'
          || !artifact.url.startsWith(expectedUrlPrefix)
          || !SHA256_PATTERN.test(String(artifact.sha256 || ''))
          || !Number.isFinite(verifiedAt)
          || verifiedAt < issuedAt
          || verifiedAt > expiresAt) {
        reasons.push(`release_artifact_invalid:${String(artifact?.kind || 'unknown')}`);
      }
      artifactKinds.add(artifact?.kind);
    }
    if ([...requiredArtifactKinds].some((kind) => !artifactKinds.has(kind))) {
      reasons.push('release_evidence_artifact_scope_invalid');
    }
  }
  return {
    provided: true,
    valid: reasons.length === 0,
    reasons,
    certifiedVerticals,
    artifactCount: artifacts.length,
    artifactKinds: artifacts.map((artifact) => artifact?.kind).filter(Boolean).sort(),
    commitSha: evidence.commitSha || null,
    approvalId: evidence.approvalId || null,
    approvedBy: evidence.approvedBy || null,
    issuedAt: evidence.issuedAt || null,
    expiresAt: evidence.expiresAt || null,
  };
}

const releaseEvidence = validateReleaseEvidence();
const externalGatesReady = Object.values(requiredExternalGates).every(Boolean);

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  contractMatrix: { scenarios: 1520, bootstrapCertified: false },
  requiredExternalGates,
  externalGatesReady,
  releaseEvidence,
  attestationStructurallyValid: externalGatesReady && releaseEvidence.valid,
  note: 'This parser only validates the shape and declared scope of a production-environment attestation. It does not verify remote run URLs or artifact digests; protected reviewers must verify and retain those immutable artifacts. This output is not vertical certification.',
};

const output = JSON.stringify(report, null, 2);
const outputFile = process.env.VERTICAL_READINESS_OUTPUT;
if (outputFile) {
  fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
  fs.writeFileSync(outputFile, `${output}\n`, 'utf8');
}
console.log(output);

if (process.env.REQUIRE_EXTERNAL_GATES === 'true' && !report.attestationStructurallyValid) {
  console.error('Release attestation preflight failed closed: external readiness and a structurally valid protected attestation for all 18 verticals bound to this commit are required.');
  process.exit(1);
}
