#!/usr/bin/env node
/**
 * docs/business-types-catalog.md - the catalogue of industries and business
 * types, DERIVED from the registries the runtime itself reads.
 *
 * Why a script and not a document: by October 2026 the repository had seven
 * documents that each stated "how many verticals / business types Parallly
 * has" and no two agreed (17, 18, 20, 75, 76, 80 ...). A hand-written list is
 * trusted until the next commit; a generated one is compared against the code
 * in CI (`--check`, wired through docs/audits/2026-09-09/verify-artifacts.cjs)
 * and the build goes red the day somebody adds a business type without
 * regenerating it.
 *
 * Vocabulary (the same one the owner reads in the sign-up form):
 *   - industria  (internal: "vertical") ........ `VERTICAL_REGISTRY`, 20 entries
 *   - tipo de negocio (internal: "subtype") .... `industry/subtype` profile id
 *
 * Sources, all read in-process and read-only (no database, no network):
 *   - apps/api/src/modules/verticals/vertical-definitions.ts      industries, subtype names, recipes, menu label overrides
 *   - packages/shared/src/subtype-experience-profile.ts           profile ids, availability (selectable / waitlist / legacy_only)
 *   - packages/shared/src/vertical-capability-manifest.ts         capabilities, tool families, primary object
 *   - packages/shared/src/vertical-product-policy.ts              product mode per industry
 *   - apps/api/src/modules/conversations/agent-tool-registry.ts   tool families -> tools
 *   - apps/api/src/modules/conversations/tool-policy-registry.ts  the full list of static tools (family or not)
 *   - apps/api/src/modules/verticals/subtype-navigation.ts        menu labels that depend on the business type
 *   - apps/dashboard/src/lib/vertical-dashboard-resolver.ts       which menu modules each type shows
 *   - apps/dashboard/messages/es.json                             Spanish labels (menu, industries, editor)
 *
 * The output carries NO date and NO git revision on purpose: a docs-only
 * commit moves HEAD without changing any authority, and `--check` must not
 * go red for it.
 *
 * Usage:  node apps/api/scripts/business-types-catalog.cjs --write
 *         node apps/api/scripts/business-types-catalog.cjs --check
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUT = path.join(ROOT, 'docs', 'business-types-catalog.md');

require(path.join(ROOT, 'node_modules/ts-node')).register({
  project: path.join(ROOT, 'apps/api/tsconfig.json'),
  transpileOnly: true,
});
require(path.join(ROOT, 'node_modules/tsconfig-paths')).register({
  baseUrl: ROOT,
  paths: {
    '@parallext/shared': ['packages/shared/src/index.ts'],
    '@modules/*': ['apps/api/src/modules/*'],
    '@common/*': ['apps/api/src/common/*'],
    '@config/*': ['apps/api/src/config/*'],
  },
});

const shared = require(path.join(ROOT, 'packages/shared/src/index.ts'));
const defs = require(path.join(ROOT, 'apps/api/src/modules/verticals/vertical-definitions.ts'));
const registry = require(path.join(ROOT, 'apps/api/src/modules/conversations/agent-tool-registry.ts'));
const toolPolicy = require(path.join(ROOT, 'apps/api/src/modules/conversations/tool-policy-registry.ts'));
const subtypeNav = require(path.join(ROOT, 'apps/api/src/modules/verticals/subtype-navigation.ts'));
const dashboard = require(path.join(ROOT, 'apps/dashboard/src/lib/vertical-dashboard-resolver.ts'));
const navContract = require(path.join(ROOT, 'apps/dashboard/src/lib/navigation-contract.ts'));
const es = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/dashboard/messages/es.json'), 'utf8'));

// ---------------------------------------------------------------------------
// Spanish vocabulary for enumerations
// ---------------------------------------------------------------------------

const AVAILABILITY_ES = {
  selectable: 'seleccionable',
  waitlist: 'lista de espera',
  legacy_only: 'solo cuentas existentes',
  pilot: 'piloto',
};
const MODE_ES = {
  certification_anchor: 'ancla de certificación',
  vertical_product: 'producto vertical',
  horizontal_preset: 'preset horizontal',
  generic_fallback: 'genérico (fallback)',
};
const CERT_ES = {
  implemented_not_certified: 'implementado, no certificado',
  certified: 'certificado',
};

const navItems = es.nav.items;
const navSections = es.nav.sections;
const industryLabels = es.onboarding.industries;
const capabilityLabels = es.agent.capabilities; // pantalla Agente IA -> Capacidades
const fieldLabels = es.agentConfiguration.fields; // respaldo (editor asistido)

// ---------------------------------------------------------------------------
// Collect every industry / business type exactly once
// ---------------------------------------------------------------------------

function availabilityOf(industry, subtype) {
  if (shared.isAliasedSubtype(industry, subtype)) return 'legacy_only';
  return shared.resolveSubtypeExperienceProfile(industry, subtype).availability;
}

const canonicalIds = new Set(shared.listCanonicalSubtypeExperienceProfileIds());
const labelOf = new Map(); // profileId -> Spanish name from the definition
const industries = Object.keys(defs.VERTICAL_REGISTRY);
for (const industry of industries) {
  for (const sub of defs.VERTICAL_REGISTRY[industry].subTypes) {
    labelOf.set(shared.subtypeProfileId(industry, sub.key), sub.label.es);
  }
}

const profileIdsByIndustry = new Map(industries.map(industry => [industry, []]));
for (const id of shared.listSubtypeExperienceProfileIds()) {
  const industry = id.split('/')[0];
  if (!profileIdsByIndustry.has(industry)) throw new Error(`business_types_catalog: unknown industry in profile ${id}`);
  profileIdsByIndustry.get(industry).push(id);
}
// Registry order first (that is the order the sign-up form shows), then any
// profile that exists only in the experience-profile table.
for (const industry of industries) {
  const registryOrder = defs.VERTICAL_REGISTRY[industry].subTypes
    .map(sub => shared.subtypeProfileId(industry, sub.key));
  const rest = profileIdsByIndustry.get(industry).filter(id => !registryOrder.includes(id));
  profileIdsByIndustry.set(industry, [...new Set([...registryOrder, ...rest])]);
}

// ---------------------------------------------------------------------------
// Tool families
// ---------------------------------------------------------------------------

const familyTools = new Map(registry.TOOL_FAMILIES.map(family => [
  String(family.key), family.tools.map(tool => String(tool.name)),
]));
const CAPABILITY_TITLE_KEY = {
  appointments: 'appointmentScheduling', catalog: 'catalogTitle', faqs: 'faqsTitle', policies: 'policiesTitle',
  offers: 'offersTitle', orders: 'ordersTitle', crm: 'crmTitle', knowledge: 'knowledgeTitle',
  ecommerce: 'ecommerceTitle',
};
const familyEditorName = key => capabilityLabels[CAPABILITY_TITLE_KEY[key] || `vt_${key}_title`]
  || fieldLabels[`tools_${key}_enabled`] || null;

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function sectionOf(item) {
  const kind = shared.navigationSurfaceKind(item);
  return kind === 'catalogue' ? navSections.catalogAndResources : navSections.dailyWork;
}

function menuFor(industry, subtype, manifest) {
  const definition = defs.getVerticalDefinition(industry, subtype);
  const config = subtypeNav.withSubtypeNavigation({
    industry,
    subType: subtype,
    terminology: definition.terminology,
    sidebar: definition.sidebar,
    dashboard: definition.dashboard,
    bookingEnabled: definition.bookingEnabled,
  });
  const overrides = config.sidebar.labelOverrides || {};
  const hidden = new Set(config.sidebar.hiddenItems || []);
  const label = key => navContract.resolveNavigationDisplayLabel(key, navItems[key], 'es', overrides);
  const resolution = dashboard.resolveVerticalDashboard({
    industry,
    subType: subtype,
    manifestVersion: manifest.manifestVersion,
    effectiveCapabilities: manifest.capabilities,
  });
  const order = config.sidebar.itemOrder || [];
  const items = resolution.visibleItems
    .filter(item => !hidden.has(item))
    .sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
    })
    .map(item => ({
      item,
      label: label(item),
      section: sectionOf(item),
      route: Object.entries({ ...subtypeNav.VERTICAL_ROUTE_NAV_ITEM }).find(([, v]) => v === item)?.[0] || null,
    }));
  return { crm: label('crm'), pipeline: label('pipeline'), items };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const rows = [];
for (const industry of industries) {
  for (const id of profileIdsByIndustry.get(industry)) {
    const [, rawSub] = id.split('/');
    const subtype = rawSub === '__none__' ? null : rawSub;
    const profile = shared.resolveSubtypeExperienceProfile(industry, subtype);
    const manifest = profile.capability;
    const availability = availabilityOf(industry, subtype);
    rows.push({
      id,
      industry,
      subtype,
      name: labelOf.get(id) || (industry === 'otro' ? 'Otro (sin tipo de negocio)' : id),
      availability,
      canonical: canonicalIds.has(id),
      resolvesTo: profile.id !== id ? profile.id : null,
      primaryObject: manifest.primaryObject,
      families: manifest.toolGroups,
      tools: manifest.toolGroups.flatMap(group => familyTools.get(group) || []),
      menu: menuFor(industry, subtype, manifest),
      blockedReason: profile.blockedReason || null,
      migratesTo: profile.migratesTo || null,
    });
  }
}

const count = predicate => rows.filter(predicate).length;
const signupIndustries = industries.filter(industry => rows.some(r => r.industry === industry && r.availability === 'selectable'));
const toolsInFamilies = new Set([...familyTools.values()].flat());
const toolsOutsideFamilies = toolPolicy.STATIC_TOOL_NAMES.filter(name => !toolsInFamilies.has(name));
const familyToolTotal = [...familyTools.values()].reduce((sum, tools) => sum + tools.length, 0);
if (familyToolTotal !== toolsInFamilies.size) {
  throw new Error('business_types_catalog: una herramienta figura en dos familias; corrige la redaccion del glosario');
}

const L = [];
const push = (...lines) => L.push(...lines);

push(
  '<!-- GENERADO. No editar a mano: regenera con `node apps/api/scripts/business-types-catalog.cjs --write`. -->',
  '',
  '# Catálogo de industrias y tipos de negocio',
  '',
  '> **Documento generado desde el código.** No lo edites a mano: tus cambios se pierden y el CI falla si el archivo no coincide con los registros.',
  '>',
  '> - Regenerar: `node apps/api/scripts/business-types-catalog.cjs --write`',
  '> - Comprobar (lo que corre el CI): `node apps/api/scripts/business-types-catalog.cjs --check`, invocado por `docs/audits/2026-09-09/verify-artifacts.cjs`.',
  '> - Si añades una industria, un tipo de negocio, una familia de herramientas o cambias su disponibilidad, regenera y confirma el resultado en el mismo commit.',
  '',
  'Este es el único listado vigente de industrias y tipos de negocio. Cualquier cifra o lista distinta en otro documento está desactualizada: manda este archivo.',
  '',
  '## Glosario',
  '',
  '- **Industria** (en el código y en documentos antiguos: «vertical»): el sector del negocio. Es el primer selector del alta, rotulado «Industria».',
  '- **Tipo de negocio** (en el código: «subtipo» o «perfil»): la especialidad dentro de la industria, identificada como `industria/tipo`. Es el segundo selector del alta, rotulado «Tipo de negocio». Define el menú, las herramientas del agente y los datos que el dueño debe cargar.',
  '- **Disponibilidad** de un tipo de negocio:',
  '  - *seleccionable*: aparece en el alta y se puede elegir.',
  '  - *lista de espera*: existe como tipo canónico pero no se ofrece en el alta; su operación completa sigue cerrada hasta cumplir las puertas indicadas en su ficha («Motivo del cierre»). Lo que se publica hoy para cada uno está en su ficha.',
  '  - *solo cuentas existentes* (`legacy_only` o alias): ya no se ofrece; sigue funcionando para los tenants que lo tenían.',
  '- **Modo de producto**: cómo trata el producto a la industria (ancla de certificación, producto vertical, preset horizontal o genérico). Ninguna industria está certificada hoy salvo que la tabla diga otra cosa.',
  '- **Familia de herramientas**: grupo de herramientas del agente que el dueño activa en el editor del agente. Una herramienta pertenece a una sola familia.',
  '',
  '## Resumen',
  '',
  `- **${industries.length} industrias** en el registro; **${signupIndustries.length}** se ven en el alta (${industries.filter(i => !signupIndustries.includes(i)).map(i => `\`${i}\``).join(' y ')} solo tienen tipos en lista de espera y el selector las oculta).`,
  `- **${rows.length} configuraciones** industria/tipo resolubles: **${count(r => r.canonical)} tipos de negocio canónicos** (${count(r => r.availability === 'selectable' && r.canonical)} seleccionables + ${count(r => r.availability === 'waitlist')} en lista de espera) y ${count(r => !r.canonical)} que solo existen para cuentas anteriores (\`legacy_only\` o alias).`,
  `- **${toolPolicy.STATIC_TOOL_NAMES.length} herramientas estáticas del agente**: ${toolsInFamilies.size} repartidas en **${registry.TOOL_FAMILIES.length} familias** y ${toolsOutsideFamilies.length} fuera de familia (cobros, identidad y herramientas de proveedor externo, ver más abajo). Las herramientas de integraciones MCP son dinámicas y no figuran aquí.`,
  `- Recetas de industria (contenido inicial que se siembra en el alta): ${industries.filter(i => defs.VERTICAL_REGISTRY[i].recipe).map(i => `\`${i}\``).join(', ')}. Las demás industrias nacen con la definición base. \`otro\` genera su propia receta con IA a partir de la descripción del alta. Educación añade cuatro capas de tipo (academia de baile, academia de música o arte, clases particulares y autoescuela).`,
  '',
  '## Industrias',
  '',
  '| Industria (`id`) | Nombre en el alta | Modo de producto | Certificación | En el alta | Receta | Tipos (selec. / espera / existentes) |',
  '|---|---|---|---|---|---|---|',
);
for (const industry of industries) {
  const policy = shared.VERTICAL_PRODUCT_POLICY[industry];
  const own = rows.filter(r => r.industry === industry);
  push(`| \`${industry}\` | ${industryLabels[industry] || '—'} | ${MODE_ES[policy.mode]} | ${CERT_ES[policy.certificationState]} | ${signupIndustries.includes(industry) ? 'sí' : 'no'} | ${defs.VERTICAL_REGISTRY[industry].recipe ? 'sí' : 'no'} | ${own.filter(r => r.availability === 'selectable').length} / ${own.filter(r => r.availability === 'waitlist').length} / ${own.filter(r => r.availability === 'legacy_only').length} |`);
}

push(
  '',
  `Anclas de certificación: ${shared.VERTICAL_CERTIFICATION_ANCHORS.map(i => `\`${i}\``).join(', ')}. Los nombres de la columna «Nombre en el alta» son los del selector (\`onboarding.industries\` en \`apps/dashboard/messages/es.json\`).`,
  '',
  '## Familias de herramientas',
  '',
  'Nombre = cómo rotula la familia la pantalla Agente IA → Capacidades (`agent.capabilities` en `apps/dashboard/messages/es.json`). El manifiesto de cada tipo de negocio decide qué familias se publican (línea «Familias de herramientas» de cada ficha) y el dueño las enciende en el editor del agente. Las familias `crm`, `knowledge`, `policies`, `offers`, `orders` y `ecommerce` no figuran en ningún tipo porque no dependen de él: las activa la configuración del agente.',
  '',
  '| Familia | Nombre en el editor | Herramientas |',
  '|---|---|---|',
);
for (const [key, tools] of familyTools) {
  push(`| \`${key}\` | ${familyEditorName(key) || '—'} | ${tools.map(t => `\`${t}\``).join(', ')} |`);
}
push(
  '',
  `Herramientas estáticas fuera de familia: ${toolsOutsideFamilies.map(t => `\`${t}\``).join(', ')}. Las de cobros (\`apply_discount\`, \`create_payment_link\`, \`get_payment_status\`, \`refund_payment\`) requieren la familia de pagos (\`payments\`) y el plan correspondiente, \`request_identity_code\` y \`verify_identity_code\` son las de verificación de identidad, y las cuatro restantes (origen «proveedor») solo existen mientras el tenant tiene conectado el sistema externo correspondiente.`,
  '',
  'Subpermisos que el dueño puede apagar dentro de una familia: ' +
    registry.TOOL_SUBPERMISSION_RULES.map(rule => `\`${rule.family}.${rule.flag}\` (${rule.tools.map(t => `\`${t}\``).join(', ')})`).join('; ') + '.',
  '',
  '## Ids antiguos que ya no se pueden elegir (alias)',
  '',
  'Estos ids siguen resolviendo para que ninguna cuenta cambie de producto sin avisar. Nunca vuelven al selector del alta.',
  '',
  '| Id antiguo | Se resuelve como |',
  '|---|---|',
  ...Object.entries(shared.SUBTYPE_ALIASES).map(([from, to]) => {
    const [i, sub] = to.split('/');
    const target = defs.VERTICAL_REGISTRY[i].subTypes.find(st => st.key === sub);
    return `| \`${from}\` | \`${to}\`${target ? ` (${target.label.es})` : ''} |`;
  }),
  '',
  '## Tipos de negocio por industria',
  '',
  'Cómo leer cada ficha:',
  '',
  '- **Menú**: lo que ve el dueño en la barra lateral para ese tipo de negocio, con el nombre exacto del menú (varía por industria y por tipo) y la sección donde aparece. «CRM» es el ítem de personas (la pantalla de contactos) y «Embudo» el del embudo de ventas; ambos se renombran por industria. Además de lo listado, todos ven Conversaciones, Agente IA, Base de conocimiento, Campañas, Analíticas, Canales, Usuarios y Facturación según su rol y plan.',
  '- **Familias y herramientas**: las que el producto publica para ese tipo. Las herramientas se limitan además por plan, rol y por lo que el dueño active en el editor del agente.',
  '',
);

for (const industry of industries) {
  const policy = shared.VERTICAL_PRODUCT_POLICY[industry];
  const own = rows.filter(r => r.industry === industry);
  push(
    `### ${industryLabels[industry] || industry} (\`${industry}\`)`,
    '',
    `Modo de producto: ${MODE_ES[policy.mode]} · ${CERT_ES[policy.certificationState]} · ${signupIndustries.includes(industry) ? 'visible en el alta' : 'oculta en el alta'} · receta de industria: ${defs.VERTICAL_REGISTRY[industry].recipe ? 'sí' : 'no'}.`,
    '',
  );
  for (const row of own) {
    push(`#### ${row.name} — \`${row.id}\``, '');
    const status = [`**${AVAILABILITY_ES[row.availability] || row.availability}**`];
    if (row.resolvesTo) status.push(`alias de \`${row.resolvesTo}\` (las cuentas nuevas usan ese)`);
    if (!row.canonical && !row.resolvesTo) status.push('no canónico');
    push(`- Disponibilidad: ${status.join(' · ')}.`);
    if (row.blockedReason) push(`- Motivo del cierre: ${row.blockedReason}`);
    if (row.migratesTo) push(`- Migra a: \`${row.migratesTo}\`.`);
    if (row.resolvesTo) {
      push(`- Menú y herramientas: los de \`${row.resolvesTo}\`.`, '');
      continue;
    }
    push(`- Objeto principal: \`${row.primaryObject}\`.`);
    const modules = row.menu.items.map(m => `«${m.label}»${m.route ? ` (\`${m.route}\`)` : ''} en ${m.section}`);
    push(`- Menú: CRM «${row.menu.crm}», Embudo «${row.menu.pipeline}»${modules.length ? '; ' + modules.join('; ') : '; sin módulos propios del tipo de negocio'}.`);
    push(`- Familias de herramientas: ${row.families.map(f => `\`${f}\``).join(', ')}.`);
    push(`- Herramientas: ${row.tools.map(t => `\`${t}\``).join(', ')}.`, '');
  }
}

const content = L.join('\n').replace(/[ \t]+$/gm, '') + '\n';

const canonical = text => text.replace(/\r\n/g, '\n');
if (process.argv.includes('--write')) {
  fs.writeFileSync(OUT, content);
  process.stdout.write(`business-types-catalog: escrito ${path.relative(ROOT, OUT)} (${industries.length} industrias, ${rows.length} configuraciones)\n`);
} else if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? canonical(fs.readFileSync(OUT, 'utf8')) : null;
  if (current !== content) {
    process.stderr.write('business_types_catalog_stale: docs/business-types-catalog.md no coincide con los registros. Regenera con: node apps/api/scripts/business-types-catalog.cjs --write\n');
    process.exit(1);
  }
  process.stdout.write(`business-types-catalog: al día (${industries.length} industrias, ${rows.length} configuraciones)\n`);
} else {
  process.stdout.write(content);
}
