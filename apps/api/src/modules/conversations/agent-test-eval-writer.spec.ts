import {
    canEvalExecuteWriter,
    EVAL_SANDBOX_CONTACT_ID,
    EVAL_WRITABLE_TOOL_NAMES,
    EVAL_WRITER_SANDBOX_FAMILIES,
    EVAL_SANDBOX_MUTATING_TOOL_NAMES,
    isAgentTestSafeToolName,
    isEvalWritableToolName,
    AGENT_TEST_SANDBOX_CONTACT_ID,
} from './agent-test-tool-policy';
import { TOOL_POLICY_REGISTRY } from './tool-policy-registry';

/**
 * The evaluation gate exists to answer one question: after this conversation,
 * does the booking actually exist in the database?
 *
 * It could never answer it. The only executable surface was read-only, so every
 * scenario with expected actions failed for a reason that had nothing to do with
 * the agent — a permanent false negative, which is worse than no gate because it
 * teaches everyone to ignore the red.
 *
 * Opening that door is only safe while it stays this narrow, which is what these
 * tests hold in place.
 */

describe('eval writable tools', () => {
    it('contains exactly the ten isolated mutation families plus the step-up negative gate', () => {
        expect(EVAL_SANDBOX_MUTATING_TOOL_NAMES).toEqual([
            'create_appointment',
            'create_property_booking',
            'create_tour_booking',
            'place_order',
            'book_class',
            'enroll_student',
            'create_service_request',
            'request_photo_quote',
            'create_vehicle_rental',
            'create_pet_boarding',
            'place_catalog_order',
        ]);
        expect(EVAL_WRITABLE_TOOL_NAMES).toEqual([
            ...EVAL_SANDBOX_MUTATING_TOOL_NAMES,
            'file_claim',
        ]);
        for (const [name, family] of Object.entries(EVAL_WRITER_SANDBOX_FAMILIES)) {
            expect(family.status).not.toBe('pending');
            if (name === 'insurance_claims') expect(family.status).toBe('identity_challenge');
            else expect(family.status).toBe('audited');
        }
    });

    it('only contains real writers, never a read dressed up as one', () => {
        for (const name of EVAL_WRITABLE_TOOL_NAMES) {
            expect(TOOL_POLICY_REGISTRY[name]?.effect).toBe('write');
        }
    });

    it('does not quietly widen the read-only test surface', () => {
        // The audited writer must NOT become generally executable in Agent Test:
        // the owner pressing "test" from the dashboard still writes nothing.
        for (const name of EVAL_WRITABLE_TOOL_NAMES) {
            expect(isAgentTestSafeToolName(name)).toBe(false);
        }
    });

    it('demands the eval sandbox contact, not merely the flag', () => {
        expect(canEvalExecuteWriter('create_appointment', EVAL_SANDBOX_CONTACT_ID)).toBe(true);
        // The Agent Test sandbox is a different identity and must stay read-only.
        expect(canEvalExecuteWriter('create_appointment', AGENT_TEST_SANDBOX_CONTACT_ID)).toBe(false);
        // A real customer id can never be written to by an evaluation.
        expect(canEvalExecuteWriter('create_appointment', '11111111-1111-4111-8111-111111111111')).toBe(false);
        expect(canEvalExecuteWriter('create_appointment', undefined)).toBe(false);
    });

    it('refuses writer families that have no isolated eval contract', () => {
        // These suppress nothing: they would send real emails, real payment
        // links and real notifications from a test run.
        for (const name of ['create_payment_link', 'refund_payment', 'apply_discount', 'register_pet']) {
            expect(isEvalWritableToolName(name)).toBe(false);
            expect(canEvalExecuteWriter(name, EVAL_SANDBOX_CONTACT_ID)).toBe(false);
        }
    });

    it('is case-insensitive about the sandbox id but nothing else', () => {
        expect(canEvalExecuteWriter('create_appointment', EVAL_SANDBOX_CONTACT_ID.toUpperCase())).toBe(true);
        expect(canEvalExecuteWriter('CREATE_APPOINTMENT', EVAL_SANDBOX_CONTACT_ID)).toBe(false);
    });
});
