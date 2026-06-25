// scripts/fiscal-backfill-report.js
// READ-ONLY. Lists Colombian (billingCountry='CO') tenants whose fiscal profile
// (tenant.settings.fiscalData) is missing/incomplete, plus how many fiscal
// invoices already FAILED for each. Run this BEFORE turning on the fiscal gate
// (fiscal.gate_enabled) so you know who to contact. Makes no writes.
//
//   docker compose -f infra/docker/docker-compose.prod.yml run --rm api \
//     node scripts/fiscal-backfill-report.js
//
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Mirrors apps/api/src/modules/fiscal/fiscal-data.util.ts (sans the NIT DV check,
// which is enforced at the form/gate — for a report, presence is enough).
function fiscalDataComplete(settings) {
  const fd = settings && settings.fiscalData;
  if (!fd || typeof fd !== 'object') return false;
  if (!fd.documentType || !fd.documentId || !fd.legalOrganizationId) return false;
  if (fd.legalOrganizationId === '1' && !fd.businessName) return false; // persona jurídica
  if (fd.legalOrganizationId === '2' && !fd.names) return false; // persona natural
  return true;
}

async function main() {
  const tenants = await prisma.tenant.findMany({
    where: { billingCountry: 'CO' },
    select: { id: true, name: true, slug: true, subscriptionStatus: true, settings: true },
    orderBy: { name: 'asc' },
  });

  if (tenants.length === 0) {
    console.log('No hay tenants con billingCountry = CO.');
    return;
  }

  let missing = 0;
  let withFailed = 0;
  const rows = [];

  for (const t of tenants) {
    const complete = fiscalDataComplete(t.settings);
    const failed = await prisma.fiscalInvoice.count({ where: { tenantId: t.id, status: 'failed' } });
    if (!complete) missing++;
    if (failed > 0) withFailed++;
    rows.push({
      name: t.name || t.slug || t.id,
      status: t.subscriptionStatus || '—',
      fiscal: complete ? 'OK' : 'FALTA',
      failed,
    });
  }

  console.log(`\n=== Reporte fiscal — tenants CO (${tenants.length}) ===\n`);
  console.log('NOMBRE'.padEnd(28) + 'PLAN'.padEnd(14) + 'FISCAL'.padEnd(8) + 'FACT.FALLIDAS');
  console.log('-'.repeat(70));
  for (const r of rows) {
    console.log(
      String(r.name).slice(0, 27).padEnd(28) +
        String(r.status).slice(0, 13).padEnd(14) +
        r.fiscal.padEnd(8) +
        (r.failed > 0 ? String(r.failed) : ''),
    );
  }
  console.log('-'.repeat(70));
  console.log(`\nTotal CO: ${tenants.length} · sin datos fiscales: ${missing} · con facturas fallidas: ${withFailed}\n`);
  console.log('Antes de activar fiscal.gate_enabled, contacta a los "FALTA" para que completen su NIT en /admin/settings/fiscal.');
  console.log('Las facturas fallidas se re-emiten desde /admin/fiscal (Retry) una vez completados los datos.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
