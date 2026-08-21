import * as fs from 'fs';
import * as path from 'path';
import {
    listVerticalCapabilityConfigurations,
    VERTICAL_MANIFEST_INDUSTRIES,
} from '@parallext/shared';

/**
 * El manifiesto declara, por industria, las **claves exactas que devuelve el
 * agregador**. Nadie lo verificaba.
 *
 * `servicios_hogar` declaraba `completed` y `completionRatePct`; el agregador
 * devolvía `pending` y `avgCompletionRatePct`, y **no devolvía `completed` en
 * absoluto**. La estadística por tenant sí la calculaba y el agregado la perdía
 * al sumar: el negocio veía cuántas solicitudes quedaban pendientes y nunca
 * cuántas había cerrado — que es la cuenta que le dice si el mes fue bueno.
 *
 * Una declaración que nadie compara contra el código es una promesa que se
 * rompe en silencio la primera vez que alguien renombra un campo.
 */

const SERVICE = fs.readFileSync(
    path.join(__dirname, 'vertical-analytics.service.ts'), 'utf8',
);

const CONFIGURATIONS = listVerticalCapabilityConfigurations();

describe('lo que el manifiesto declara es lo que el agregador devuelve', () => {
    it('hay configuraciones que revisar', () => {
        expect(CONFIGURATIONS.length).toBe(76);
    });

    it.each(VERTICAL_MANIFEST_INDUSTRIES.map(industry => [industry] as const))(
        '%s devuelve cada métrica que declara',
        (industry) => {
            const declared = new Set<string>();
            for (const configuration of CONFIGURATIONS) {
                if (configuration.industry !== industry) continue;
                for (const metric of configuration.kpiContract.verticalAnalytics.metrics) {
                    declared.add(metric);
                }
            }
            const missing = [...declared].filter(metric => !SERVICE.includes(`${metric}:`));
            expect(missing).toEqual([]);
        },
    );

    it('el agregado se llama como lo que es', () => {
        // A nivel plataforma la tasa es un promedio ENTRE tenants. Llamarla
        // `completionRatePct` en el contrato decía que era la tasa de un
        // negocio, que es otro número.
        const homeServices = CONFIGURATIONS.find(c => c.industry === 'servicios_hogar')!;
        expect(homeServices.kpiContract.verticalAnalytics.metrics).toContain('avgCompletionRatePct');
        expect(homeServices.kpiContract.verticalAnalytics.metrics).not.toContain('completionRatePct');
    });

    it('un negocio de servicios ve cuántas cerró, no sólo cuántas le quedan', () => {
        const homeServices = CONFIGURATIONS.find(c => c.industry === 'servicios_hogar')!;
        expect(homeServices.kpiContract.verticalAnalytics.metrics).toContain('completed');
        expect(SERVICE).toContain("completed: sum('completed')");
    });

    it('toda industria declara su analítica como implementada o no la declara', () => {
        // "Implementada" sin métricas es peor que "no disponible": el panel
        // muestra una tarjeta vacía en vez de decir que todavía no hay dato.
        for (const configuration of CONFIGURATIONS) {
            const contract = configuration.kpiContract.verticalAnalytics;
            if (contract.availability === 'implemented') {
                expect(contract.metrics.length).toBeGreaterThan(0);
            }
        }
    });

    it('las métricas del panel del tenant también están declaradas', () => {
        for (const configuration of CONFIGURATIONS) {
            expect(configuration.kpiContract.dashboard.length).toBeGreaterThan(0);
        }
    });
});
