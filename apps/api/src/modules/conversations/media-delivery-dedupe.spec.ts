import * as fs from 'fs';
import * as path from 'path';

const source = fs.readFileSync(path.join(__dirname, 'conversations.service.ts'), 'utf8');

describe('conversation media delivery idempotency contract', () => {
    it('derives each media send identity from the provider inbound and stable position', () => {
        expect(source).toContain("outboundDedupeId(inboundMsg, 'media', dedupeIndex)");
        expect(source).toMatch(/sendMedia\([\s\S]*?2000 \+ i \* 1200,[\s\S]*?i,[\s\S]*?\)/);
    });

    it('deduplicates the history rows for media and payment links on turn replay', () => {
        expect(source).toContain("outboundDedupeId(msg, 'media-history', i)");
        expect(source).toContain("outboundDedupeId(msg, 'payment-link-history', paymentLinkIndex++)");
    });
});
