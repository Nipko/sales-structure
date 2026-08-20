import { RegionalProfileService } from './regional-profile.service';
import { normalizePhoneE164, phoneCountryMismatch } from '../../common/utils/phone.util';

/**
 * El país operativo no es el país de facturación.
 *
 * La plataforma usaba país de facturación, huso horario, idioma del agente y un
 * país de texto libre de Business Info como señales parcialmente
 * intercambiables para la misma pregunta, y cuando ninguna respondía caía a
 * Colombia: `es-CO`, `America/Bogota`, `COP`, `+57`. Un tenant brasileño podía
 * arrancar con identidad colombiana, cotizar en COP y ver los teléfonos de sus
 * clientes reescritos con `+57` — que en el módulo de identidad puede fusionar
 * a dos personas distintas en un solo contacto.
 */

const tenantId = '11111111-1111-4111-8111-111111111111';

function build() {
    const service = new RegionalProfileService({} as any, {} as any);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    return service;
}

describe('precedencia: declarado > derivado > inferido > fallback', () => {
    it('lo declarado por el tenant gana sobre todas las demás señales', () => {
        const profile = build().compose(tenantId, {
            operatingCountry: 'MX',
            billingCountry: 'CO',
            settings: { timezone: 'America/Bogota', businessInfo: { country: 'AR' } },
        });
        expect(profile.operatingCountry).toMatchObject({ value: 'MX', source: 'declared' });
    });

    it('Business Info pesa más que la relación de facturación', () => {
        const profile = build().compose(tenantId, {
            billingCountry: 'CO',
            settings: { businessInfo: { country: 'MX' } },
        });
        expect(profile.operatingCountry).toMatchObject({
            value: 'MX', source: 'inferred', from: 'business_info.country',
        });
    });

    it('el huso horario es la señal más débil, y se marca como inferida', () => {
        const profile = build().compose(tenantId, {
            settings: { timezone: 'America/Sao_Paulo' },
        });
        expect(profile.operatingCountry).toMatchObject({ value: 'BR', source: 'inferred' });
    });

    it('sin ninguna señal el fallback se declara como tal, no como elección', () => {
        const profile = build().compose(tenantId, {});
        expect(profile.operatingCountry).toMatchObject({ value: 'CO', source: 'fallback' });
    });

    it('la moneda se deriva del país operativo, no de Colombia', () => {
        const profile = build().compose(tenantId, { operatingCountry: 'BR' });
        expect(profile.operatingCurrency).toMatchObject({ value: 'BRL', source: 'derived' });
    });

    it('una moneda declarada gana sobre la del país (negocio dolarizado)', () => {
        const profile = build().compose(tenantId, {
            operatingCountry: 'AR', operatingCurrency: 'USD',
        });
        expect(profile.operatingCurrency).toMatchObject({ value: 'USD', source: 'declared' });
        expect(profile.conflicts.map(c => c.field)).toContain('currency');
    });

    it('el huso se deriva del país cuando el tenant no lo configuró', () => {
        const profile = build().compose(tenantId, { operatingCountry: 'MX', settings: {} });
        expect(profile.timezone).toMatchObject({ value: 'America/Mexico_City', source: 'derived' });
    });

    it('el locale se deriva del país, no del default es-CO de la columna', () => {
        const profile = build().compose(tenantId, { operatingCountry: 'BR', language: 'es-CO' });
        expect(profile.locale).toMatchObject({ value: 'pt-BR', source: 'derived' });
    });

    it('la región telefónica sigue al país operativo', () => {
        const profile = build().compose(tenantId, { operatingCountry: 'MX' });
        expect(profile.phoneRegion).toMatchObject({ value: 'MX', source: 'derived' });
    });
});

describe('el tratamiento no se uniforma en toda la región', () => {
    it('Argentina, Uruguay y Paraguay usan vos', () => {
        for (const country of ['AR', 'UY', 'PY']) {
            expect(build().compose(tenantId, { operatingCountry: country }).addressForm.value).toBe('vos');
        }
    });

    it('Colombia, México y Perú NO heredan el voseo rioplatense', () => {
        for (const country of ['CO', 'MX', 'PE', 'CL']) {
            expect(build().compose(tenantId, { operatingCountry: country }).addressForm.value).toBe('usted');
        }
    });

    it('Brasil usa você', () => {
        expect(build().compose(tenantId, { operatingCountry: 'BR' }).addressForm.value).toBe('voce');
    });
});

describe('las señales en conflicto se registran, no se resuelven en silencio', () => {
    it('facturación y Business Info discrepando produce un conflicto', () => {
        const profile = build().compose(tenantId, {
            billingCountry: 'CO', settings: { businessInfo: { country: 'MX' } },
        });
        const conflict = profile.conflicts.find(c => c.field === 'operating_country');
        expect(conflict).toBeDefined();
        expect(conflict!.candidates.map(c => c.value).sort()).toEqual(['CO', 'MX']);
    });

    it('un país declarado cierra el conflicto: el tenant ya respondió', () => {
        const profile = build().compose(tenantId, {
            operatingCountry: 'MX', billingCountry: 'CO',
            settings: { businessInfo: { country: 'AR' } },
        });
        expect(profile.conflicts.find(c => c.field === 'operating_country')).toBeUndefined();
    });

    it('un huso de otro país que el operativo se marca para revisión', () => {
        const profile = build().compose(tenantId, {
            operatingCountry: 'MX', settings: { timezone: 'America/Bogota' },
        });
        expect(profile.conflicts.map(c => c.field)).toContain('timezone');
        // Y se conserva lo que el tenant configuró: puede tener una sede allá.
        expect(profile.timezone.value).toBe('America/Bogota');
    });

    it('el default es-CO de la columna no genera ruido de conflicto', () => {
        const profile = build().compose(tenantId, { operatingCountry: 'CO', language: 'es-CO' });
        expect(profile.conflicts).toEqual([]);
    });

    it('un idioma base distinto del país sí es un conflicto real', () => {
        const profile = build().compose(tenantId, { operatingCountry: 'BR', language: 'es-CO' });
        expect(profile.conflicts.map(c => c.field)).toContain('locale');
    });
});

describe('estado del country pack', () => {
    it('los mercados LatAm arrancan en draft, no certificados', () => {
        for (const country of ['CO', 'MX', 'AR', 'BR']) {
            expect(build().compose(tenantId, { operatingCountry: country }).countryPackStatus).toBe('draft');
        }
    });

    it('EE.UU. y Canadá quedan fallback_only: el país solo no los resuelve', () => {
        for (const country of ['US', 'CA']) {
            expect(build().compose(tenantId, { operatingCountry: country }).countryPackStatus).toBe('fallback_only');
        }
    });

    it('un país no comercializado nunca hereda certificación', () => {
        expect(build().compose(tenantId, { operatingCountry: 'CU' }).countryPackStatus).toBe('fallback_only');
    });
});

describe('normalización telefónica por región', () => {
    it('un número nacional mexicano ya no se vuelve colombiano', () => {
        expect(normalizePhoneE164('55 1234 5678', 'MX')).toBe('+525512345678');
        // Sin región, sigue cayendo a Colombia — que es exactamente la
        // corrupción original y por qué los llamadores deben pasar la región
        // del tenant en vez de confiar en el default.
        expect(normalizePhoneE164('55 1234 5678')).toBe('+575512345678');
    });

    it('respeta un E.164 explícito por encima de la región del tenant', () => {
        expect(normalizePhoneE164('+5491112345678', 'CO')).toBe('+5491112345678');
    });

    it('un nacional del propio país del tenant se resuelve a su código', () => {
        expect(normalizePhoneE164('3001234567', 'CO')).toBe('+573001234567');
        expect(normalizePhoneE164('987654321', 'PE')).toBe('+51987654321');
    });

    it('acepta tanto región ISO como código de marcación', () => {
        expect(normalizePhoneE164('3001234567', 'CO')).toBe(normalizePhoneE164('3001234567', '57'));
    });

    it('una entrada inválida sigue siendo null, no un número inventado', () => {
        expect(normalizePhoneE164('invalid', 'MX')).toBeNull();
        expect(normalizePhoneE164('', 'MX')).toBeNull();
        expect(normalizePhoneE164(null, 'MX')).toBeNull();
    });

    it('detecta discrepancia histórica sin reescribir nada', () => {
        expect(phoneCountryMismatch('+573001234567', 'MX')).toMatchObject({
            mismatch: true, storedCode: '57', expectedCode: '52',
        });
        expect(phoneCountryMismatch('+525512345678', 'MX').mismatch).toBe(false);
        expect(phoneCountryMismatch(null, 'MX').mismatch).toBe(false);
    });
});
