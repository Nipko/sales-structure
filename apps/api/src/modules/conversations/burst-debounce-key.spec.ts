import * as fs from 'fs';
import * as path from 'path';
import { burstBufferKeys, sharesBurstBuffer, type BurstIdentity } from './burst-debounce-key';

const tenantId = '11111111-1111-4111-8111-111111111111';

const identity = (over: Partial<BurstIdentity> = {}): BurstIdentity => ({
    tenantId, channelType: 'whatsapp', channelAccountId: 'sales-line',
    contactId: '+573000000000', ...over,
});

describe('which buffer a burst of fragments belongs to', () => {
    it('keeps the same customer on two of a tenant\'s numbers apart', () => {
        // The defect this exists for: one buffer for both numbers meant the
        // sales line answered a question asked of support, with words the
        // customer sent somewhere else, and support answered nothing at all.
        expect(sharesBurstBuffer(
            identity({ channelAccountId: 'sales-line' }),
            identity({ channelAccountId: 'support-line' }),
        )).toBe(false);
    });

    it('still merges the fragments of one person on one connection', () => {
        expect(sharesBurstBuffer(identity(), identity())).toBe(true);
    });

    it('keeps two people on the same number apart', () => {
        expect(sharesBurstBuffer(identity(), identity({ contactId: '+573999999999' }))).toBe(false);
    });

    it('keeps two tenants apart even when the account id repeats', () => {
        expect(sharesBurstBuffer(
            identity({ channelAccountId: 'default' }),
            identity({ tenantId: '99999999-9999-4999-8999-999999999999', channelAccountId: 'default' }),
        )).toBe(false);
    });

    it('keeps WhatsApp and Telegram apart for the same person', () => {
        expect(sharesBurstBuffer(identity(), identity({ channelType: 'telegram' }))).toBe(false);
    });

    it('does not let a missing connection collide with a blank one, or with a real id', () => {
        const absent = burstBufferKeys(identity({ channelAccountId: null })).base;
        const blank = burstBufferKeys(identity({ channelAccountId: '   ' })).base;
        const real = burstBufferKeys(identity({ channelAccountId: 'sales-line' })).base;
        // Absent and blank mean the same thing — no connection — and neither of
        // them may quietly become the neighbour of an account that has one.
        expect(absent).toBe(blank);
        expect(absent).not.toBe(real);
    });

    it('gives the sequence and the buffer distinct keys under one base', () => {
        const keys = burstBufferKeys(identity());
        expect(keys.seqKey).toBe(`${keys.base}:seq`);
        expect(keys.msgsKey).toBe(`${keys.base}:msgs`);
        expect(keys.seqKey).not.toBe(keys.msgsKey);
    });
});

describe('the turn actually uses it', () => {
    /**
     * A key helper nothing calls is a key that changed nowhere. The buffer is
     * written in one method and put back in another, and the bug was the two of
     * them agreeing on a formula that left the connection out — so the contract
     * is that neither builds a key of its own any more.
     */
    const service = fs.readFileSync(
        path.join(__dirname, 'conversations.service.ts'), 'utf8');

    it('builds no buffer key by hand', () => {
        expect(service).not.toMatch(/`buf:conv:\$\{/);
    });

    it('reaches the buffer through the shared helper in both places', () => {
        expect(service.match(/burstBufferKeys\(/g) || []).toHaveLength(2);
    });
});
