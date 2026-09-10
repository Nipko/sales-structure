import {
    AGENT_OPERATIONAL_STATES, AGENT_QUALITY_STATUSES, isAgentOperationalState, isOperationalStateServing,
    operationalStateFromCheck, operationalStateFromCredentialHealth, operationalStateFromKnownFlag,
    operationalStateFromPillar, operationalStateFromQuality, operationalStateNeedsAttention,
    rollUpOperationalState,
} from '@parallext/shared';

/**
 * One vocabulary, and the two things it must never do.
 *
 * Six vocabularies were in use at once across Inicio, the onboarding card, the
 * editor, Salud, the tours and Assist, so a tenant could read three sentences
 * about the same agent with no way to know whether they agreed. These cases pin
 * the mapping, and then pin the two rules that make the shared word worth
 * having: a part nobody could read never becomes "operating", and a part that
 * broke is never averaged away by the green ones around it.
 */
describe('the state an agent is said to be in', () => {
    it('maps every quality status onto a state, with no silent default', () => {
        for (const status of AGENT_QUALITY_STATUSES) {
            expect(isAgentOperationalState(operationalStateFromQuality(status))).toBe(true);
        }
        expect(operationalStateFromQuality('operating_with_evidence')).toBe('operating');
        expect(operationalStateFromQuality('ready_for_pilot')).toBe('tested');
        expect(operationalStateFromQuality('configuration_incomplete')).toBe('pending');
        expect(operationalStateFromQuality('at_risk')).toBe('degraded');
        expect(operationalStateFromQuality('review_required')).toBe('degraded');
        expect(operationalStateFromQuality('not_evaluated')).toBe('pending');
    });

    it('answers unknown for anything it was not given', () => {
        expect(operationalStateFromQuality(undefined)).toBe('unknown');
        expect(operationalStateFromQuality('nonsense' as any)).toBe('unknown');
        expect(operationalStateFromCheck(undefined)).toBe('unknown');
        expect(operationalStateFromPillar(undefined)).toBe('unknown');
        expect(operationalStateFromCredentialHealth(undefined)).toBe('unknown');
    });

    it('says unknown for a check whose source could not be read, whatever the check says', () => {
        // An unreadable table is not an empty table, and a passing check over a
        // source nobody reached is not a pass.
        expect(operationalStateFromCheck('pass', { sourceAvailable: false })).toBe('unknown');
        expect(operationalStateFromCheck('fail', { sourceAvailable: false })).toBe('unknown');
        expect(operationalStateFromCheck('pass')).toBe('prepared');
        expect(operationalStateFromCheck('warning')).toBe('degraded');
        expect(operationalStateFromCheck('fail')).toBe('pending');
    });

    it('drops a check that does not apply instead of counting it against the agent', () => {
        expect(operationalStateFromCheck('not_applicable')).toBeNull();
        expect(rollUpOperationalState(['operating', operationalStateFromCheck('not_applicable')]))
            .toBe('operating');
    });

    it('reads an unreadable credential as unknown and an expiring one as degraded', () => {
        expect(operationalStateFromCredentialHealth('ok')).toBe('operating');
        expect(operationalStateFromCredentialHealth('unknown')).toBe('unknown');
        expect(operationalStateFromCredentialHealth('expiring')).toBe('degraded');
        expect(operationalStateFromCredentialHealth('revoked')).toBe('degraded');
        expect(operationalStateFromCredentialHealth('missing')).toBe('pending');
    });

    it('keeps the third answer a boolean cannot hold', () => {
        expect(operationalStateFromKnownFlag(true)).toBe('operating');
        expect(operationalStateFromKnownFlag(false)).toBe('pending');
        // The case the onboarding contract insists on: not known is not absent.
        expect(operationalStateFromKnownFlag(undefined)).toBe('unknown');
        expect(operationalStateFromKnownFlag(null)).toBe('unknown');
        expect(operationalStateFromKnownFlag(true, 'prepared')).toBe('prepared');
    });

    it('lets one broken part make the whole broken, however green the rest is', () => {
        expect(rollUpOperationalState(['operating', 'operating', 'degraded'])).toBe('degraded');
        // Even over an unknown: something demonstrably stopped outranks something
        // nobody could read.
        expect(rollUpOperationalState(['unknown', 'degraded'])).toBe('degraded');
    });

    it('never claims a whole is operating while one of its parts is unreadable', () => {
        expect(rollUpOperationalState(['operating', 'operating', 'unknown'])).toBe('unknown');
        expect(rollUpOperationalState(['tested', 'unknown'])).toBe('unknown');
    });

    it('lets the least advanced part speak when everything is known and healthy', () => {
        expect(rollUpOperationalState(['operating', 'tested', 'prepared'])).toBe('prepared');
        expect(rollUpOperationalState(['operating', 'pending'])).toBe('pending');
        expect(rollUpOperationalState(['operating', 'operating'])).toBe('operating');
    });

    it('answers unknown for a whole with no parts rather than inventing one', () => {
        expect(rollUpOperationalState([])).toBe('unknown');
        expect(rollUpOperationalState([null, undefined])).toBe('unknown');
    });

    it('only calls the agent serving when it is actually serving', () => {
        expect(AGENT_OPERATIONAL_STATES.filter(isOperationalStateServing)).toEqual(['operating']);
        expect(AGENT_OPERATIONAL_STATES.filter(operationalStateNeedsAttention).sort())
            .toEqual(['degraded', 'unknown']);
    });
});
