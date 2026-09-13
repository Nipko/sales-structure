const fs = require('node:fs');
const path = require('node:path');

const read = (root, relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const exists = (root, relative) => fs.existsSync(path.join(root, relative));

const REQUIRED_CLAIM_CHECKS = Object.freeze([
    'generate-whatsapp-rate-projection.cjs --check',
    'generate-localized-sitemap.cjs --check',
    'validate-i18n-parity.cjs',
    'test-whatsapp-cost-estimate.cjs',
    'validate-marketing-claims.cjs',
    'test-marketing-claim-regressions.cjs',
    'validate-competitive-evidence.cjs',
]);

function landingAuthorities({ root }) {
    const landing = relative => `apps/landing/${relative}`;
    const packageJson = JSON.parse(read(root, landing('package.json')));
    const claimCommand = String(packageJson.scripts?.['check:claims'] ?? '');
    const buildCommand = String(packageJson.scripts?.build ?? '');
    const seoSource = read(root, landing('src/lib/seo.ts'));
    const langProvider = read(root, landing('src/components/LangProvider.tsx'));
    const sitemap = read(root, landing('public/sitemap.xml'));
    const comparison = read(root, landing('src/data/meta-comparison.ts'));
    const paymentModel = read(root, landing('src/data/payment-model.ts'));
    const demos = read(root, landing('src/data/demo-catalog.ts'));

    const claimGaps = REQUIRED_CLAIM_CHECKS.filter(check => !claimCommand.includes(check));
    const offerGaps = [
        ['catálogo proyectado', landing('src/data/pricing.ts')],
        ['proyección de tarifas Meta', landing('src/data/whatsapp-rate-projection.generated.ts')],
        ['registro de capacidades', landing('src/data/product-capabilities.ts')],
        ['borrador de revisión comercial/legal', landing('drafts/legal-commercial-review-2026-09-12.md')],
    ].filter(([, file]) => !exists(root, file)).map(([label]) => label);
    const paymentGaps = [
        paymentModel.includes('id: "subscription"') ? null : 'suscripción Parallly',
        paymentModel.includes('id: "whatsappDelivery"') ? null : 'cobro de entrega Meta',
        paymentModel.includes('id: "customerPayments"') ? null : 'cobro del negocio a su cliente',
        exists(root, landing('src/app/(marketing)/costos-whatsapp/page.tsx')) ? null : 'ruta de costos de WhatsApp',
    ].filter(Boolean);
    const demonstrationGaps = [
        ...['appointment', 'orderPayment', 'handoff', 'configuration']
            .filter(id => !demos.includes(`id: "${id}"`)).map(id => `demo ${id}`),
        comparison.includes('export const COMPARISON_TASKS') ? null : 'comparación tarea por tarea',
        exists(root, landing('src/app/(marketing)/comparar/meta-business-agent/page.tsx'))
            ? null : 'ruta de comparación con Meta',
    ].filter(Boolean);

    const seoGaps = [
        exists(root, landing('src/app/[locale]/layout.tsx')) ? null : 'rutas estáticas por idioma',
        seoSource.includes('languages:') ? null : 'alternativas hreflang en metadata',
        /hreflang=/.test(sitemap) ? null : 'alternativas hreflang en sitemap',
        langProvider.includes('initialLocale') ? null : 'idioma de ruta fijado antes de hidratar',
        langProvider.includes('window.location') ? null : 'selector que navega a la URL del idioma',
        buildCommand.includes('postprocess-localized-html.cjs') ? null : 'atributo lang del HTML exportado',
    ].filter(Boolean);
    const legalGaps = ['terms', 'privacy', 'data-policy'].flatMap(section =>
        ['es', 'en', 'pt', 'fr']
            .filter(locale => !exists(root, landing(`src/app/${section}/content/${locale}.tsx`)))
            .map(locale => `${section}/${locale}`));
    const validationGaps = [
        ...claimGaps,
        packageJson.scripts?.build?.includes('check:claims') ? null : 'build sin gate de claims',
    ].filter(Boolean);

    return Object.freeze({
        claimGaps, offerGaps, paymentGaps, demonstrationGaps, seoGaps, legalGaps, validationGaps,
        locales: 4,
        comparisonTasks: (comparison.match(/id:\s*"[^"]+"/g) ?? []).length,
    });
}

function landingRows(row, authority) {
    const local = gaps => gaps.length;
    return [
        row('L0', { provenance: 'derived', open: local(authority.claimGaps),
            openLabel: `${authority.claimGaps.length} verificadores comerciales ausentes del build`,
            evidence: 'La autoridad comercial está en registros versionados y seis verificadores independientes; el build público ejecuta el conjunto completo.' }),
        row('L1', { provenance: 'derived', open: local(authority.offerGaps),
            openLabel: `${authority.offerGaps.length} proyecciones de oferta sin autoridad`,
            evidence: 'Planes, capacidades, tarifas de WhatsApp y decisiones pendientes salen de fuentes versionadas; no se completan con cifras de diseño.' }),
        row('L2', { provenance: 'derived', open: local(authority.paymentGaps),
            openLabel: `${authority.paymentGaps.length} relaciones de pago sin separar`,
            evidence: 'La web distingue suscripción a Parallly, entregas que Meta cobra a la WABA y pagos que el cliente final hace directamente al negocio.' }),
        row('L3', { provenance: 'derived', open: local(authority.demonstrationGaps),
            openLabel: `${authority.demonstrationGaps.length} demostraciones o comparaciones sin contrato`,
            evidence: 'Cuatro demos ilustrativas declaran su naturaleza y evidencia; la comparación con Meta tiene superficie, fecha, fuente y límites.' }),
        row('L4', { provenance: 'derived', open: local(authority.seoGaps),
            openLabel: `${authority.seoGaps.length} brechas de rutas localizadas, metadata o sitemap`,
            evidence: `La paridad cubre ${authority.locales} idiomas. Las URLs indexables, el HTML inicial, canonical, hreflang y sitemap se miden por estructura, no por una cookie de navegador.` }),
        row('L5', { provenance: 'derived', open: local(authority.legalGaps),
            openLabel: `${authority.legalGaps.length} variantes legales ausentes`, gates: [8],
            evidence: 'Términos, privacidad y tratamiento tienen contenido en cuatro idiomas y un borrador coordinado. La aprobación de responsables legal y financiero sigue siendo externa.' }),
        row('L6', { provenance: 'derived', open: local(authority.validationGaps),
            openLabel: `${authority.validationGaps.length} gates locales de validación ausentes`, gates: [3, 5],
            evidence: 'El build ejecuta paridad, claims, regresiones adversarias, costos y evidencia competitiva. La comprensión con usuarios nuevos y el ensayo del candidato pertenecen a sus gates externos.' }),
    ];
}

module.exports = { REQUIRED_CLAIM_CHECKS, landingAuthorities, landingRows };
