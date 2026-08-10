import { resourceRentalCustomer, resourceRentalPhone } from '../resourceRentalDisplay';

describe('resource rental customer display', () => {
    it('falls back to the joined contact snapshot', () => {
        const rental = { customer_name: null, contact_name: 'Ana Pérez', contact_phone: '+57 300 123 4567' };
        expect(resourceRentalCustomer(rental))
            .toBe('Ana Pérez');
        expect(resourceRentalPhone(rental)).toBe('+57 300 123 4567');
    });

    it('keeps the stored rental snapshot when present', () => {
        expect(resourceRentalCustomer({ customer_name: 'Cliente guardado', contact_name: 'Contacto actual' }))
            .toBe('Cliente guardado');
    });
});
