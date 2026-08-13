import { personaChannelCacheKeys } from './persona-cache.util';

describe('personaChannelCacheKeys', () => {
    it('returns legacy and attribution-aware channel keys', () => {
        expect(personaChannelCacheKeys('tenant-1', 'web_widget')).toEqual([
            'persona:tenant-1:channel:web_widget',
            'persona-resolution:tenant-1:channel:web_widget',
        ]);
    });

    it('scopes both contracts to one concrete account', () => {
        expect(personaChannelCacheKeys('tenant-1', 'whatsapp', 'phone-1')).toEqual([
            'persona:tenant-1:channel:whatsapp:acct:phone-1',
            'persona-resolution:tenant-1:channel:whatsapp:acct:phone-1',
        ]);
    });
});
