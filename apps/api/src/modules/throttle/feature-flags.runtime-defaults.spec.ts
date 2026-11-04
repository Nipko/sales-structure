import { CATALOG_OVER_FAQ_FLAG, EVIDENCE_VERIFIER_FLAG, FACTS_LEDGER_FLAG, GO_LIVE_GATE_FLAG, RENDERED_FACTS_FLAG, REQUIRED_READS_APPOINTMENTS_FLAG,
    REQUIRED_READS_CATALOG_FLAG, REQUIRED_READS_LISTINGS_FLAG, REQUIRED_READS_PROPERTIES_FLAG, REQUIRED_READS_RESTAURANTS_FLAG, REQUIRED_READS_TOURS_FLAG,
    SAFETY_TRIAGE_FLAG, WRITE_MODE_CAPABILITY_FLAG, resolveFeatureFlag } from './feature-flags.service';

// Decisión del dueño (4-nov, ADR 0016): el agente medido en E2 es el de todos los tenants.
describe('runtime flags on by default', () => {
    it.each([EVIDENCE_VERIFIER_FLAG, FACTS_LEDGER_FLAG, RENDERED_FACTS_FLAG, CATALOG_OVER_FAQ_FLAG, REQUIRED_READS_RESTAURANTS_FLAG,
        REQUIRED_READS_CATALOG_FLAG, REQUIRED_READS_PROPERTIES_FLAG, REQUIRED_READS_TOURS_FLAG, REQUIRED_READS_LISTINGS_FLAG,
        REQUIRED_READS_APPOINTMENTS_FLAG])('%s: on without a tenant setting, off when the tenant turns it off', key => {
        expect(resolveFeatureFlag({}, key)).toBe(true);
        expect(resolveFeatureFlag({ [key]: false }, key)).toBe(false);
    });

    it.each([GO_LIVE_GATE_FLAG, WRITE_MODE_CAPABILITY_FLAG, SAFETY_TRIAGE_FLAG])('%s stays off by default', key => {
        expect(resolveFeatureFlag({}, key)).toBe(false);
    });
});
