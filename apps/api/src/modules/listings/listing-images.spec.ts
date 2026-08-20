import { BadRequestException } from '@nestjs/common';
import { ListingsService, MAX_LISTING_IMAGES, normalizeListingImages } from './listings.service';

/**
 * Las fotos de un inmueble.
 *
 * Backend, base y agente soportaban `images` desde hacía meses; la UI no tenía
 * cómo cargarlas, así que la columna nunca se escribía por la vía normal y
 * nadie descubrió que las otras dos vías la escribían mal.
 */
describe('listing images', () => {
    const schemaName = 'tenant_inmo';
    const listingId = '44444444-4444-4444-8444-444444444444';

    function buildService(execute: jest.Mock) {
        return new ListingsService({ executeInTenantSchema: execute } as any);
    }

    it('keeps an array of URLs in the order the owner arranged them', () => {
        expect(normalizeListingImages(['/media/file/t/b.webp', 'https://cdn.example/a.jpg']))
            .toEqual(['/media/file/t/b.webp', 'https://cdn.example/a.jpg']);
    });

    /**
     * La celda de una planilla es UNA cadena. Guardarla tal cual dejaba el
     * inmueble con una cadena donde el que envía la foto espera un arreglo:
     * fila cargada, cero fotos, ningún error.
     */
    it('splits a spreadsheet cell into the several URLs it actually holds', () => {
        expect(normalizeListingImages('https://a.test/1.jpg, https://a.test/2.jpg'))
            .toEqual(['https://a.test/1.jpg', 'https://a.test/2.jpg']);
        expect(normalizeListingImages('https://a.test/1.jpg|https://a.test/2.jpg'))
            .toEqual(['https://a.test/1.jpg', 'https://a.test/2.jpg']);
        expect(normalizeListingImages('https://a.test/1.jpg\nhttps://a.test/2.jpg'))
            .toEqual(['https://a.test/1.jpg', 'https://a.test/2.jpg']);
    });

    /** Esta URL se le entrega tal cual a Meta/Telegram. */
    it('drops anything a channel cannot fetch', () => {
        expect(normalizeListingImages([
            'javascript:alert(1)',
            'data:image/png;base64,AAAA',
            '//evil.test/x.jpg',
            'no-es-una-url',
            42,
            null,
            '   ',
        ])).toEqual([]);
    });

    it('drops duplicates without reordering what survives', () => {
        expect(normalizeListingImages(['/a.jpg', '/b.jpg', '/a.jpg']))
            .toEqual(['/a.jpg', '/b.jpg']);
    });

    it('caps the gallery so one row cannot carry an unbounded list', () => {
        const many = Array.from({ length: MAX_LISTING_IMAGES + 5 }, (_, i) => `/media/${i}.jpg`);
        expect(normalizeListingImages(many)).toHaveLength(MAX_LISTING_IMAGES);
    });

    it('treats a missing value as no photos rather than as an error', () => {
        expect(normalizeListingImages(undefined)).toEqual([]);
        expect(normalizeListingImages(null)).toEqual([]);
        expect(normalizeListingImages({ url: '/a.jpg' })).toEqual([]);
    });

    it('normalizes on create so the import path cannot write what the panel rejects', async () => {
        const execute = jest.fn().mockResolvedValue([{ id: listingId }]);
        await buildService(execute).create(schemaName, {
            name: 'Apto 501',
            transactionType: 'sale',
            images: 'https://a.test/1.jpg,javascript:alert(1)',
        });
        const params = execute.mock.calls[0][2];
        expect(JSON.parse(params[24])).toEqual(['https://a.test/1.jpg']);
    });

    it('normalizes on update too, so editing is not the back door', async () => {
        const execute = jest.fn().mockResolvedValue([{ id: listingId }]);
        await buildService(execute).update(schemaName, listingId, {
            images: ['/media/ok.webp', 'data:image/png;base64,AAAA'],
        });
        const [, sql, params] = execute.mock.calls[0];
        expect(sql).toContain('"images" = $1::jsonb');
        expect(JSON.parse(params[0])).toEqual(['/media/ok.webp']);
    });

    it('leaves the gallery alone when the caller did not mention it', async () => {
        const execute = jest.fn().mockResolvedValue([{ id: listingId }]);
        await buildService(execute).update(schemaName, listingId, { name: 'Otro nombre' });
        const [, sql] = execute.mock.calls[0];
        expect(sql).not.toContain('images');
    });

    /** Mismo motivo que en `getById`: el id llega de una tool call. */
    it('rejects an update addressed to something that is not a listing id', async () => {
        const execute = jest.fn();
        await expect(buildService(execute).update('tenant_inmo', 'apto-501', { name: 'x' }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(execute).not.toHaveBeenCalled();
    });
});
