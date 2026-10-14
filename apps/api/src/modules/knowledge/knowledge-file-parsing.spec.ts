import { readFileSync } from 'fs';
import { join } from 'path';
import { KnowledgeService } from './knowledge.service';

describe('Knowledge file extraction with the shipped parsers', () => {
    const service = new KnowledgeService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    const pdf = readFileSync(join(__dirname, '__fixtures__/synthetic-receipt.pdf')).toString('base64');

    it.each(['application/pdf', 'application/octet-stream'])('extracts the complete digital PDF from a base64 upload (%s)', async mime => {
        const text = await service.parseFileContent(pdf, mime, 'Synthetic.PDF');
        expect(text.split('\n').filter(Boolean)).toEqual([
            'Parallly synthetic PDF ingestion QA.',
            'The receipt code is TURQUESA-PDF-684.',
            'This is a fictional virtual reception, not a commercial service.',
            'It contains no prices, bookings, contacts, scripts or external links.',
        ]);
    });

    it('still rejects an invalid PDF rather than treating binary data as knowledge', async () => {
        await expect(service.parseFileContent(Buffer.from('not a PDF').toString('base64'), 'application/pdf', 'broken.pdf'))
            .rejects.toThrow('PDF parsing failed:');
    });

    it('extracts DOCX using its complete MIME type', async () => {
        const file = readFileSync(join(__dirname, '__fixtures__/synthetic-receipt.docx')).toString('base64');
        const text = await service.parseFileContent(file, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'synthetic.docx');
        expect(text).toContain('JADE-DOCX-527');
        expect(text).toContain('sin precios, reservas ni servicio comercial.');
    });
});
