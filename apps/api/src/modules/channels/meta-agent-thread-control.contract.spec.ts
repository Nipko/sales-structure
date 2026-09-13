import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

/**
 * ═══ A SWITCH WITH NOTHING BEHIND IT MUST NOT LOOK LIKE A GUARANTEE ═══
 *
 * `meta-agent-thread-control.ts` is a state machine for the day Meta's own
 * business agent answers inside a thread this platform answers in. It is
 * registered in `channels.module.ts` and nothing calls it, and the reason is
 * not "not yet wired": there is no field to wire it FROM.
 *
 * `meta-messaging-status.ts` recognises the three control-passing keys, but
 * reads only whether one is PRESENT — no inner field is parsed anywhere here.
 * Choosing between "Meta took the thread" and "Meta gave it back" needs to know
 * WHO owns it now, and that owner field is not read. Meanwhile neither
 * subscription list asks Meta for `messaging_handovers` at all, so the branch
 * is unreachable before the parsing question arises.
 *
 * That leaves a live hazard of a particular kind. Switch the flag on while
 * nothing writes control and every thread reads `unknown`, which under
 * coexistence stands down — a platform muted by one `platform_settings` row.
 *
 * So these cases pin the PRECONDITION rather than the behaviour: the day
 * somebody writes control, they are told, here, that the read half has to be
 * wired in the same change. A docblock alone would not tell them; this does.
 */
const CHANNELS = resolve(__dirname);
const API_SRC = resolve(__dirname, '..', '..');

/** Every non-spec .ts under apps/api/src, read once. */
function productionSources(): { rel: string; text: string }[] {
    const out: { rel: string; text: string }[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) { walk(full); continue; }
            if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue;
            if (entry.includes('.spec.')) continue;
            out.push({ rel: full.slice(API_SRC.length + 1).split('\\').join('/'), text: readFileSync(full, 'utf8') });
        }
    };
    walk(API_SRC);
    return out;
}

describe('thread control says what it is, and is not left to be discovered', () => {
    const sources = productionSources();
    const STORE = 'meta-agent-thread-control.store.ts';
    const PURE = 'meta-agent-thread-control.ts';

    /** Files that mention a name, excluding the two that define it. */
    const usersOf = (needle: string) => sources
        .filter(f => !f.rel.endsWith(STORE) && !f.rel.endsWith(PURE))
        .filter(f => f.text.includes(needle))
        .map(f => f.rel);

    it('has no writer, which is the fact everything else here depends on', () => {
        // `apply` is how a webhook would record a transition. If this list ever
        // stops being empty, somebody has learned to read a handover — and the
        // read half below must be wired in the SAME change, or the flag becomes
        // a switch that mutes the platform.
        const writers = usersOf('.apply(').filter(rel => rel.includes('thread'));
        expect(writers).toEqual([]);
        // And the state machine's own mover is not called from anywhere either.
        expect(usersOf('nextThreadControl')).toEqual([]);
    });

    it('is not asked on any send, which is only acceptable while there is no writer', () => {
        // The pair. Wiring EITHER half alone is worse than neither: a writer
        // with no reader records control nobody honours, and a reader with no
        // writer stands down on every thread the moment the flag is on.
        expect(usersOf('maySpeak(')).toEqual([]);
        expect(usersOf('recoverStandby')).toEqual([]);
    });

    it('is registered, so it cannot rot unnoticed', () => {
        // Left in the module on purpose: the compiler and the DI bootstrap both
        // keep walking through it, so it cannot quietly stop compiling against
        // the rest of the codebase while it waits.
        const module = readFileSync(join(CHANNELS, 'channels.module.ts'), 'utf8');
        expect(module).toContain('MetaAgentThreadControlStore');
    });

    it('reads no Meta field it does not actually receive', () => {
        // The failure this programme already had once: a spec pinning
        // `value.metadata.waba_id`, a field Meta does not send, minting a key
        // production never could. The handover payload is the same trap, and
        // the only honest position is to touch none of its inner fields.
        const status = readFileSync(join(CHANNELS, 'meta-messaging-status.ts'), 'utf8');
        for (const inner of ['new_owner_app_id', 'previous_owner_app_id', 'requested_owner_app_id']) {
            expect(status).not.toContain(inner);
        }
        // What it does read is presence, and that is all it claims to read.
        expect(status).toContain('pass_thread_control');
    });

    it('does not subscribe to the webhook that would carry one', () => {
        // Read from the subscription call itself rather than asserted in prose:
        // the branch above is unreachable while this stays true, and if somebody
        // adds the field, this case is where they find out what else must move.
        const controller = readFileSync(join(CHANNELS, 'channel-management.controller.ts'), 'utf8');
        const subscriptions = [...controller.matchAll(/subscribed_fields:\s*'([^']+)'/g)]
            .map(match => match[1]);
        expect(subscriptions.length).toBeGreaterThan(0);
        for (const fields of subscriptions) {
            expect(fields).not.toContain('messaging_handovers');
        }
    });

    it('says all of this in the file, not only here', () => {
        // A test that knows something the source does not is a test somebody
        // deletes. The two have to carry the same sentence.
        const pure = readFileSync(join(CHANNELS, PURE), 'utf8');
        expect(pure).toContain('WHAT IS WIRED, AND WHAT CANNOT BE');
        expect(pure).toContain('messaging_handovers');
    });
});
