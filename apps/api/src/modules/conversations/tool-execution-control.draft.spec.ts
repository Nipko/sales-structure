import { ToolExecutionControlService } from './tool-execution-control.service';

describe('Draft execution boundary', () => {
    it.each(['create_appointment', 'create_payment_link', 'send_product_image', 'file_claim', 'mcp__remote__write'])(
        'blocks %s before ledger or identity effects', async toolName => {
            const service: any = Object.create(ToolExecutionControlService.prototype);
            service.ensureControlTables = jest.fn();
            service.requireStepUpIdentity = jest.fn();
            const result = await service.preflight({ toolName, args: {}, draftMode: true });
            expect(result.allowed).toBe(false);
            expect(result.result.persisted).not.toBe(true);
            expect(service.ensureControlTables).not.toHaveBeenCalled();
            expect(service.requireStepUpIdentity).not.toHaveBeenCalled();
        },
    );
    it('allows an audited reader without writing a ledger', async () => {
        const service: any = Object.create(ToolExecutionControlService.prototype);
        service.ensureControlTables = jest.fn();
        expect((await service.preflight({ toolName: 'search_faqs', args: {}, draftMode: true })).allowed).toBe(true);
        expect(service.ensureControlTables).not.toHaveBeenCalled();
    });
});
