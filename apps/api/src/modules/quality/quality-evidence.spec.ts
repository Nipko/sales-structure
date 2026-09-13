import { qualityTranscript, QUALITY_CHARACTER_LIMIT } from './quality-evidence';

describe('quality transcript evidence bounds', () => {
    it('retains the tail of oversized messages and reports exact lost coverage', () => {
        const text='x'.repeat(50_000)+'closing answer';
        const selected=qualityTranscript([{id:'last',direction:'outbound',content_text:text,original_characters:text.length}],2,2);
        expect(selected.transcript.endsWith('closing answer')).toBe(true);
        expect(selected.transcript.length).toBeLessThanOrEqual(QUALITY_CHARACTER_LIMIT);
        expect(selected.coverage).toMatchObject({complete:false,truncatedMessages:1,omittedMessages:1});
    });
    it('does not certify completeness when omitted media could contain the customer request', () => {
        const selected=qualityTranscript([{id:'last',direction:'outbound',content_text:'Listo',original_characters:5}],2,1);
        expect(selected.coverage.complete).toBe(false);
    });
    it('counts Unicode code points consistently with PostgreSQL character lengths', () => {
        const selected=qualityTranscript([{id:'last',direction:'inbound',content_text:'😀'.repeat(24000),original_characters:24000}],1,1);
        expect(selected.coverage).toMatchObject({complete:false,truncatedMessages:1});
        expect(selected.transcript).not.toMatch(/^Cliente: [\uDC00-\uDFFF]/);
    });
});
