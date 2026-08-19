import { ToolExecutionControlService } from './tool-execution-control.service';

/**
 * Reading the operation the conversation is waiting a yes/no for.
 *
 * Until this existed, a confirmed operation could only execute if the model
 * spontaneously re-issued the identical tool call with byte-identical arguments,
 * out of a history that contains no tool calls at all. When it answered in prose
 * nothing ran and the customer was told it was done anyway; when it rebuilt the
 * arguments and a date format differed, the hash changed and the guard asked for
 * confirmation again over something already confirmed.
 */

const schemaName = 'tenant_pending_confirmation';
const conversationId = '33333333-3333-4333-8333-333333333333';
const contactId = '22222222-2222-4222-8222-222222222222';
const ledgerId = '66666666-6666-4666-8666-666666666666';

function createService(rows: any[] | Error) {
    const executeInTenantSchema = jest.fn(async () => {
        if (rows instanceof Error) throw rows;
        return rows;
    });
    const service = new ToolExecutionControlService(
        { executeInTenantSchema, transactionInTenantSchema: jest.fn() } as any,
        { get: jest.fn().mockReturnValue('pending-confirmation-secret-at-least-32-bytes') } as any,
        { isVerified: jest.fn(), startVerification: jest.fn() } as any,
        { get: jest.fn() } as any,
    );
    return { service, executeInTenantSchema };
}

const pendingRow = {
    id: ledgerId,
    tool_name: 'create_property_booking',
    status: 'awaiting_confirmation',
    request_payload: {
        args: { propertyId: 'prop-1', checkIn: '2026-08-20', checkOut: '2026-08-22', guests: 2 },
    },
};

describe('ToolExecutionControlService.findPendingConfirmation', () => {
    it('returns the pending operation with the arguments the customer was shown', async () => {
        const { service, executeInTenantSchema } = createService([pendingRow]);

        const pending = await service.findPendingConfirmation(schemaName, conversationId, contactId);

        expect(pending).toEqual({
            ledgerId,
            toolName: 'create_property_booking',
            args: { propertyId: 'prop-1', checkIn: '2026-08-20', checkOut: '2026-08-22', guests: 2 },
        });
        // Only a live, signed, unexpired challenge qualifies: an expired one must
        // be re-issued, not silently executed behind the customer's back.
        const [, sql] = executeInTenantSchema.mock.calls[0] as any[];
        expect(sql).toContain("status = 'awaiting_confirmation'");
        expect(sql).toContain('confirmation_token IS NOT NULL');
        expect(sql).toContain('confirmation_expires_at > NOW()');
    });

    it('returns null when nothing is pending', async () => {
        const { service } = createService([]);
        expect(await service.findPendingConfirmation(schemaName, conversationId, contactId)).toBeNull();
    });

    it('returns null when the stored payload has no usable arguments', async () => {
        const { service } = createService([{ ...pendingRow, request_payload: { args: null } }]);
        expect(await service.findPendingConfirmation(schemaName, conversationId, contactId)).toBeNull();
    });

    it('stays silent when the tenant has no control tables yet', async () => {
        // A tenant that never ran a writer has no ledger table. That is normal,
        // and it must never break the turn.
        const { service } = createService(new Error('relation "tool_execution_ledger" does not exist'));
        expect(await service.findPendingConfirmation(schemaName, conversationId, contactId)).toBeNull();
    });

    it('refuses malformed ids instead of querying with them', async () => {
        const { service, executeInTenantSchema } = createService([pendingRow]);
        expect(await service.findPendingConfirmation(schemaName, 'not-a-uuid', contactId)).toBeNull();
        expect(executeInTenantSchema).not.toHaveBeenCalled();
    });
});
