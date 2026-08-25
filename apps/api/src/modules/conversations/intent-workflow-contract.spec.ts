import {
    FIRST_DETERMINISTIC_WORKFLOW_QUEUE,
    classifyIntentWorkflow,
    resolveIntentWorkflow,
    transitionDeterministicWorkflow,
    type IntentContract,
} from '@parallext/shared';

const intent = (overrides: Partial<IntentContract> = {}): IntentContract => ({
    key: 'lookup', description: 'lookup', slots: [], toolPlan: ['get_item'],
    confirmation: 'none', fallback: 'answer', states: ['ready', 'completed'], commits: false,
    ...overrides,
});

describe('P29 hybrid workflow contract', () => {
    it('declares the complete first deterministic queue with auditable lifecycle controls', () => {
        expect(FIRST_DETERMINISTIC_WORKFLOW_QUEUE).toHaveLength(10);
        expect(new Set(FIRST_DETERMINISTIC_WORKFLOW_QUEUE.map((workflow) => workflow.id)).size).toBe(10);
        for (const workflow of FIRST_DETERMINISTIC_WORKFLOW_QUEUE) {
            expect(workflow.states).toContain(workflow.initialState);
            expect(workflow.terminalStates.length).toBeGreaterThan(0);
            expect(workflow.expiresAfterSeconds).toBeGreaterThan(0);
            expect(workflow.resumable).toBe(true);
            expect(workflow.cancellable).toBe(true);
            expect(workflow.idempotencyKey).toBeTruthy();
            expect(workflow.recovery).toContain('handoff');
        }
    });

    it('classifies informational, guided, transactional and regulated intents mechanically', () => {
        expect(classifyIntentWorkflow(intent())).toBe('informational');
        expect(classifyIntentWorkflow(intent({ fallback: 'ask', toolPlan: ['search_item'] }))).toBe('guided');
        expect(classifyIntentWorkflow(intent({ commits: true, toolPlan: ['place_catalog_order'] }))).toBe('transactional');
        expect(classifyIntentWorkflow(intent({ slots: [{ key: 'policy', type: 'text', required: true, sensitivity: 'regulated', source: 'customer', persistence: 'never' }] }))).toBe('regulated');
    });

    it('keeps product and regulated workflows fail-closed while native rental can run', () => {
        const checkout = resolveIntentWorkflow({
            profileId: 'retail/marketplace',
            intent: intent({ key: 'checkout', commits: true, toolPlan: ['get_product', 'check_stock', 'place_catalog_order'] }),
        });
        expect(checkout).toMatchObject({ workflowId: 'marketplace.checkout', readiness: 'blocked_product', mayExecute: false, nextStateAuthority: 'backend_workflow' });

        const rental = resolveIntentWorkflow({
            profileId: 'automotriz/alquiler',
            intent: intent({ key: 'rental', commits: true, toolPlan: ['check_vehicle_rental_availability', 'create_vehicle_rental'] }),
        });
        expect(rental).toMatchObject({ workflowId: 'resource.rental', readiness: 'ready', mayExecute: true, defaultDeny: true });
    });

    it('rejects invalid and terminal transitions and supports recovery resume', () => {
        const payments = FIRST_DETERMINISTIC_WORKFLOW_QUEUE.find((workflow) => workflow.id === 'payments.link_and_status')!;
        expect(transitionDeterministicWorkflow(payments, 'collecting', 'confirmed')).toEqual({ accepted: false, state: 'collecting', reason: 'invalid_transition' });
        expect(transitionDeterministicWorkflow(payments, 'recovery', 'resume')).toEqual({ accepted: true, state: 'creating_link' });
        expect(transitionDeterministicWorkflow(payments, 'paid', 'resume')).toEqual({ accepted: false, state: 'paid', reason: 'terminal' });
    });
});
