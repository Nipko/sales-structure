import { stripInternalMarkers } from './internal-markers.util';

describe('stripInternalMarkers', () => {
    it('removes the citation the prompt asks the model to write', () => {
        expect(stripInternalMarkers('Aceptamos devoluciones por 30 días [Article: Devoluciones].'))
            .toBe('Aceptamos devoluciones por 30 días.');
        expect(stripInternalMarkers('Retour sous 30 jours [Article : Retours]')).toBe('Retour sous 30 jours');
        expect(stripInternalMarkers('Hola [ARTICLE:Envíos] mundo')).toBe('Hola mundo');
    });

    it('does NOT touch a product reference written with another language label', () => {
        for (const text of ['Ref [Artículo: 4512] disponible', 'Ref [Artikel: 4512] verfügbar', 'Ref [Artigo: 4512] disponível',
            'Ref [Articolo: 4512] disponibile', 'Ref [Articles: 4512] ok'])
            expect(stripInternalMarkers(text)).toBe(text);
    });

    it('removes several markers and keeps the rest of the sentence intact', () => {
        expect(stripInternalMarkers('Envío gratis [Article: Envíos]. Pagos con tarjeta [Article: Pagos].'))
            .toBe('Envío gratis. Pagos con tarjeta.');
    });

    it('drops a line that held only the marker without leaving a blank gap', () => {
        expect(stripInternalMarkers('Primera línea\n[Article: Envíos]\nSegunda línea')).toBe('Primera línea\nSegunda línea');
        expect(stripInternalMarkers('Respuesta.\n\n[Article: Envíos]')).toBe('Respuesta.');
    });

    it('does not glue two words together when the marker sat between them', () => {
        expect(stripInternalMarkers('uno[Article: X]dos')).toBe('uno dos');
    });

    it('removes internal retrieval identifiers that leak in the same bracket shape', () => {
        expect(stripInternalMarkers('Listo [kb_article: 33333333-3333-4333-8333-333333333333]')).toBe('Listo');
        expect(stripInternalMarkers('Listo [retrievalId: 44444444-4444-4444-8444-444444444444]')).toBe('Listo');
        expect(stripInternalMarkers('Listo [retrieval_id: 4444]')).toBe('Listo');
        expect(stripInternalMarkers('Listo [documentId: 3333]')).toBe('Listo');
        expect(stripInternalMarkers('Listo [document_id: 3333]')).toBe('Listo');
    });

    it('handles a title with nested brackets as one marker', () => {
        expect(stripInternalMarkers('Ver [Article: Política [2024]] hoy')).toBe('Ver hoy');
    });

    it('removes a markdown link target that follows the marker', () => {
        expect(stripInternalMarkers('Más info [Article: Envíos](https://example.test/a) aquí')).toBe('Más info aquí');
    });

    it('leaves no empty emphasis behind', () => {
        expect(stripInternalMarkers('Listo **[Article: X]**')).toBe('Listo');
        expect(stripInternalMarkers('Listo _[Article: X]_ ya')).toBe('Listo ya');
        expect(stripInternalMarkers('**Importante** [Article: X]')).toBe('**Importante**');
    });

    it('keeps the leading indentation of the reply', () => {
        expect(stripInternalMarkers('    - item uno [Article: X]\n    - item dos')).toBe('    - item uno\n    - item dos');
        expect(stripInternalMarkers('  sangría [Article: X]')).toBe('  sangría');
    });

    it('leaves ordinary bracketed text and unrelated words alone', () => {
        const text = 'Talla [M] disponible. El artículo: camiseta. [Nota: llega mañana] Article 5 [1]';
        expect(stripInternalMarkers(text)).toBe(text);
    });

    it('passes through empty and non-string input untouched', () => {
        expect(stripInternalMarkers('')).toBe('');
        expect(stripInternalMarkers(undefined as any)).toBeUndefined();
        expect(stripInternalMarkers(null as any)).toBeNull();
    });
});
