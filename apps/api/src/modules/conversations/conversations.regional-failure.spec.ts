import { ConversationsService } from './conversations.service';

function harness(resolve: jest.Mock) {
    const service = Object.create(ConversationsService.prototype) as ConversationsService;
    Object.assign(service as any, {
        regionalProfile: { resolve },
        logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
    });
    return service as any;
}

describe('turn regional authority failures', () => {
    it('does not silently use Colombia when no timezone can be proved', async () => {
        const service = harness(jest.fn().mockRejectedValue(new Error('database unavailable')));

        await expect(service.regionalContextForTurn('tenant', {}, null))
            .rejects.toThrow('turn_regional_context_unavailable');
    });

    it('can continue with the timezone explicitly configured on the agent', async () => {
        const service = harness(jest.fn().mockRejectedValue(new Error('database unavailable')));

        await expect(service.regionalContextForTurn('tenant', {}, null, 'America/Mexico_City'))
            .resolves.toEqual({ regional: null, timezone: 'America/Mexico_City' });
    });

    it('uses one resolved profile for both regional context and the turn clock', async () => {
        const regional = { timezone: { value: 'America/Sao_Paulo' }, operatingCountry: { value: 'BR' } };
        const resolve = jest.fn().mockResolvedValue(regional);
        const service = harness(resolve);

        await expect(service.regionalContextForTurn('tenant', { mode: 'live' }, null))
            .resolves.toEqual({ regional, timezone: 'America/Sao_Paulo' });
        expect(resolve).toHaveBeenCalledTimes(1);
    });
});
