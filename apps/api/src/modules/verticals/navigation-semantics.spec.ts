import {
    CRM_FUNNEL_LABELS,
    OPERATIONAL_OBJECT_LABELS,
    isCrmFunnelLabel,
    isOperationalObjectLabel,
} from '@parallext/shared';
import { VERTICAL_REGISTRY } from './vertical-definitions';

/**
 * Dos objetos distintos no pueden compartir etiqueta.
 *
 * `/admin/pipeline` es el Kanban del CRM — oportunidades con etapas. Las
 * definiciones verticales lo renombraban con el nombre de un objeto operativo
 * REAL en ocho industrias: Turismo lo llamaba "Reservas" mientras las estadías
 * viven en `property_bookings`, Servicios del hogar lo llamaba "Solicitudes"
 * junto a una tabla `service_requests`, Seguros "Cotizaciones" junto a
 * `insurance_quotes`.
 *
 * El costo no es cosmético. Un agente que busca las reservas de hoy abre un
 * embudo de ventas; el objeto que necesita está en otro lado y muchas veces
 * detrás de un permiso que no tiene. La auditoría encontró esto intentando
 * hallar una reserva en Turismo y no pudiendo — y eso disparó toda la revisión.
 */

const LOCALES = ['es', 'en', 'pt', 'fr'] as const;

function pipelineLabels(): Array<{ industry: string; locale: string; label: string }> {
    const out: Array<{ industry: string; locale: string; label: string }> = [];
    for (const [industry, definition] of Object.entries(VERTICAL_REGISTRY as Record<string, any>)) {
        const overrides = definition?.sidebar?.labelOverrides?.pipeline;
        if (!overrides) continue;
        for (const locale of LOCALES) {
            const label = overrides[locale];
            if (label) out.push({ industry, locale, label });
        }
    }
    return out;
}

describe('la entrada del CRM nunca se llama como un objeto operativo', () => {
    it('hay etiquetas de pipeline que revisar', () => {
        // Si esto llega a cero, alguien borró los overrides en vez de
        // arreglarlos y el test dejó de proteger nada.
        expect(pipelineLabels().length).toBeGreaterThan(0);
    });

    it('toda etiqueta del embudo usa vocabulario comercial', () => {
        const offenders = pipelineLabels()
            .filter(entry => !isCrmFunnelLabel(entry.locale, entry.label));

        expect(offenders.map(o => `${o.industry}/${o.locale}: ${o.label}`)).toEqual([]);
    });

    it('ninguna etiqueta del embudo nombra un objeto operativo', () => {
        const collisions = pipelineLabels()
            .filter(entry => isOperationalObjectLabel(entry.locale, entry.label));

        expect(collisions.map(c => `${c.industry}/${c.locale}: ${c.label}`)).toEqual([]);
    });

    it('el vocabulario permitido no se solapa con el operativo en ningún idioma', () => {
        // La garantía de fondo: mientras estas dos listas sean disjuntas, pasar
        // el primer test implica pasar el segundo.
        for (const locale of LOCALES) {
            const funnel = CRM_FUNNEL_LABELS[locale].map(l => l.toLowerCase());
            const operational = OPERATIONAL_OBJECT_LABELS[locale].map(l => l.toLowerCase());
            expect(funnel.filter(l => operational.includes(l))).toEqual([]);
        }
    });

    it('las cuatro traducciones existen para cada override', () => {
        for (const [industry, definition] of Object.entries(VERTICAL_REGISTRY as Record<string, any>)) {
            const overrides = definition?.sidebar?.labelOverrides;
            if (!overrides) continue;
            for (const [key, translations] of Object.entries(overrides as Record<string, any>)) {
                for (const locale of LOCALES) {
                    expect(
                        typeof translations?.[locale] === 'string' && translations[locale].length > 0,
                    ).toBe(true);
                    // Un override sin los cuatro idiomas deja al tenant viendo
                    // español dentro de una interfaz en otro idioma.
                    if (!translations?.[locale]) {
                        throw new Error(`${industry}.${key} falta ${locale}`);
                    }
                }
            }
        }
    });

    it('las verticales que motivaron la auditoría quedaron corregidas', () => {
        const byIndustry = (industry: string) =>
            (VERTICAL_REGISTRY as Record<string, any>)[industry]?.sidebar?.labelOverrides?.pipeline;

        // Turismo: el caso original. El embudo ya no se llama como la estadía.
        expect(byIndustry('turismo')?.es).toBe('Oportunidades');
        expect(byIndustry('servicios_hogar')?.es).toBe('Oportunidades');
        expect(byIndustry('seguros')?.es).toBe('Oportunidades');
        expect(byIndustry('education')?.es).toBe('Oportunidades');
    });

    it('las verticales que ya usaban vocabulario comercial no se tocaron', () => {
        const byIndustry = (industry: string) =>
            (VERTICAL_REGISTRY as Record<string, any>)[industry]?.sidebar?.labelOverrides?.pipeline;

        // `Negociaciones` y `Ventas` ya eran comerciales: renombrarlas habría
        // sido perder lenguaje del rubro sin ganar nada.
        expect(byIndustry('inmobiliaria')?.es).toBe('Negociaciones');
        expect(byIndustry('retail')?.es).toBe('Ventas');
    });
});
