import * as fs from 'fs';
import * as path from 'path';

/**
 * ═══ EVERY PLACE A PERSON SPENDS THIS MONEY SAYS SO, AND SAYS WHERE TO LOOK ═══
 *
 * There are exactly two surfaces in the dashboard where a human being sends a
 * WhatsApp message: the broadcast launch and the inbox composer. A third — the
 * channel page — is where the figures live. If any of the three stops saying
 * that Meta charges the business's own account, the other two become the only
 * warning, and somebody finds out from an invoice.
 *
 * Asserted from the shipped source and the shipped message files rather than
 * from a fixture, for the same reason the pause spec is: the thing that broke
 * last time was a seam, not a component.
 */

const DASHBOARD = path.join(__dirname, '..', '..');
// `core.autocrlf` is on, so the working tree is CRLF and the blob is LF.
const read = (...segments: string[]): string =>
    fs.readFileSync(path.join(DASHBOARD, ...segments), 'utf8').replace(/\r\n/g, '\n');

const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
const messages = Object.fromEntries(LOCALES.map(locale => [
    locale, JSON.parse(fs.readFileSync(
        path.join(DASHBOARD, '..', 'messages', `${locale}.json`), 'utf8')),
])) as Record<(typeof LOCALES)[number], any>;

const INBOX = read('app', 'admin', 'inbox', 'page.tsx');
const NOTICE = read('components', 'broadcast', 'CampaignCostNotice.tsx');

describe('the inbox composer', () => {
    it('tells an agent that a WhatsApp reply may be charged', () => {
        // An agent typing in that box is spending the tenant's money, and
        // nothing on the screen said so.
        expect(INBOX).toContain('whatsappMayBeCharged');
    });

    it('says it only for WhatsApp', () => {
        // Instagram, Messenger and Telegram are not charged this way. Saying
        // they might be would be a different untruth, and an inbox where every
        // reply raises a notice is an inbox where the one that matters is
        // ignored.
        expect(INBOX).toMatch(/selectedConv\.channel === 'whatsapp'[\s\S]{0,400}whatsappMayBeCharged/);
    });
});

describe('routing somebody to the figures', () => {
    it('links to the channel panel from both places money is spent', () => {
        for (const source of [INBOX, NOTICE]) {
            expect(source).toContain('/admin/channels/whatsapp');
            expect(source).toContain('seeSpendPanel');
        }
    });
});

describe('the contextual help on each surface', () => {
    it.each(LOCALES)('explains the WhatsApp charge on broadcast and inbox in %s', locale => {
        for (const section of ['broadcast', 'inbox'] as const) {
            const tips: string[] = messages[locale].help[section].tips;
            // Language-independent: the year the regime starts, beside the
            // channel it applies to. Asserting a translated sentence would make
            // this a test about one locale's wording.
            expect(tips.some(tip => tip.includes('2026') && tip.includes('WhatsApp')))
                .toBe(true);
        }
    });
});
