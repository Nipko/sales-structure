import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AGENT_CONFIGURATION_PATHS, AGENT_EMAIL_CONFIRMATION_FAMILIES } from '@parallext/shared';

/**
 * ═══ THE SWITCH THE CODE HONOURS AND THE SCREEN NEVER OFFERED ═══
 *
 * The audit counted controls with no consumer: a toggle the owner can move with
 * no consequence, while the screen says it did something. This is the mirror of
 * it, and the worse one to leave standing — a control the runtime genuinely
 * reads, with no way for the owner to reach it.
 *
 * `vehicles.emailConfirmations` was that. A test drive is an appointment the
 * `vehicles` family asked for, so the notification resolves the switch through
 * `['vehicles', 'appointments']`, most specific first, and honours it. The
 * editor's `slugMap` set `vehicles: ""`, and an empty slug hides the toggle.
 *
 * ── AND THE TEMPLATE NAMED HAS TO BE THE ONE THAT GOES ──────────────────────
 *
 * `realEstate` and `pets` did have a toggle, pointing at
 * `realestate_visit_confirmation` and `veterinary_appointment_confirmation`.
 * Both are seeded into every tenant and rendered zero times: the consumer gates
 * the APPOINTMENT confirmation, which is the real, translated, calendar-bearing
 * email. So the owner was told their switch governed a message nothing sends.
 *
 * The slug is read out of the API rather than repeated here, because a literal
 * copied into a test agrees with itself for ever.
 */

const API_SRC = resolve(__dirname, '..', '..', '..', '..', '..', '..', 'api', 'src');
const EDITOR = resolve(__dirname, 'CapabilitiesSection.tsx');

/** What `APPOINTMENT_EMAIL_SLUGS.confirmation` really is, read from the API. */
function appointmentConfirmationSlug(): string {
    const source = readFileSync(
        resolve(API_SRC, 'modules', 'email-templates', 'appointment-email-layout.ts'), 'utf8');
    const match = /confirmation:\s*'([a-z_]+)'/.exec(source);
    // A reading that comes back empty must fail loudly rather than compare
    // `undefined` to `undefined` and pass.
    if (!match) throw new Error('APPOINTMENT_EMAIL_SLUGS.confirmation could not be read');
    return match[1];
}

/** The editor's family → template-slug map, read from the component. */
function slugMap(): Record<string, string> {
    const source = readFileSync(EDITOR, 'utf8');
    const block = source.split('const slugMap: Record<ToolKey, string> = {')[1];
    if (!block) throw new Error('slugMap could not be located in the editor');
    const body = block.split('};')[0];
    const entries: Record<string, string> = {};
    for (const line of body.split('\n')) {
        const pair = /^\s*([A-Za-z]+):\s*"([a-z_]*)"/.exec(line);
        if (pair) entries[pair[1]] = pair[2];
    }
    if (Object.keys(entries).length < 20) {
        throw new Error(`slugMap parsed only ${Object.keys(entries).length} families`);
    }
    return entries;
}

describe('a confirmation switch the runtime reads is one the owner can reach', () => {
    /**
     * The three families whose confirmable operation IS an appointment, so the
     * switch gates the appointment email. Each is resolved by the API through
     * `[family, 'appointments']`.
     */
    const APPOINTMENT_SHAPED = ['vehicles', 'realEstate', 'pets'];

    it('parses a real map and a real slug, so the comparisons below mean something', () => {
        expect(Object.keys(slugMap()).length).toBeGreaterThan(20);
        expect(appointmentConfirmationSlug()).toMatch(/^[a-z_]+$/);
    });

    it.each(APPOINTMENT_SHAPED)('offers the %s toggle at all', family => {
        // An empty slug is what hides it. This is the whole defect for
        // `vehicles`: the code honoured a setting the screen never showed.
        expect({ family, slug: slugMap()[family] })
            .toEqual({ family, slug: expect.stringMatching(/.+/) });
    });

    it.each(APPOINTMENT_SHAPED)('names the email %s really sends, not a seeded one', family => {
        // Read from the API, not repeated here.
        expect({ family, slug: slugMap()[family] })
            .toEqual({ family, slug: appointmentConfirmationSlug() });
    });

    it('does not offer a toggle for a family with nothing to confirm', () => {
        // The other direction, so the fix above cannot turn into "give every
        // family a toggle". A family that only READS state creates nothing to
        // confirm, and `professionalServices` says so in the map itself.
        for (const family of ['professionalServices', 'faqs', 'policies', 'knowledge', 'crm']) {
            expect({ family, slug: slugMap()[family] }).toEqual({ family, slug: '' });
        }
    });

    it('offers Assist exactly the confirmation controls the editor exposes', () => {
        const visible = Object.entries(slugMap()).filter(([, slug]) => !!slug).map(([family]) => family).sort();
        expect(visible).toEqual([...AGENT_EMAIL_CONFIRMATION_FAMILIES].sort());
        expect(visible.map(family => `tools.${family}.emailConfirmations`).sort())
            .toEqual(AGENT_CONFIGURATION_PATHS.filter(path => path.endsWith('.emailConfirmations')).sort());
    });
});
