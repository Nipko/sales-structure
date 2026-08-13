import { KnowledgeService } from './knowledge.service';

describe('KnowledgeService retrieval attribution', () => {
    const schema = 'tenant_quality';
    let service: KnowledgeService;
    let executeInTenantSchema: jest.Mock;

    beforeEach(() => {
        executeInTenantSchema = jest.fn().mockResolvedValue([]);
        service = Object.create(KnowledgeService.prototype) as KnowledgeService;
        (service as any).prisma = { executeInTenantSchema };
        (service as any).logger = { warn: jest.fn() };
    });

    it('stores a conversation-scoped sentinel when retrieval returns no result', async () => {
        await (service as any).trackRetrieval(
            schema,
            '11111111-1111-4111-8111-111111111111',
            '¿Cuál es la política especial?',
            [],
            0.7,
            '22222222-2222-4222-8222-222222222222',
        );

        expect(executeInTenantSchema).toHaveBeenCalledTimes(2);
        expect(executeInTenantSchema.mock.calls[1][1]).toContain(
            'VALUES (NULL, NULL, $1, NULL, false, $2::uuid)',
        );
        expect(executeInTenantSchema.mock.calls[1][2]).toEqual([
            '¿Cuál es la política especial?',
            '22222222-2222-4222-8222-222222222222',
        ]);
    });

    it('keeps an unattributed sentinel when no conversation is available', async () => {
        await (service as any).trackRetrieval(
            schema,
            '11111111-1111-4111-8111-111111111111',
            'Pregunta sin contexto',
            [],
            0.7,
        );

        expect(executeInTenantSchema.mock.calls[1][2]).toEqual([
            'Pregunta sin contexto',
            null,
        ]);
    });

    it('does not create the null-document sentinel when retrieval has results', async () => {
        await (service as any).trackRetrieval(
            schema,
            '11111111-1111-4111-8111-111111111111',
            'Pregunta cubierta',
            [{
                document_id: '33333333-3333-4333-8333-333333333333',
                id: '44444444-4444-4444-8444-444444444444',
                score: 0.9,
            }],
            0.7,
            '22222222-2222-4222-8222-222222222222',
        );

        expect(executeInTenantSchema).toHaveBeenCalledTimes(1);
        expect(executeInTenantSchema.mock.calls[0][1]).not.toContain(
            'VALUES (NULL, NULL, $1, NULL, false, $2::uuid)',
        );
    });

    it('records a sentinel when candidates exist but none clears the effective use threshold', async () => {
        await (service as any).trackRetrieval(
            schema,
            '11111111-1111-4111-8111-111111111111',
            'Pregunta con candidatos débiles',
            [{
                document_id: '33333333-3333-4333-8333-333333333333',
                id: '44444444-4444-4444-8444-444444444444',
                score: 0.3,
            }],
            0,
            '22222222-2222-4222-8222-222222222222',
        );

        expect(executeInTenantSchema).toHaveBeenCalledTimes(3);
        expect(executeInTenantSchema.mock.calls[1][1]).toContain(
            'VALUES (NULL, NULL, $1, NULL, false, $2::uuid)',
        );
        expect(executeInTenantSchema.mock.calls[2][2][4]).toBe(false);
    });
});
