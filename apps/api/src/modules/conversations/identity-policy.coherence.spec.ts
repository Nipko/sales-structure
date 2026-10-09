import { VERTICAL_MANIFEST_INDUSTRIES, ASSURANCE_LEVEL_MATRIX, type ActiveObjectContextItemV1 } from '@parallext/shared';
import {
    activeObjectPolicyFor, appointmentRecordsNeedIdentityCode, filterActiveObjectsForPrompt, tenantActiveObjectPolicyContext,
} from './active-object-policy';
import { APPOINTMENT_RECORD_TOOLS, getToolPolicy, getToolPolicyForContext } from './tool-policy-registry';

/**
 * ONE decision: whether a contact must verify with a code to see or act on their own appointments follows the business type,
 * and the prompt, `list_customer_appointments`, `get_appointment_details`, `cancel_appointment` and `reschedule_appointment`
 * all read it from the same place. Before, the prompt showed a salon's appointments with no code while the engine's own read of
 * the very same records demanded one (the engine never acted in production).
 */
const appointmentItem = (id = 'ae3d0c86-1111-4111-8111-111111111111'): ActiveObjectContextItemV1 =>
    ({ kind: 'appointment', id, status: 'confirmed', statusClass: 'active', source: 'appointments' } as ActiveObjectContextItemV1);
const needsStepUp = (assurance: string) => ASSURANCE_LEVEL_MATRIX[assurance as keyof typeof ASSURANCE_LEVEL_MATRIX].requiresStepUpIdentity;

const SALON = { industry: 'moda_belleza', subtype: 'salon_belleza' };
const CLINIC = { industry: 'salud', subtype: 'consultorio' };

describe('the identity requirement for appointment records follows the business type, for all four tools', () => {
    it('a salon needs no code: the prompt carries its appointments and the four tools run on the contact bound to the chat', () => {
        expect(appointmentRecordsNeedIdentityCode(SALON)).toBe(false);
        expect(filterActiveObjectsForPrompt([appointmentItem()], SALON)).toHaveLength(1);
        for (const name of APPOINTMENT_RECORD_TOOLS) {
            const policy = getToolPolicyForContext(name, SALON)!;
            expect(policy.assurance).toBe('A1');
            expect(needsStepUp(policy.assurance)).toBe(false);
        }
    });

    it('a clinic needs the code: the prompt does not carry its appointments and the four tools demand it', () => {
        expect(appointmentRecordsNeedIdentityCode(CLINIC)).toBe(true);
        expect(filterActiveObjectsForPrompt([appointmentItem()], CLINIC)).toHaveLength(0);
        for (const name of APPOINTMENT_RECORD_TOOLS) {
            const policy = getToolPolicyForContext(name, CLINIC)!;
            expect(policy.assurance).toBe('A2');
            expect(policy.assuranceEnforcement).toBe('step_up');
            expect(needsStepUp(policy.assurance)).toBe(true);
        }
    });

    it('«otro» (an unclassified business could be a clinic) needs the code; aesthetics stays code-free as a deliberate, owner-reviewable decision', () => {
        expect(appointmentRecordsNeedIdentityCode({ industry: 'otro' })).toBe(true);
        expect(appointmentRecordsNeedIdentityCode({ industry: 'otro', subtype: 'general' })).toBe(true);
        expect(filterActiveObjectsForPrompt([appointmentItem()], { industry: 'otro' })).toHaveLength(0);
        expect(appointmentRecordsNeedIdentityCode({ industry: 'moda_belleza', subtype: 'estetica' })).toBe(false);
    });

    it('an unknown or missing vertical fails closed on both sides', () => {
        for (const context of [undefined, {}, { industry: 'otro_mundo' }, { industry: null }]) {
            expect(appointmentRecordsNeedIdentityCode(context as any)).toBe(true);
            expect(filterActiveObjectsForPrompt([appointmentItem()], context as any)).toHaveLength(0);
            for (const name of APPOINTMENT_RECORD_TOOLS) expect(getToolPolicyForContext(name, context as any)!.assurance).toBe('A2');
        }
    });

    it('for EVERY business type the prompt and the four tools agree (no vertical can show the data with no code but ask for one to read it)', () => {
        const subtypes = [undefined, 'general', 'arquitectos', 'consultores', 'peluqueria_canina', 'clinica', 'otro'];
        let checked = 0;
        for (const industry of VERTICAL_MANIFEST_INDUSTRIES) {
            for (const subtype of subtypes) {
                const context = { industry, subtype };
                const promptCarriesIt = filterActiveObjectsForPrompt([appointmentItem()], context).length === 1;
                const exposure = activeObjectPolicyFor('appointment', context);
                expect(promptCarriesIt).toBe(exposure.mode === 'bounded_context');
                for (const name of APPOINTMENT_RECORD_TOOLS) {
                    const policy = getToolPolicyForContext(name, context)!;
                    // visible without a code ⇔ no tool demands one
                    expect(needsStepUp(policy.assurance)).toBe(!promptCarriesIt);
                    expect(policy.assurance).toBe(exposure.minimumAssurance === 'A2' ? 'A2' : 'A1');
                }
                checked += 1;
            }
        }
        expect(checked).toBe(VERTICAL_MANIFEST_INDUSTRIES.length * subtypes.length);
    });

    it('the static registry stays the fail-closed baseline, and the other tools are untouched by the context', () => {
        expect(getToolPolicy('list_customer_appointments')!.assurance).toBe('A2');
        expect(getToolPolicy('get_appointment_details')!.assurance).toBe('A2');
        expect(getToolPolicy('cancel_appointment')!.assurance).toBe('A1');
        for (const name of ['list_my_catalog_orders', 'create_appointment', 'check_policy_status', 'get_treatment_plan']) {
            expect(getToolPolicyForContext(name, SALON)).toEqual(getToolPolicy(name));
            expect(getToolPolicyForContext(name, CLINIC)).toEqual(getToolPolicy(name));
        }
        // a relaxed read is still a contact-scoped read: the data classification follows the lower level
        const relaxed = getToolPolicyForContext('list_customer_appointments', SALON)!;
        expect(relaxed).toMatchObject({ effect: 'read', dataClassification: 'contact', assuranceEnforcement: 'contact_context' });
    });

    it('the tenant projection is the one the prompt reads: verticalConfig wins over the tenant column, unknown values are kept', () => {
        expect(tenantActiveObjectPolicyContext({ industry: 'salud', settings: { verticalConfig: { industry: 'moda_belleza', subType: 'salon_belleza' } } })).toEqual(SALON);
        expect(tenantActiveObjectPolicyContext({ industry: 'salud', settings: {} })).toEqual({ industry: 'salud', subtype: undefined });
        expect(tenantActiveObjectPolicyContext(null)).toEqual({ industry: undefined, subtype: undefined });
    });
});
