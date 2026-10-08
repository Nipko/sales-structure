import { createHash } from 'crypto';
import { ToolExecutionControlService, classifyExplicitToolConfirmation } from './tool-execution-control.service';
import { confirmationEffectForPolicy } from '../../common/conversation/intent-normalizer';
import { getToolPolicy, isCancellationTool } from './tool-policy-registry';

/**
 * «sí, cancélala» answers a pending CANCELLATION and nothing else. The cancel verb is the thing being asked, so the phrase
 * is read like its affirmative alone, at the same strength; with any other pending effect it authorises nothing.
 */
const schemaName = 'tenant_cancel_confirmation';
const conversationId = '33333333-3333-4333-8333-333333333333';
const contactId = '22222222-2222-4222-8222-222222222222';
const ledgerId = '66666666-6666-4666-8666-666666666666';

function pendingFor(toolName: string, args: Record<string, unknown>) {
    const row: any = { id: ledgerId, tool_name: toolName, status: 'awaiting_confirmation', request_payload: { args }, confirmation_token: '' };
    const service = new ToolExecutionControlService(
        { executeInTenantSchema: jest.fn(async () => [row]), transactionInTenantSchema: jest.fn() } as any,
        { get: jest.fn().mockReturnValue('pending-confirmation-secret-at-least-32-bytes') } as any,
        { isVerified: jest.fn(), startVerification: jest.fn() } as any,
        { get: jest.fn() } as any,
    );
    const sorted = Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b)));
    row.confirmation_token = (service as any).signConfirmationToken({
        version: 1, tenantId: '11111111-1111-4111-8111-111111111111', contactId, conversationId,
        ledgerId, toolName, argsHash: createHash('sha256').update(JSON.stringify(sorted)).digest('hex'),
        sourceMessageId: '44444444-4444-4444-8444-444444444444', issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(), acceptedReferents: [],
    });
    return (reply: string) => service.findPendingConfirmation(schemaName, conversationId, contactId, reply);
}

const CANCEL_YES = ['sí, cancélala', 'si, cancelala', 'sí, cancélalo', 'sí, anúlala', 'sí, cancélela', 'sí cancela', 'sí, cancelar', 'yes, cancel it', 'yes please cancel it',
    'oui, annulez', 'oui, annulez la', 'sim, pode cancelar', 'sim, cancele'];
const NOT_YES = ['sí, cancélala mañana', 'sí, cancélala pero después', 'no, cancélala', 'cancélala', 'sí, cancélala y agéndame otra', '¿sí, la cancelo?', 'sí, cancélala si hay reembolso'];

describe('a cancellation confirmation recognises «sí + cancel verb» (and only for a pending cancellation)', () => {
    it.each(['cancel_appointment', 'cancel_catalog_order', 'cancel_order', 'cancel_property_booking'])('%s is a cancellation tool', name => {
        expect(isCancellationTool(name)).toBe(true);
    });
    it.each(['create_appointment', 'reschedule_appointment', 'create_payment_link', 'place_catalog_order', 'cancel_made_up_thing', undefined])('%s is not', name => {
        expect(isCancellationTool(name)).toBe(false);
    });

    it.each(CANCEL_YES)('"%s" confirms a pending cancel_appointment', async reply => {
        const find = pendingFor('cancel_appointment', { appointmentId: 'apt-1' });
        expect(await find(reply)).toMatchObject({ toolName: 'cancel_appointment' });
    });

    it.each(CANCEL_YES)('"%s" confirms a pending cancel_catalog_order', async reply => {
        const find = pendingFor('cancel_catalog_order', { orderId: 'ord-1' });
        expect(await find(reply)).toMatchObject({ toolName: 'cancel_catalog_order' });
    });

    it.each(NOT_YES)('"%s" confirms nothing', async reply => {
        const find = pendingFor('cancel_appointment', { appointmentId: 'apt-1' });
        expect(await find(reply)).toBeNull();
    });

    it.each(CANCEL_YES)('"%s" authorises NOTHING when the pending effect is not a cancellation', async reply => {
        for (const [tool, args] of [['create_payment_link', { amount: 5000 }], ['place_catalog_order', { items: [] }], ['reschedule_appointment', { appointmentId: 'apt-1' }],
            ['send_product_image', { sku: 'a' }]] as Array<[string, Record<string, unknown>]>) {
            expect(await pendingFor(tool, args)(reply)).toBeNull();
        }
    });
});

describe('the strength the pending action already requires is unchanged', () => {
    // «ok» / «dale» are contextual yes (medium): enough for a transactional cancellation, never for high impact.
    it.each([
        ['cancel_appointment', 'ok, cancélala', 'transactional'],
        ['cancel_appointment', 'dale, cancélala', 'transactional'],
    ])('%s: "%s" is as strong as the bare opener', (tool, reply) => {
        const effect = confirmationEffectForPolicy(getToolPolicy(tool));
        expect(classifyExplicitToolConfirmation(reply, { effect, pendingTool: tool }))
            .toBe(classifyExplicitToolConfirmation(reply.split(',')[0], { effect, pendingTool: tool }));
    });

    it('a high-impact pending cancellation still needs an unambiguous yes: «ok, cancélala» is exactly as unclear as «ok»', () => {
        expect(classifyExplicitToolConfirmation('ok, cancélala', { effect: 'high_impact', pendingTool: 'cancel_appointment' })).toBe('unclear');
        expect(classifyExplicitToolConfirmation('ok', { effect: 'high_impact', pendingTool: 'cancel_appointment' })).toBe('unclear');
        expect(classifyExplicitToolConfirmation('dale, cancélala', { effect: 'high_impact', pendingTool: 'cancel_appointment' })).toBe('unclear');
        expect(classifyExplicitToolConfirmation('sí, cancélala', { effect: 'high_impact', pendingTool: 'cancel_appointment' })).toBe('confirmed');
    });

    it('without a pending cancellation the phrase is a cancellation request, i.e. rejected, as before', () => {
        for (const effect of ['high_impact', 'transactional'] as const) {
            expect(classifyExplicitToolConfirmation('sí, cancélala', { effect })).not.toBe('confirmed');
            expect(classifyExplicitToolConfirmation('sí, cancélala', { effect, pendingTool: 'create_payment_link' })).not.toBe('confirmed');
            expect(classifyExplicitToolConfirmation('sí, cancélalo', { effect, pendingTool: 'create_payment_link' })).toBe('rejected');
        }
    });

    it('payments, media and the other effects keep rejecting/ignoring bare cancel phrases', () => {
        for (const reply of ['cancélala', 'no, cancélala', 'cancel it']) {
            expect(classifyExplicitToolConfirmation(reply, { effect: 'high_impact', pendingTool: 'create_payment_link' })).not.toBe('confirmed');
            expect(classifyExplicitToolConfirmation(reply, { effect: 'transactional', pendingTool: 'cancel_appointment' })).not.toBe('confirmed');
        }
    });
});
