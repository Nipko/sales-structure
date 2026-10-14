import { KnowledgeController } from './knowledge.controller';

describe('Knowledge document edit audit identity', () => {
    const tenantId = '3ec0bcc5-462f-4a4f-9ebf-56ea4198b1c8';
    const documentId = '8bbf0ae0-8180-45bf-955f-d2a29c7865e1';
    const actorId = 'ae214510-8e49-4133-9c56-55928f8297f1';

    function fixture() {
        const service = { updateDocument: jest.fn().mockResolvedValue({ documentId, version: 4 }) };
        const controller = new KnowledgeController(service as any, {} as any, {} as any);
        return { controller, service };
    }

    it('attributes a normal edit to the authenticated actor while preserving content and visibility', async () => {
        const { controller, service } = fixture();
        const payload = { name: 'Synthetic QA', content: 'Synthetic version marker', isPublic: false, audience: 'customer' as const };
        const result = await controller.updateDocument({ user: { id: actorId, tenantId } }, documentId, payload);
        expect(service.updateDocument).toHaveBeenCalledTimes(1);
        expect(service.updateDocument).toHaveBeenCalledWith(tenantId, documentId, { ...payload, changedBy: actorId });
        expect(result).toEqual({ documentId, version: 4 });
    });

    it('does not allow request body identity to replace the authenticated actor', async () => {
        const { controller, service } = fixture();
        const payload = { content: 'Synthetic content', changedBy: 'another-actor', isPublic: false };
        await controller.updateDocument({ user: { id: actorId, tenantId } }, documentId, payload);
        expect(service.updateDocument).toHaveBeenCalledWith(tenantId, documentId, { ...payload, changedBy: actorId });
    });

    it('supports the trusted userId alias used by authenticated request contexts', async () => {
        const { controller, service } = fixture();
        await controller.updateDocument({ user: { userId: actorId, tenantId } }, documentId, { content: 'Synthetic content' });
        expect(service.updateDocument).toHaveBeenCalledWith(tenantId, documentId, { content: 'Synthetic content', changedBy: actorId });
    });
});
