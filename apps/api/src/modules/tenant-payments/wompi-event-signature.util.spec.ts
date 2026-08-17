import { createHash } from 'crypto';
import { verifyWompiEventSignature } from './wompi-event-signature.util';

const SECRET = 'prod_events_abcdefghijklmnop';

function signedBody(
    properties: string[],
    transaction: Record<string, unknown> = {
        id: 'transaction-1',
        status: 'APPROVED',
        amount_in_cents: 250_000,
        customer_data: { device_type: 'mobile' },
    },
) {
    const timestamp = 1_781_000_001;
    const body: any = {
        event: 'transaction.updated',
        data: { transaction },
        timestamp,
        signature: { properties, checksum: '' },
    };
    const values = properties.map(property => property
        .split('.')
        .reduce((value: any, part) => value?.[part], body.data));
    body.signature.checksum = createHash('sha256')
        .update(`${values.join('')}${timestamp}${SECRET}`)
        .digest('hex');
    return body;
}

describe('verifyWompiEventSignature', () => {
    it('accepts transaction.id as the only required dynamic property', () => {
        const body = signedBody(['transaction.id']);

        expect(verifyWompiEventSignature({ body, eventsSecret: SECRET })).toEqual({
            valid: true,
            eventKey: body.signature.checksum,
        });
    });

    it('accepts bounded arbitrary scalar transaction paths in provider order', () => {
        const body = signedBody([
            'transaction.customer_data.device_type',
            'transaction.id',
            'transaction.amount_in_cents',
        ]);

        expect(verifyWompiEventSignature({
            body,
            eventsSecret: SECRET,
            headerChecksum: body.signature.checksum.toUpperCase(),
        }).valid).toBe(true);
    });

    it('rejects tampering and a checksum built in a different property order', () => {
        const body = signedBody(['transaction.status', 'transaction.id']);
        body.data.transaction.status = 'VOIDED';
        expect(verifyWompiEventSignature({ body, eventsSecret: SECRET })).toMatchObject({
            valid: false,
            reason: 'checksum_mismatch',
        });

        const reordered = signedBody(['transaction.status', 'transaction.id']);
        reordered.signature.properties = ['transaction.id', 'transaction.status'];
        expect(verifyWompiEventSignature({ body: reordered, eventsSecret: SECRET })).toMatchObject({
            valid: false,
            reason: 'checksum_mismatch',
        });
    });

    it('rejects a valid checksum when transaction.id was not signed', () => {
        const body = signedBody(['transaction.status', 'transaction.amount_in_cents']);

        expect(verifyWompiEventSignature({ body, eventsSecret: SECRET })).toMatchObject({
            valid: false,
            reason: 'missing_required_signature_property',
        });
    });

    it('rejects duplicate, object-valued and prototype traversal properties', () => {
        const duplicate = signedBody(['transaction.id', 'transaction.id']);
        expect(verifyWompiEventSignature({ body: duplicate, eventsSecret: SECRET }).valid).toBe(false);

        const object = signedBody(['transaction.id', 'transaction.customer_data']);
        expect(verifyWompiEventSignature({ body: object, eventsSecret: SECRET })).toMatchObject({
            valid: false,
            reason: 'missing_signature_value',
        });

        const unsafe = signedBody(['transaction.id']);
        unsafe.signature.properties = ['transaction.__proto__.polluted', 'transaction.id'];
        expect(verifyWompiEventSignature({ body: unsafe, eventsSecret: SECRET })).toMatchObject({
            valid: false,
            reason: 'unsupported_signature_property',
        });
    });
});
