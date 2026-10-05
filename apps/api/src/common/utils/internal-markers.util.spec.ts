import { stripInternalMarkers } from './internal-markers.util';

describe('stripInternalMarkers', () => {
    it('removes the citation the prompt asks the model to write, in every language the attribution parses', () => {
        expect(stripInternalMarkers('Aceptamos devoluciones por 30 días [Article: Devoluciones].'))
            .toBe('Aceptamos devoluciones por 30 días.');
        expect(stripInternalMarkers('Aceptamos devoluciones [Artículo: Política de devoluciones] por 30 días'))
            .toBe('Aceptamos devoluciones por 30 días');
        expect(stripInternalMarkers('Devolução em 30 dias [Artigo: Devoluções]'))
            .toBe('Devolução em 30 dias');
        expect(stripInternalMarkers('Reso entro 30 giorni [Articolo: Resi]')).toBe('Reso entro 30 giorni');
        expect(stripInternalMarkers('Retour sous 30 jours [Article : Retours]')).toBe('Retour sous 30 jours');
    });

    it('is case-insensitive and tolerates plural and spacing variants the model produces', () => {
        expect(stripInternalMarkers('Hola [ARTICLE:Envíos] mundo')).toBe('Hola mundo');
        expect(stripInternalMarkers('Hola [Articles: Envíos, Pagos] mundo')).toBe('Hola mundo');
    });

    it('removes several markers and keeps the rest of the sentence intact', () => {
        expect(stripInternalMarkers('Envío gratis [Article: Envíos]. Pagos con tarjeta [Article: Pagos].'))
            .toBe('Envío gratis. Pagos con tarjeta.');
    });

    it('drops a line that held only the marker without leaving a blank gap', () => {
        expect(stripInternalMarkers('Primera línea\n[Article: Envíos]\nSegunda línea'))
            .toBe('Primera línea\nSegunda línea');
        expect(stripInternalMarkers('Respuesta.\n\n[Article: Envíos]')).toBe('Respuesta.');
    });

    it('does not glue two words together when the marker sat between them', () => {
        expect(stripInternalMarkers('uno[Article: X]dos')).toBe('uno dos');
    });

    it('removes internal retrieval identifiers that leak in the same bracket shape', () => {
        expect(stripInternalMarkers('Listo [kb_article: 33333333-3333-4333-8333-333333333333]')).toBe('Listo');
    });

    it('removes the other identifier labels the retrieval layer uses', () => {
        expect(stripInternalMarkers('Listo [retrievalId: 44444444-4444-4444-8444-444444444444]')).toBe('Listo');
        expect(stripInternalMarkers('Listo [retrieval_id: 4444]')).toBe('Listo');
        expect(stripInternalMarkers('Listo [documentId: 3333]')).toBe('Listo');
        expect(stripInternalMarkers('Listo [document_id: 3333]')).toBe('Listo');
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
