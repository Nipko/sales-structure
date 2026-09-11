import { foldedContent, fragmentFor, mergeBurst, type BurstFragment } from './burst-fragments';

const text = (value: string): BurstFragment => ({ kind: 'text', text: value });
const photo = (id: string, caption?: string): BurstFragment =>
    ({ kind: 'media', type: 'image', mediaId: id, mediaUrl: null, mimeType: 'image/jpeg',
        filename: null, caption: caption ?? null });

describe('what belongs in a burst', () => {
    it('takes text and attachments', () => {
        expect(fragmentFor({ type: 'text', text: 'hola' })).toEqual({ kind: 'text', text: 'hola' });
        expect(fragmentFor({ type: 'image', mediaId: 'm1' })?.kind).toBe('media');
        for (const type of ['audio', 'video', 'document']) {
            expect(fragmentFor({ type, mediaId: 'm' })?.kind).toBe('media');
        }
    });

    it('leaves an answer to a question the agent asked alone', () => {
        // A button press is not a fragment of a thought. Merged into a burst,
        // the agent would answer a menu choice with a paragraph about the photo
        // that happened to arrive beside it.
        expect(fragmentFor({ type: 'text', text: '__flow_response__',
            interactiveReply: { type: 'flow_response', data: {} } })).toBeNull();
        expect(fragmentFor({ type: 'interactive', interactiveReply: { id: 'btn_yes' } })).toBeNull();
    });

    it('leaves an unknown type alone rather than guessing', () => {
        expect(fragmentFor({ type: 'location' })).toBeNull();
        expect(fragmentFor({ type: 'contacts' })).toBeNull();
        expect(fragmentFor({ type: 'text', text: '' })).toBeNull();
        expect(fragmentFor(null)).toBeNull();
    });
});

describe('folding one burst into one turn', () => {
    it('keeps the order, because "the second one" means nothing shuffled', () => {
        const merged = mergeBurst([photo('a'), photo('b'), text('el segundo me llegó roto')]);
        expect(merged.media.map(item => item.mediaId)).toEqual(['a', 'b']);
        expect(merged.text).toBe('el segundo me llegó roto');
        expect(merged.fragments).toBe(3);
    });

    it('keeps the sentence that gives the photo its meaning', () => {
        // The whole reason text and media share one buffer. Two buffers would
        // flush independently and hand the model each half without the other.
        const merged = mergeBurst([text('hola'), text('mirá'), photo('a'), text('esto me llegó roto')]);
        expect(merged.text).toBe('hola\nmirá\nesto me llegó roto');
        expect(merged.media).toHaveLength(1);
    });

    it('reads a caption as something the customer typed', () => {
        const merged = mergeBurst([photo('a', 'la caja'), photo('b', 'y el producto')]);
        expect(merged.text).toBe('la caja\ny el producto');
    });

    it('collapses a caption a phone repeated on every image', () => {
        // Selecting three photos and typing once puts the same caption on all
        // three. Three copies of one sentence is what the model would be told
        // the customer said.
        const merged = mergeBurst([photo('a', 'roto'), photo('b', 'roto'), photo('c', 'roto')]);
        expect(merged.text).toBe('roto');
        expect(merged.media).toHaveLength(3);
    });

    it('collapses the repeated last line of a returned burst', () => {
        // A turn that had to give its conversation lock back returns its merged
        // burst to the buffer, and the retry appends its own text again.
        expect(mergeBurst([text('hola\nquería preguntar'), text('quería preguntar')]).text)
            .toBe('hola\nquería preguntar');
    });

    it('describes a redelivered photo once', () => {
        // WhatsApp redelivers. Two records for one photo would be described to
        // the model twice and counted twice by the media throttle.
        const merged = mergeBurst([photo('a'), photo('a'), photo('b')]);
        expect(merged.media.map(item => item.mediaId)).toEqual(['a', 'b']);
    });

    it('keeps an attachment it cannot prove is a duplicate', () => {
        // No id and no url: describing one photo twice is cheaper than never
        // seeing it, so identity-less fragments are never dropped.
        const anonymous: BurstFragment =
            { kind: 'media', type: 'image', mediaId: null, mediaUrl: null,
                mimeType: null, filename: null, caption: null };
        expect(mergeBurst([anonymous, anonymous]).media).toHaveLength(2);
    });
});

describe('what the folded turn looks like', () => {
    it('is a text turn carrying attachments when the burst ends in words', () => {
        const merged = mergeBurst([photo('a'), text('esto')]);
        expect(foldedContent(text('esto'), merged))
            .toEqual({ type: 'text', text: 'esto', mediaBurst: merged.media });
    });

    it('keeps the media type when the burst ends in an attachment', () => {
        const merged = mergeBurst([text('mirá'), photo('a')]);
        expect(foldedContent(photo('a'), merged).type).toBe('image');
    });

    it('is a text turn when there is no media, whatever arrived last', () => {
        const merged = mergeBurst([text('hola'), text('che')]);
        expect(foldedContent(text('che'), merged))
            .toEqual({ type: 'text', text: 'hola\nche', mediaBurst: [] });
    });
});
