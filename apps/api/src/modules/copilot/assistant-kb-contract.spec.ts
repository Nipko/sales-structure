import * as fs from 'fs';
import {
  DASHBOARD_PAGE_RULES,
  VERTICAL_MANIFEST_INDUSTRIES,
  dashboardRoleCanOpen,
  listCanonicalSubtypeExperienceProfileIds,
  resolveSubtypeExperienceProfile,
} from '@parallext/shared';
import * as path from 'path';

const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
const ALLOWED_ROLES = new Set([
  'tenant_admin',
  'tenant_supervisor',
  'tenant_agent',
]);
const EXPECTED_IDS = [
  'primeros-pasos',
  'canales-whatsapp',
  'canales-redes',
  'canales-email-widget',
  'multi-cuenta',
  'agentes-ia',
  'probar-agente',
  'inbox',
  'crm-contactos',
  'pipeline',
  'citas-calendarios',
  'broadcast',
  'sms-creditos',
  'base-conocimiento',
  'automatizacion',
  'analytics-reportes',
  'facturacion-planes',
  'cuenta-seguridad',
  'solucion-problemas',
  'navegacion-configuracion',
  'modulos-industria',
  'integraciones-desarrolladores',
  'configuracion-gobierno',
  'operacion-comercial',
  'app-movil',
  'centro-calidad-agente',
  'herramientas-tipo-negocio',
  'privacidad-medios',
].sort();
const VERTICAL_LABELS: Record<(typeof LOCALES)[number], Record<string, string>> = {
  es: {
    salud: 'salud', moda_belleza: 'moda y belleza', inmobiliaria: 'inmobiliaria', restaurantes: 'restaurantes', automotriz: 'automotriz', turismo: 'turismo', education: 'educación', finanzas: 'finanzas', servicios_profesionales: 'servicios profesionales', retail: 'retail', technology: 'tecnología', veterinaria: 'veterinaria', gimnasios: 'gimnasios', seguros: 'seguros', servicios_hogar: 'servicios del hogar', pet_services: 'servicios para mascotas', fotografia: 'fotografía', event_planning: 'planeación de eventos', construccion: 'construcción', otro: 'otros',
  },
  en: {
    salud: 'healthcare', moda_belleza: 'fashion and beauty', inmobiliaria: 'real estate', restaurantes: 'restaurants', automotriz: 'automotive', turismo: 'tourism', education: 'education', finanzas: 'finance', servicios_profesionales: 'professional services', retail: 'retail', technology: 'technology', veterinaria: 'veterinary', gimnasios: 'fitness', seguros: 'insurance', servicios_hogar: 'home services', pet_services: 'pet services', fotografia: 'photography', event_planning: 'event planning', construccion: 'construction', otro: 'other',
  },
  pt: {
    salud: 'saúde', moda_belleza: 'moda e beleza', inmobiliaria: 'imobiliário', restaurantes: 'restaurantes', automotriz: 'automotivo', turismo: 'turismo', education: 'educação', finanzas: 'finanças', servicios_profesionales: 'serviços profissionais', retail: 'varejo', technology: 'tecnologia', veterinaria: 'veterinária', gimnasios: 'academias', seguros: 'seguros', servicios_hogar: 'serviços domésticos', pet_services: 'serviços para pets', fotografia: 'fotografia', event_planning: 'planejamento de eventos', construccion: 'construção', otro: 'outros',
  },
  fr: {
    salud: 'santé', moda_belleza: 'mode et beauté', inmobiliaria: 'immobilier', restaurantes: 'restaurants', automotriz: 'automobile', turismo: 'tourisme', education: 'éducation', finanzas: 'finance', servicios_profesionales: 'services professionnels', retail: 'commerce de détail', technology: 'technologie', veterinaria: 'vétérinaire', gimnasios: 'fitness', seguros: 'assurances', servicios_hogar: 'services à domicile', pet_services: 'services animaliers', fotografia: 'photographie', event_planning: "organisation d'événements", construccion: 'construction', otro: 'autre',
  },
};

interface Article {
  file: string;
  id: string;
  title: string;
  routes: string[];
  roles: string[];
  keywords: string[];
  body: string;
  raw: string;
}

const kbRoot = path.resolve(__dirname, '../../../kb/assistant');
const navigationContractPath = path.resolve(
  __dirname,
  '../../../../dashboard/src/lib/navigation-contract.ts',
);
const dashboardRolesPath = path.resolve(
  __dirname,
  '../../../../dashboard/src/lib/roles.ts',
);
const dashboardMessagesRoot = path.resolve(__dirname, '../../../../dashboard/messages');
const whatsappSeedTemplatesPath = path.resolve(
  __dirname,
  '../whatsapp/seed-templates.config.ts',
);

function parseArticle(file: string): Article {
  const raw = fs.readFileSync(file, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/);
  if (!match) throw new Error(`${file} has invalid or missing frontmatter`);

  const fields = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
  }

  const parseArray = (name: string): string[] => {
    const value = fields.get(name);
    if (!value) throw new Error(`${file} is missing ${name}`);
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
      throw new Error(`${file} has an invalid ${name} array`);
    }
    return parsed;
  };

  const unquote = (value: string | undefined): string => {
    if (!value) return '';
    return value.replace(/^"|"$/g, '').trim();
  };

  return {
    file,
    id: unquote(fields.get('id')),
    title: unquote(fields.get('title')),
    routes: parseArray('routes'),
    roles: parseArray('roles'),
    keywords: parseArray('keywords'),
    body: match[2].trim(),
    raw,
  };
}

function loadLocale(locale: (typeof LOCALES)[number]): Article[] {
  return fs
    .readdirSync(path.join(kbRoot, locale))
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => parseArticle(path.join(kbRoot, locale, file)));
}

/**
 * ═══ WHO CAN OPEN A SCREEN IS DATA, AND IT LIVES IN ONE PLACE ═══════════════
 *
 * `dashboard/src/lib/roles.ts` decides which roles a path renders for. The help
 * describes those same screens in prose, and the two drifted apart in the way
 * documentation always drifts: silently, in four languages at once.
 *
 * `canales-whatsapp` said "channel administration is not available to
 * supervisors or agents" on line 15 and, 145 lines later, that "the admin and
 * the supervisor" read the WhatsApp charges card — while `roles.ts` restricts
 * `/admin/channels` to tenant_admin, so a supervisor typing that address is
 * redirected before the card renders. `solucion-problemas`, whose audience
 * includes supervisors and agents and which is what retrieval returns for "the
 * agent stopped answering on WhatsApp", sent all three roles to that same
 * screen.
 *
 * So the audience is READ from `roles.ts` here, resolved exactly the way
 * `canAccessPath` resolves it — exact rules first, then longest prefix, then
 * fail closed. Re-listing the matrix in this file would only prove that two
 * copies of it agree with each other.
 */
const dashboardRolesSource = fs.readFileSync(dashboardRolesPath, 'utf8');

const ROLE_KEY_VALUES: Record<string, string> = Object.fromEntries(
  [...(dashboardRolesSource.match(/export const ROLE_KEYS = \{([\s\S]*?)\} as const;/)?.[1] ?? '')
    .matchAll(/(\w+):\s*"([a-z_]+)"/g)].map((match) => [match[1], match[2]]),
);

/**
 * ═══ READ THE TABLE, DO NOT RE-PARSE IT ═══
 *
 * This used to pull the rules out of `roles.ts` with a regex, which was the
 * only option while the table lived inside a dashboard file the API cannot
 * import. It has moved to `@parallext/shared` — because the API needed to
 * answer "may this person open that screen" before telling them to go there —
 * so the rules are read rather than re-derived, and a regex that quietly
 * matched nothing after a refactor cannot pass again.
 *
 * What is still read from the source is the ABSENCE of a second copy: a future
 * edit that reintroduces the literal table in `roles.ts` would give the two
 * sides something to disagree about, and the case below refuses it.
 */
interface ParsedPageRule {
  prefix: string;
  roles: string[];
  exact: boolean;
}

const dashboardPageRules: ParsedPageRule[] = DASHBOARD_PAGE_RULES.map((rule) => ({
  prefix: rule.prefix,
  roles: [...rule.roles],
  exact: Boolean(rule.exact),
}));

/** The roles `canAccessPath` would let through for a path, tenant roles only. */
function tenantAudience(pathname: string): string[] {
  const exact = dashboardPageRules.find((rule) => rule.exact && rule.prefix === pathname);
  const rule = exact ?? [...dashboardPageRules]
    .filter((candidate) => !candidate.exact)
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((candidate) => (
      pathname === candidate.prefix || pathname.startsWith(`${candidate.prefix}/`)
    ));
  // No rule means no access: `canAccessPath` fails closed, and so does this.
  return (rule?.roles ?? []).filter((role) => ALLOWED_ROLES.has(role));
}

/**
 * Every `### ` block that mentions a marker, joined.
 *
 * All of them rather than the first: the WhatsApp charges card is named in the
 * readiness checklist and again where the article says who reads it, and a
 * grant made in either place is the one a reader acts on.
 */
function subsectionsContaining(body: string, marker: string): string {
  return body
    .split(/^### /m)
    .filter((block) => block.includes(marker))
    .join('\n');
}

describe('Parallly Assist knowledge-base contract', () => {
  const byLocale = Object.fromEntries(
    LOCALES.map((locale) => [locale, loadLocale(locale)]),
  ) as Record<(typeof LOCALES)[number], Article[]>;
  const navigationSource = fs.readFileSync(navigationContractPath, 'utf8');
  const whatsappSeedTemplatesSource = fs.readFileSync(whatsappSeedTemplatesPath, 'utf8');
  const canonicalRoutes = new Set(
    [...navigationSource.matchAll(/pattern:\s*"([^"]+)"/g)].map((match) => match[1]),
  );
  const canonicalVerticalIds = [...VERTICAL_MANIFEST_INDUSTRIES];

  it.each(LOCALES)('%s has the complete, unique article set', (locale) => {
    const articles = byLocale[locale];
    const ids = articles.map((article) => article.id);
    expect(articles).toHaveLength(EXPECTED_IDS.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(EXPECTED_IDS);
    expect(articles.map((article) => path.basename(article.file))).toEqual(
      articles.map((article) => path.basename(article.file)).sort(),
    );
    for (const article of articles) {
      expect(path.basename(article.file)).toMatch(/^\d{2}-[a-z0-9-]+\.md$/);
    }
  });

  it('keeps ids, routes, and roles equivalent in all locales', () => {
    const spanish = new Map(byLocale.es.map((article) => [article.id, article]));
    for (const locale of LOCALES.slice(1)) {
      const translated = new Map(byLocale[locale].map((article) => [article.id, article]));
      for (const id of EXPECTED_IDS) {
        expect(translated.get(id)?.routes).toEqual(spanish.get(id)?.routes);
        expect(translated.get(id)?.roles).toEqual(spanish.get(id)?.roles);
      }
    }
  });

  it.each(LOCALES)('%s has complete frontmatter and useful content', (locale) => {
    for (const article of byLocale[locale]) {
      expect(article.id).toMatch(/^[a-z0-9-]+$/);
      expect(article.title.length).toBeGreaterThan(3);
      expect(article.routes.length).toBeGreaterThan(0);
      expect(article.roles.length).toBeGreaterThan(0);
      expect(article.keywords.length).toBeGreaterThanOrEqual(5);
      expect(article.body).toMatch(/^#\s+\S/m);
      expect(article.body.length).toBeGreaterThan(120);
      expect(new Set(article.routes).size).toBe(article.routes.length);
      expect(new Set(article.roles).size).toBe(article.roles.length);
      expect(new Set(article.keywords).size).toBe(article.keywords.length);
    }
  });

  it('uses only supported roles and canonical dashboard routes', () => {
    for (const locale of LOCALES) {
      for (const article of byLocale[locale]) {
        for (const role of article.roles) expect(ALLOWED_ROLES.has(role)).toBe(true);
        for (const route of article.routes) {
          expect(route).toMatch(/^\/admin(?:\/|$)/);
          expect(route).not.toMatch(/[?#]/);
          expect(canonicalRoutes.has(route)).toBe(true);
        }
      }
    }
  });

  it('reads the dashboard page rules it is about to judge the help against', () => {
    // Without this the three checks below would pass by being vacuous: a
    // renamed constant or a reformatted array turns every audience into the
    // empty set, and "no role can open anything" satisfies nothing honestly.
    expect(Object.values(ROLE_KEY_VALUES)).toEqual(
      expect.arrayContaining([...ALLOWED_ROLES]),
    );
    expect(dashboardPageRules.length).toBeGreaterThan(50);
    // `roles.ts` must CONSUME the shared table, not declare its own. A literal
    // list back in that file is two sources for one fact, which is how the help
    // and the guard came to disagree in the first place.
    expect(dashboardRolesSource).toContain('DASHBOARD_PAGE_RULES');
    expect(dashboardRolesSource).not.toMatch(/export const PAGE_RULES: PageRule\[\] = \[\s*\{/);
    for (const rule of dashboardPageRules) expect(rule.roles).not.toContain(undefined);
    // Every route the help points at must be a route somebody can open. A KB
    // route that resolves to nobody is either a retired page or a rule that was
    // never written, and both send the reader to a redirect.
    for (const article of byLocale.es) {
      for (const route of article.routes) {
        expect({ route, audience: tenantAudience(route) })
          .not.toEqual({ route, audience: [] });
      }
    }
  });

  it('never hands a reader a route their own role is denied', () => {
    /**
     * ═══ A CHECK THAT COMPARED A FUNCTION WITH ITSELF ═══
     *
     * The rule below asks whether a declared role can open ANY route in the
     * frontmatter — vacuous for the defect it was written for:
     * `19-solucion-problemas` is offered to supervisors and agents, they can
     * open `/admin/inbox`, so it passed while the same article's routes
     * include `/admin/broadcast` and `/admin/settings/billing`, which the
     * dashboard denies them. Nineteen such pairs existed.
     *
     * The first replacement was WORSE: it filtered the routes with
     * `dashboardRoleCanOpen` and then asked `tenantAudience` whether each
     * survivor was allowed. Both read the same table, so the answer was yes by
     * construction and the loop could not produce an offence for any input.
     * That is the shape this repository keeps finding — a test that agrees
     * with itself — and it is why the loop is gone.
     *
     * What is left says something that can be false: the filter REMOVES real
     * routes from real articles, and those routes are the ones the finding
     * named. Replace the filter with `() => true` and these go red.
     */
    const removedFor = (articleId: string, role: string): string[] => {
      const article = byLocale.es.find(entry => entry.id === articleId)!;
      return article.routes.filter(route => !dashboardRoleCanOpen(route, role));
    };

    // The article the finding named, and the screens it would have sent them to.
    expect(removedFor('solucion-problemas', 'tenant_agent'))
      .toEqual(expect.arrayContaining(['/admin/broadcast', '/admin/settings/billing']));
    expect(removedFor('solucion-problemas', 'tenant_supervisor'))
      .toEqual(expect.arrayContaining(['/admin/channels', '/admin/settings/billing']));
    // And an admin loses nothing, or the filter would be an outage of its own.
    expect(removedFor('solucion-problemas', 'tenant_admin')).toEqual([]);

    // The runtime has to USE it. A filter nothing calls is a filter that
    // changes nothing, and the defect was entirely in what reached the model.
    const service = fs.readFileSync(
      path.resolve(__dirname, 'copilot.service.ts'), 'utf8');
    expect(service).toContain('dashboardRoleCanOpen');
    // The unfiltered list must not be what gets injected any more.
    expect(service).not.toContain('Ruta en el panel: ${a.routes.join');

    // The predicate itself, on real pairs from this tree.
    expect(dashboardRoleCanOpen('/admin/broadcast', 'tenant_agent')).toBe(false);
    expect(dashboardRoleCanOpen('/admin/settings/billing', 'tenant_supervisor')).toBe(false);
    expect(dashboardRoleCanOpen('/admin/channels/whatsapp', 'tenant_supervisor')).toBe(false);
    expect(dashboardRoleCanOpen('/admin/inbox', 'tenant_agent')).toBe(true);
    // A path no rule matches belongs to nobody, which is how the guard fails.
    expect(dashboardRoleCanOpen('/admin/nothing-here', 'tenant_admin')).toBe(false);
    // A QUERY STRING IS NOT A DIFFERENT SCREEN. `roles.ts` matches
    // `prefix + "?"` and this reader did not, so `/admin/inbox?x=1`
    // resolved to no rule at all — and `dashboardRoleCanOpen` answers
    // `false` for EVERY role on a path that matches nothing. The copilot
    // would then have filed the account owner's own inbox under "ask an
    // administrator". No KB route carries a query today, which is why this
    // was latent rather than live.
    expect(dashboardRoleCanOpen('/admin/inbox?conversation=abc', 'tenant_agent')).toBe(true);
    expect(dashboardRoleCanOpen('/admin/broadcast?tab=sent', 'tenant_agent')).toBe(false);
  });
  it('offers each article only to roles that can open at least one of its screens', () => {
    // Frontmatter `roles` is what retrieval filters on. A role listed there
    // that `roles.ts` denies on every route in the same frontmatter is an
    // article written for somebody who is redirected out of all of it.
    const offences: string[] = [];
    for (const locale of LOCALES) {
      for (const article of byLocale[locale]) {
        for (const role of article.roles) {
          const reachable = article.routes.filter((route) => tenantAudience(route).includes(role));
          if (reachable.length === 0) {
            offences.push(
              `${locale}/${path.basename(article.file)}: offered to ${role}, `
              + `which roles.ts denies on every route (${article.routes.join(', ')})`,
            );
          }
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('never tells a role it can read the WhatsApp charges card when roles.ts says otherwise', () => {
    // The card lives on `/admin/channels/whatsapp`. Which roles may read it is
    // therefore whatever `roles.ts` allows there — not what reads well in a
    // sentence. The forbidden phrasings below are grant shapes ("X reads it",
    // "X can see it") bounded to the same clause, and they are only applied to
    // the roles the rules deny, so widening `roles.ts` later widens what the
    // help is allowed to say instead of failing here.
    const readers = tenantAudience('/admin/channels/whatsapp');
    expect(readers).toContain('tenant_admin');
    const denied = [...ALLOWED_ROLES].filter((role) => !readers.includes(role));
    expect(denied.length).toBeGreaterThan(0);

    const adminNamed: Record<(typeof LOCALES)[number], RegExp> = {
      es: /\*\*administrador\*\*/i,
      en: /\*\*admin\*\*/i,
      pt: /\*\*administrador\*\*/i,
      fr: /\*\*administrateur\*\*/i,
    };
    const grants: Record<(typeof LOCALES)[number], Record<string, RegExp>> = {
      es: {
        tenant_supervisor: /\blee[n]?\b[^.\n]{0,40}supervisor|supervisor(?:es)?[^.\n]{0,40}(?:\blee[n]?\b|puede[n]?\s+(?:ver|leer|abrir|consultar))/i,
        tenant_agent: /\blee[n]?\b[^.\n]{0,40}\bagentes?\b|\bagentes?\b[^.\n]{0,40}(?:\blee[n]?\b|puede[n]?\s+(?:ver|leer|abrir|consultar))/i,
      },
      en: {
        tenant_supervisor: /\breads?\b[^.\n]{0,40}supervisors?|supervisors?[^.\n]{0,40}(?:\breads?\b|can\s+(?:read|see|open|view))/i,
        tenant_agent: /\breads?\b[^.\n]{0,40}\bagents?\b|\bagents?\b[^.\n]{0,40}(?:\breads?\b|can\s+(?:read|see|open|view))/i,
      },
      pt: {
        tenant_supervisor: /\b(?:lê|leem)\b[^.\n]{0,40}supervisor(?:es)?|supervisor(?:es)?[^.\n]{0,40}(?:\b(?:lê|leem)\b|pode[m]?\s+(?:ver|ler|abrir|consultar))/i,
        tenant_agent: /\b(?:lê|leem)\b[^.\n]{0,40}\bagentes?\b|\bagentes?\b[^.\n]{0,40}(?:\b(?:lê|leem)\b|pode[m]?\s+(?:ver|ler|abrir|consultar))/i,
      },
      fr: {
        tenant_supervisor: /\b(?:lit|lisent)\b[^.\n]{0,40}superviseurs?|superviseurs?[^.\n]{0,40}(?:\b(?:lit|lisent)\b|peuvent\s+(?:voir|lire|ouvrir|consulter))/i,
        tenant_agent: /\b(?:lit|lisent)\b[^.\n]{0,40}\bagents?\b|\bagents?\b[^.\n]{0,40}(?:\b(?:lit|lisent)\b|peuvent\s+(?:voir|lire|ouvrir|consulter))/i,
      },
    };

    const offences: string[] = [];
    for (const locale of LOCALES) {
      const messages = JSON.parse(
        fs.readFileSync(path.join(dashboardMessagesRoot, `${locale}.json`), 'utf8'),
      );
      // Located by the label the dashboard actually renders, so a rename there
      // moves this check with it rather than leaving it pointed at nothing.
      const cardTitle: string = messages?.whatsappSpend?.title;
      expect(typeof cardTitle).toBe('string');
      const article = byLocale[locale].find((candidate) => candidate.id === 'canales-whatsapp');
      const subsection = subsectionsContaining(article!.body, `**${cardTitle}**`);
      expect(subsection.length).toBeGreaterThan(80);
      expect(subsection).toMatch(adminNamed[locale]);
      for (const role of denied) {
        if (grants[locale][role].test(subsection)) {
          offences.push(`${locale}/canales-whatsapp: grants the card to ${role}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it('splits the paused-sending fix by what each role can actually do', () => {
    // `solucion-problemas` is what somebody with a silent agent reads, and its
    // audience is every tenant role. Most of its steps live on screens only the
    // admin can open, so the article has to say so once, and the WhatsApp step
    // — the one about money, where the wrong instruction costs a day of silence
    // — has to branch: what the admin does, and what a supervisor or an agent
    // does instead. Required only while `roles.ts` actually denies them the
    // screen; opening `/admin/channels` to supervisors retires this obligation
    // deliberately rather than leaving a stale demand here.
    const troubleshooting = byLocale.es.find(
      (article) => article.id === 'solucion-problemas',
    )!;
    const deniedHere = troubleshooting.roles.filter(
      (role) => !tenantAudience('/admin/channels/whatsapp').includes(role),
    );
    expect(deniedHere).toEqual(['tenant_supervisor', 'tenant_agent']);

    const markers: Record<(typeof LOCALES)[number], {
      administrationScreens: RegExp;
      adminBranch: RegExp;
      otherRolesBranch: RegExp;
    }> = {
      es: {
        administrationScreens: /pantallas de administración[^.\n]{0,140}(?:supervisor|agente)/i,
        adminBranch: /\*\*Si eres administrador\*\*/,
        otherRolesBranch: /\*\*Si eres supervisor o agente\*\*/,
      },
      en: {
        administrationScreens: /administration screens[^.\n]{0,140}(?:supervisor|agent)/i,
        adminBranch: /\*\*If you are the admin\*\*/,
        otherRolesBranch: /\*\*If you are a supervisor or an agent\*\*/,
      },
      pt: {
        administrationScreens: /telas de administração[^.\n]{0,140}(?:supervisor|agente)/i,
        adminBranch: /\*\*Se você é administrador\*\*/,
        otherRolesBranch: /\*\*Se você é supervisor ou agente\*\*/,
      },
      fr: {
        administrationScreens: /écrans d'administration[^.\n]{0,140}(?:superviseur|agent)/i,
        adminBranch: /\*\*Si vous êtes administrateur\*\*/,
        otherRolesBranch: /\*\*Si vous êtes superviseur ou agent\*\*/,
      },
    };

    for (const locale of LOCALES) {
      const article = byLocale[locale].find(
        (candidate) => candidate.id === 'solucion-problemas',
      )!;
      const expected = markers[locale];
      expect({ locale, clause: 'administrationScreens', found: expected.administrationScreens.test(article.body) })
        .toEqual({ locale, clause: 'administrationScreens', found: true });
      expect({ locale, clause: 'adminBranch', found: expected.adminBranch.test(article.body) })
        .toEqual({ locale, clause: 'adminBranch', found: true });
      expect({ locale, clause: 'otherRolesBranch', found: expected.otherRolesBranch.test(article.body) })
        .toEqual({ locale, clause: 'otherRolesBranch', found: true });
    }
  });

  it.each(LOCALES)('%s distinguishes the full profile contract from the selectable offer', (locale) => {
    const labels = VERTICAL_LABELS[locale];
    expect(canonicalVerticalIds).toHaveLength(20);
    expect(Object.keys(labels)).toEqual(expect.arrayContaining(canonicalVerticalIds));

    const profiles = listCanonicalSubtypeExperienceProfileIds().map((id) => {
      const [industry, subtype] = id.split('/');
      return resolveSubtypeExperienceProfile(industry, subtype === '__none__' ? null : subtype);
    });
    const offeredIndustries = new Set(
      profiles.filter((profile) => profile.commercialisable).map((profile) => profile.industry),
    );
    expect(profiles).toHaveLength(76);
    expect(offeredIndustries.size).toBe(18);
    expect(canonicalVerticalIds.filter((industry) => !offeredIndustries.has(industry)))
      .toEqual(['event_planning', 'construccion']);

    const article = byLocale[locale].find(
      (candidate) => candidate.id === 'modulos-industria',
    );
    expect(article).toBeDefined();
    const normalizedBody = article!.body.toLocaleLowerCase(locale);
    for (const label of Object.values(labels)) {
      expect(normalizedBody).toContain(label.toLocaleLowerCase(locale));
    }
    expect(normalizedBody).toMatch(/\b20\b/);
    expect(normalizedBody).toMatch(/\b76\b/);
    expect(normalizedBody).toMatch(/\b18\b/);
  });

  it.each(LOCALES)('%s keeps sensitive and shared workflows scoped to the right roles', (locale) => {
    const articles = new Map(byLocale[locale].map((article) => [article.id, article]));
    expect(articles.get('canales-whatsapp')?.roles).toEqual(['tenant_admin']);
    expect(articles.get('canales-redes')?.roles).toEqual(['tenant_admin']);
    expect(articles.get('multi-cuenta')?.roles).toEqual(['tenant_admin']);
    expect(articles.get('facturacion-planes')?.roles).toEqual(['tenant_admin']);
    expect(articles.get('sms-creditos')?.roles).toEqual([
      'tenant_admin',
      'tenant_supervisor',
    ]);
    expect(articles.get('configuracion-gobierno')?.roles).toEqual([
      'tenant_admin',
      'tenant_supervisor',
    ]);
    expect(articles.get('analytics-reportes')?.roles).toEqual([
      'tenant_admin',
      'tenant_supervisor',
    ]);
    expect(articles.get('app-movil')?.roles).toEqual([
      'tenant_admin',
      'tenant_supervisor',
      'tenant_agent',
    ]);
    expect(articles.get('cuenta-seguridad')?.roles).toEqual([
      'tenant_admin',
      'tenant_supervisor',
      'tenant_agent',
    ]);
    expect(articles.get('centro-calidad-agente')?.roles).toEqual([
      'tenant_admin',
      'tenant_supervisor',
    ]);
  });

  it.each(LOCALES)('%s keeps proactive Agent health bounded and the retired progress pill retired', (locale) => {
    const articles = new Map(byLocale[locale].map((article) => [article.id, article]));
    const quality = articles.get('centro-calidad-agente');
    const setup = articles.get('primeros-pasos');
    expect(quality).toBeDefined();
    expect(setup).toBeDefined();

    const markers: Record<(typeof LOCALES)[number], {
      badge: RegExp;
      banner: RegExp;
      snooze: RegExp;
      privacy: RegExp;
      noExternal: RegExp;
      noAutoEdit: RegExp;
      setupRetired: RegExp;
    }> = {
      es: {
        badge: /señales\s+\*\*Críticas y\s+Altas abiertas\*\*/i,
        banner: /señal crítica abierta[\s\S]{0,100}\*\*Agente en\s+riesgo\*\*/i,
        snooze: /Posponer[\s\S]{0,140}no la corrige/i,
        privacy: /No incluye transcripciones,[\s\S]{0,180}IDs de conversación/i,
        noExternal: /no envían correo ni notificación push/i,
        noAutoEdit: /Assist no aplica cambios ni inicia comunicaciones/i,
        setupRetired: /no se convierte en una\s+pastilla flotante `8\/9`/i,
      },
      en: {
        badge: /open\s+\*\*Critical and High\*\*\s+signals/i,
        banner: /open Critical signal[\s\S]{0,100}\*\*Agent at risk\*\*/i,
        snooze: /Snoozing[\s\S]{0,140}does not fix it/i,
        privacy: /excludes transcripts,[\s\S]{0,180}conversation IDs/i,
        noExternal: /do not send email or push notifications/i,
        noAutoEdit: /Assist does not apply changes or start external communications/i,
        setupRetired: /does not turn into a\s+floating `8\/9` pill/i,
      },
      pt: {
        badge: /sinais\s+\*\*Críticos e Altos\s+abertos\*\*/i,
        banner: /sinal Crítico aberto[\s\S]{0,100}\*\*Agente em\s+risco\*\*/i,
        snooze: /Adiar[\s\S]{0,140}não o corrige/i,
        privacy: /Exclui transcrições,[\s\S]{0,180}IDs de conversa/i,
        noExternal: /não enviam e-mail nem notificação push/i,
        noAutoEdit: /Assist não aplica mudanças nem inicia comunicações externas/i,
        setupRetired: /não vira uma pílula\s+flutuante `8\/9`/i,
      },
      fr: {
        badge: /signaux\s+\*\*Critiques\s+et Élevés ouverts\*\*/i,
        banner: /signal Critique ouvert[\s\S]{0,100}\*\*Agent à risque\*\*/i,
        snooze: /Reporter[\s\S]{0,140}sans le corriger/i,
        privacy: /exclut transcriptions,[\s\S]{0,180}IDs de conversation/i,
        noExternal: /n'envoient ni e-mail ni notification push/i,
        noAutoEdit: /Assist n'applique pas\s+de changement et ne lance aucune communication externe/i,
        setupRetired: /ne devient pas une pastille\s+flottante `8\/9`/i,
      },
    };

    const expected = markers[locale];
    expect(quality!.body).toMatch(expected.badge);
    expect(quality!.body).toMatch(expected.banner);
    expect(quality!.body).toMatch(expected.snooze);
    expect(quality!.body).toMatch(expected.privacy);
    expect(quality!.body).toMatch(expected.noExternal);
    expect(quality!.body).toMatch(expected.noAutoEdit);
    expect(quality!.body).toContain('Parallly Assist');
    expect(setup!.body).toMatch(expected.setupRetired);
  });

  /**
   * Markers for the consequential-alert release (Sep 2026). Each locale must document,
   * in `centro-calidad-agente`:
   *  - `channelCoverage`: the new non-critical "assigned channel coverage" action. A
   *    ticked-but-unconnected channel no longer blocks the agent when another one works,
   *    so the article must name that action instead of describing a blanket failure.
   *  - `contextBar`: the context bar the destination screen shows after **Review**. It is
   *    part of the screen, never a notification (see the KB README rules).
   *  - `guidedTourReadOnly`: the "Show me where" tour paired, within a short distance,
   *    with the promise that it changes nothing by itself.
   *  - `assistChannels`: the connected-channel list Assist now receives, which is what
   *    stops it from claiming the tenant has no channels.
   */
  const QUALITY_RELEASE_MARKERS: Record<(typeof LOCALES)[number], {
    channelCoverage: RegExp;
    contextBar: RegExp;
    guidedTourReadOnly: RegExp;
    assistChannels: RegExp;
  }> = {
    es: {
      channelCoverage: /Cobertura de los canales asignados/,
      contextBar: /barra\s+de contexto/i,
      guidedTourReadOnly: /\*\*Mostrarme dónde\*\*[\s\S]{0,240}no modifica/i,
      assistChannels: /lista de canales conectados del\s+negocio/i,
    },
    en: {
      channelCoverage: /Assigned channel coverage/,
      contextBar: /context\s+bar/i,
      guidedTourReadOnly: /\*\*Show me where\*\*[\s\S]{0,240}does not change/i,
      assistChannels: /list of the business's connected\s+channels/i,
    },
    pt: {
      channelCoverage: /Cobertura dos canais atribuídos/,
      contextBar: /barra\s+de contexto/i,
      guidedTourReadOnly: /\*\*Mostrar onde\*\*[\s\S]{0,240}não modifica/i,
      assistChannels: /lista de canais conectados do\s+negócio/i,
    },
    fr: {
      channelCoverage: /Couverture des canaux assignés/,
      contextBar: /barre\s+de contexte/i,
      guidedTourReadOnly: /\*\*Montrez-moi où\*\*[\s\S]{0,240}ne modifie/i,
      assistChannels: /liste des canaux connectés de\s+l'entreprise/i,
    },
  };

  /**
   * The onboarding wizard is the three-step "Meet your agent" assistant whose first step
   * confirms the agent already derived from the industry; it is no longer a 5-step flow
   * that opens on a template grid.
   */
  const MEET_YOUR_AGENT_MARKERS: Record<(typeof LOCALES)[number], RegExp> = {
    es: /\*\*Conoce a tu agente\*\*[\s\S]{0,120}\*\*tres pasos\*\*/i,
    en: /\*\*Meet your agent\*\*[\s\S]{0,120}\*\*three-step\*\*/i,
    pt: /\*\*Conheça o seu agente\*\*[\s\S]{0,120}\*\*três etapas\*\*/i,
    fr: /\*\*Faites connaissance avec votre agent\*\*[\s\S]{0,120}\*\*trois étapes\*\*/i,
  };

  /** The WhatsApp test/sandbox number is not a certified connection route. */
  const SANDBOX_ROUTE =
    /sandbox|n[uú]mero de prueba|n[uú]mero de teste|num[eé]ro de test|num[eé]ro d'essai|test number|trial number/i;

  it.each(LOCALES)('%s explains the channel check, the context bar, and the read-only guided tour', (locale) => {
    const quality = byLocale[locale].find(
      (article) => article.id === 'centro-calidad-agente',
    );
    expect(quality).toBeDefined();
    const expected = QUALITY_RELEASE_MARKERS[locale];
    expect(quality!.body).toMatch(expected.channelCoverage);
    expect(quality!.body).toMatch(expected.contextBar);
    expect(quality!.body).toMatch(expected.guidedTourReadOnly);
    expect(quality!.body).toMatch(expected.assistChannels);
  });

  it.each(LOCALES)('%s documents the real onboarding order without a sandbox number', (locale) => {
    const setup = byLocale[locale].find((article) => article.id === 'primeros-pasos');
    const whatsapp = byLocale[locale].find(
      (article) => article.id === 'canales-whatsapp',
    );
    expect(setup).toBeDefined();
    expect(whatsapp).toBeDefined();
    expect(setup!.body).toMatch(MEET_YOUR_AGENT_MARKERS[locale]);
    expect(setup!.raw).not.toMatch(SANDBOX_ROUTE);
    expect(whatsapp!.raw).not.toMatch(SANDBOX_ROUTE);
  });

  it.each(LOCALES)('%s keeps SMS out of the Inbox description and states the real unattended timeout', (locale) => {
    const inbox = byLocale[locale].find((article) => article.id === 'inbox');
    expect(inbox).toBeDefined();
    // The description is everything before the first "## " section heading.
    const description = inbox!.body.split(/^##\s/m)[0];
    expect(description).not.toMatch(/\bSMS\b/i);
    // Nobody answering returns the conversation to the AI after 180 minutes; it is not
    // a five-minute supervisor escalation that parks the conversation forever.
    expect(inbox!.body).toContain('180');
    expect(inbox!.body).not.toMatch(/\b5 (?:min|minut)/i);
  });

  it.each(LOCALES)('%s keeps Inbox and mobile references on canonical web routes', (locale) => {
    const articles = new Map(byLocale[locale].map((article) => [article.id, article]));
    expect(articles.get('inbox')?.routes).toContain('/admin/inbox');
    expect(articles.get('app-movil')?.routes).toEqual([
      '/admin/inbox',
      '/admin/contacts',
      '/admin/pipeline',
      '/admin/appointments',
    ]);
  });

  it('keeps the documented WhatsApp seed-template count aligned with runtime', () => {
    const namesBlock = whatsappSeedTemplatesSource.match(
      /SEED_TEMPLATE_NAMES[^=]*=\s*\[([\s\S]*?)\]/,
    )?.[1] ?? '';
    const runtimeCount = [...namesBlock.matchAll(/'[^']+'/g)].length;
    expect(runtimeCount).toBeGreaterThan(0);

    for (const locale of LOCALES) {
      for (const articleId of ['canales-whatsapp', 'broadcast']) {
        const article = byLocale[locale].find(
          (candidate) => candidate.id === articleId,
        );
        expect(article).toBeDefined();
        expect(article!.body).toContain(`**${runtimeCount}`);
      }
    }
  });

  it('keeps Email fail-closed until its tenant self-service API is exposed', () => {
    const failClosedMarker: Record<(typeof LOCALES)[number], string> = {
      es: 'no es un canal conversacional certificado ni configurable en autoservicio',
      en: 'not yet a certified conversational channel or available for self-service configuration',
      pt: 'ainda não é um canal conversacional certificado nem configurável por autosserviço',
      fr: "ce n'est pas encore un canal conversationnel certifié ni configurable en libre-service",
    };
    const unsupportedSetup = /(?:SMTP|SendGrid|app password|contrase(?:ña|nha) de aplicaci[oó]n|mot de passe d'application|test email|correo de prueba|e-mail de teste)/i;

    for (const locale of LOCALES) {
      const article = byLocale[locale].find(
        (candidate) => candidate.id === 'canales-email-widget',
      );
      expect(article).toBeDefined();
      expect(article!.body).toContain(failClosedMarker[locale]);
      expect(article!.raw).not.toMatch(unsupportedSetup);
    }
  });

  it('does not reintroduce retired menu labels or the non-canonical conversations alias', () => {
    const retiredByLocale: Record<(typeof LOCALES)[number], RegExp[]> = {
      es: [/\*\*(?:GESTIÓN|Gestión|Crecimiento)(?:\s*→[^*\n]*\*\*|\*\*\s*→)/, /\*\*Análisis\*\*\s*→/, /sección \*\*Gestión\*\*/, /Operación\s*→\s*Inbox/, /Integraciones (?:y|&) alertas/],
      en: [/\*\*(?:Management|Growth)(?:\s*→[^*\n]*\*\*|\*\*\s*→)/, /\*\*Analytics\*\*\s*→/, /\*\*Management\*\* section/, /Operation\s*→\s*Inbox/, /Integrations (?:and|&) alerts/],
      pt: [/\*\*(?:Gestão|Crescimento)(?:\s*→[^*\n]*\*\*|\*\*\s*→)/, /\*\*(?:Analytics|Análises)\*\*\s*→/, /seção \*\*Gestão\*\*/, /Operação\s*→\s*Caixa de entrada/, /Integrações (?:e|&) alertas/],
      fr: [/\*\*(?:Gestion|Croissance)(?:\s*→[^*\n]*\*\*|\*\*\s*→)/, /\*\*Analyses\*\*\s*→/, /section \*\*Gestion\*\*/, /Opération\s*→\s*Inbox/, /Intégrations (?:et|&) alertes/],
    };

    for (const locale of LOCALES) {
      for (const article of byLocale[locale]) {
        expect(article.routes).not.toContain('/admin/conversations');
        for (const retired of retiredByLocale[locale]) {
          expect(article.body).not.toMatch(retired);
        }
      }
    }
  });

  it('does not advertise pipeline controls that have no public controller contract', () => {
    const unavailableControls = /\b(?:New|Nuevo|Novo|Nouveau) pipeline\b|\b(?:multiple pipelines|varios pipelines|vários pipelines|plusieurs pipelines)\b/i;
    for (const locale of LOCALES) {
      const article = byLocale[locale].find((candidate) => candidate.id === 'pipeline');
      expect(article).toBeDefined();
      expect(article!.raw).not.toMatch(unavailableControls);
    }
  });

  it('keeps pipeline approval explicitly non-certified instead of promising an enforced blocker', () => {
    const statusMarkers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /no está certificado de (?:punta|extremo) a extremo/i,
      en: /flow is not certified end to end/i,
      pt: /não está certificado de ponta a ponta/i,
      fr: /n'est pas certifié de bout en bout/i,
    };
    const unsupportedPromise = /(?:stays in \*\*Pending approval|fica em \*\*Aprovação pendente|queda en \*\*Pendiente de aprobación|reste en \*\*Approbation en attente)[^\n]+(?:supervisor|administrador|admin|superviseur)/i;

    for (const locale of LOCALES) {
      const article = byLocale[locale].find((candidate) => candidate.id === 'pipeline');
      expect(article).toBeDefined();
      expect(article!.body).toMatch(statusMarkers[locale]);
      expect(article!.body).not.toMatch(unsupportedPromise);
    }
  });

  it('documents the safe calendar-disconnect boundary in every locale', () => {
    const markers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /desconexión[^\n]+no está certificada de punta a punta/i,
      en: /disconnect[^\n]+not certified end to end/i,
      pt: /desconexão[^\n]+não está certificado de ponta a ponta/i,
      fr: /déconnexion[^\n]+n'est pas certifiée de bout en bout/i,
    };

    for (const locale of LOCALES) {
      const article = byLocale[locale].find(
        (candidate) => candidate.id === 'citas-calendarios',
      );
      expect(article).toBeDefined();
      expect(article!.body).toMatch(markers[locale]);
    }
  });

  it('keeps campaign launch and proactive widget triggers fail-closed', () => {
    const campaignMarkers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /lanzamiento[^\n]+no está certificado de punta a punta para producción/i,
      en: /launch flow[^\n]+not certified end to end for production/i,
      pt: /lançamento[^\n]+não está certificado de ponta a ponta para produção/i,
      fr: /lancement[^\n]+n'est pas certifié de bout en bout pour la production/i,
    };
    const triggerMarkers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /script público[^\n]+todavía no evalúa ni ejecuta/i,
      en: /public widget script[^\n]+does not yet evaluate or execute/i,
      pt: /script público[^\n]+ainda não avalia nem executa/i,
      fr: /script public[^\n]+n'évalue ni n'exécute encore/i,
    };

    for (const locale of LOCALES) {
      const campaigns = byLocale[locale].find((article) => article.id === 'broadcast');
      const widget = byLocale[locale].find(
        (article) => article.id === 'canales-email-widget',
      );
      expect(campaigns).toBeDefined();
      expect(widget).toBeDefined();
      expect(campaigns!.body).toMatch(campaignMarkers[locale]);
      expect(widget!.body).toMatch(triggerMarkers[locale]);
    }
  });

  it('keeps WhatsApp and troubleshooting guidance behind the campaign release boundary', () => {
    const whatsappMarkers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /no lances campañas reales[^\n]+no están certificadas de punta a punta/i,
      en: /do not launch real campaigns[^\n]+not yet certified end to end/i,
      pt: /não lance campanhas reais[^\n]+ainda não estão certificados de ponta a ponta/i,
      fr: /ne lancez pas de campagne réelle[^\n]+ne sont pas encore certifiées de bout en bout/i,
    };
    const troubleshootingMarkers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /lanzamiento[^\n]+no está certificado para producción/i,
      en: /launching[^\n]+not certified for production/i,
      pt: /lançamento[^\n]+não está certificado para produção/i,
      fr: /lancement[^\n]+n'est pas certifié pour la production/i,
    };

    for (const locale of LOCALES) {
      const whatsapp = byLocale[locale].find(
        (candidate) => candidate.id === 'canales-whatsapp',
      );
      const troubleshooting = byLocale[locale].find(
        (candidate) => candidate.id === 'solucion-problemas',
      );
      expect(whatsapp).toBeDefined();
      expect(troubleshooting).toBeDefined();
      expect(whatsapp!.body).toMatch(whatsappMarkers[locale]);
      expect(troubleshooting!.body).toMatch(troubleshootingMarkers[locale]);
    }
  });

  it('keeps Inbox self-assignment limited to unassigned conversations', () => {
    const markers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /tomar[^\n]+conversación \*\*sin asignar\*\*/i,
      en: /take an \*\*unassigned\*\* conversation/i,
      pt: /assumir uma conversa \*\*sem atribuição\*\*/i,
      fr: /prendre une conversation \*\*non assignée\*\*/i,
    };

    for (const locale of LOCALES) {
      const inbox = byLocale[locale].find((candidate) => candidate.id === 'inbox');
      expect(inbox).toBeDefined();
      expect(inbox!.body).toMatch(markers[locale]);
    }
  });

  it('does not let multi-account guidance bypass the campaign release boundary', () => {
    const markers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /borrador[^\n]+sin programarlo ni lanzarlo/i,
      en: /draft[^\n]+without scheduling or launching/i,
      pt: /rascunho[^\n]+sem agendar nem lançar/i,
      fr: /brouillon[^\n]+sans le programmer ni le lancer/i,
    };

    for (const locale of LOCALES) {
      const article = byLocale[locale].find((candidate) => candidate.id === 'multi-cuenta');
      expect(article).toBeDefined();
      expect(article!.body).toMatch(markers[locale]);
    }
  });

  it('does not let SMS guidance bypass the campaign release boundary', () => {
    const markers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /guarda el borrador[^\n]+no lo envíes ni lo programes para producción/i,
      en: /save the draft[^\n]+do not send or schedule it for production/i,
      pt: /salve o rascunho[^\n]+não envie nem agende para produção/i,
      fr: /enregistrez le brouillon[^\n]+ne l'envoyez pas et ne le programmez pas en production/i,
    };

    for (const locale of LOCALES) {
      const article = byLocale[locale].find((candidate) => candidate.id === 'sms-creditos');
      expect(article).toBeDefined();
      expect(article!.body).toMatch(markers[locale]);
    }
  });

  it('does not promise infallible generative answers or guaranteed WhatsApp delivery', () => {
    const absoluteKnowledge = /(?:no inventa datos|doesn['’]t make up data|não inventa dados|n['’]invente pas de données)/i;
    const guaranteedDelivery = /(?:llegan siempre|always arrive|sempre chegam|arrivent donc toujours)/i;

    for (const locale of LOCALES) {
      const knowledge = byLocale[locale].find((article) => article.id === 'base-conocimiento');
      const appointments = byLocale[locale].find((article) => article.id === 'citas-calendarios');
      expect(knowledge).toBeDefined();
      expect(appointments).toBeDefined();
      expect(knowledge!.body).not.toMatch(absoluteKnowledge);
      expect(appointments!.body).not.toMatch(guaranteedDelivery);
    }
  });

  it('documents the current drip and CSAT boundaries instead of promising inactive handlers', () => {
    const dripMarkers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /contacto convierte[^\n]+aún no se ejecuta automáticamente/i,
      en: /contact converts[^\n]+not yet enforced automatically/i,
      pt: /contato converte[^\n]+ainda não é aplicada automaticamente/i,
      fr: /contact convertit[^\n]+n'est pas encore appliquée automatiquement/i,
    };
    const pauseMarkers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /impide nuevas inscripciones[^\n]+pasos ya programados[^\n]+pueden continuar/i,
      en: /prevents new enrollments[^\n]+already scheduled steps may continue/i,
      pt: /impede novas inscrições[^\n]+passos já programados podem continuar/i,
      fr: /empêche les nouvelles inscriptions[^\n]+étapes déjà planifiées peuvent continuer/i,
    };
    const csatMarkers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /cerrar una conversación no envía ni captura automáticamente una encuesta/i,
      en: /closing a conversation does not automatically send or capture a survey/i,
      pt: /encerrar uma conversa não envia nem captura automaticamente uma pesquisa/i,
      fr: /fermeture d'une conversation n'envoie ni ne recueille automatiquement une enquête/i,
    };

    for (const locale of LOCALES) {
      const automation = byLocale[locale].find((article) => article.id === 'automatizacion');
      const analytics = byLocale[locale].find((article) => article.id === 'analytics-reportes');
      expect(automation).toBeDefined();
      expect(analytics).toBeDefined();
      expect(automation!.body).toMatch(dripMarkers[locale]);
      expect(automation!.body).toMatch(pauseMarkers[locale]);
      expect(analytics!.body).toMatch(csatMarkers[locale]);
    }
  });

  it('describes the agent editor and Assist from the settings they can actually change', () => {
    const assistMarkers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /Assist muestra una propuesta.{0,160}guarda un \*\*borrador\*\*.{0,80}no publica ni activa/i,
      en: /Assist presents a proposal.{0,160}saves a \*\*draft\*\*.{0,80}does not publish or activate/i,
      pt: /Assist mostra uma proposta.{0,160}salva um \*\*rascunho\*\*.{0,80}sem publicar nem ativar/i,
      fr: /Assist présente une proposition.{0,160}enregistre un \*\*brouillon\*\*.{0,80}sans publier ni activer/i,
    };
    const accountHours: Record<(typeof LOCALES)[number], RegExp> = {
      es: /horario comercial pertenece al negocio y se comparte entre sus agentes/i,
      en: /Business hours belong to the tenant and are shared by its agents/i,
      pt: /horário comercial pertence ao tenant e é compartilhado entre seus agentes/i,
      fr: /horaires d'ouverture appartiennent au tenant et sont partagés par ses agents/i,
    };
    const reviewedActivation: Record<(typeof LOCALES)[number], RegExp> = {
      es: /Reactivarlo requiere revisar y publicar una versión/i,
      en: /Reactivation requires reviewing and publishing a version/i,
      pt: /Reativar exige revisar e publicar uma versão/i,
      fr: /réactiver exige d'examiner et de publier une version/i,
    };
    const publicationWorkflow: Record<(typeof LOCALES)[number], RegExp> = {
      es: /Guardar borrador.{0,500}Probar agente.{0,500}Publicar y ver historial/is,
      en: /Save draft.{0,500}Test agent.{0,500}Publish and view history/is,
      pt: /Salvar rascunho.{0,500}Testar agente.{0,500}Publicar e ver histórico/is,
      fr: /Enregistrer le brouillon.{0,500}Tester l'agent.{0,500}Publier et voir l'historique/is,
    };
    const retainedRemoval: Record<(typeof LOCALES)[number], RegExp> = {
      es: /Eliminar.{0,180}desactiva.{0,100}libera sus conexiones.{0,100}conserva su registro/is,
      en: /Delete.{0,180}deactivating.{0,100}releasing its connections.{0,100}retaining its record/is,
      pt: /Excluir.{0,180}desativando.{0,100}liberando suas conexões.{0,100}preserva o registro/is,
      fr: /Supprimer.{0,180}désactivant.{0,100}libérant ses connexions.{0,120}conservant son enregistrement/is,
    };
    const inventedControls = /\*\*(?:Modelo IA|AI Model|Modèle IA)\*\*|(?:siempre IA, siempre humano o híbrido|always AI, always human or hybrid|sempre IA, sempre humano ou híbrido|toujours IA, toujours humain ou hybride)/i;

    for (const locale of LOCALES) {
      const article = byLocale[locale].find((candidate) => candidate.id === 'agentes-ia');
      expect(article).toBeDefined();
      expect(article!.body).toMatch(assistMarkers[locale]);
      expect(article!.body).toMatch(accountHours[locale]);
      expect(article!.body).toMatch(reviewedActivation[locale]);
      expect(article!.body).toMatch(publicationWorkflow[locale]);
      expect(article!.body).toMatch(retainedRemoval[locale]);
      expect(article!.body).not.toMatch(inventedControls);
    }
  });

  it('keeps channel connection separate from reviewed agent publication', () => {
    const connectionMarkers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /Conectar el canal no publica el borrador del agente/i,
      en: /Connecting it does not publish the agent draft/i,
      pt: /Conectar o canal não publica o rascunho do agente/i,
      fr: /La connexion ne publie pas le brouillon de l'agent/i,
    };
    const publicationMarkers: Record<(typeof LOCALES)[number], RegExp> = {
      es: /Prepara, revisa y publica.{0,220}La publicación es la que vuelve operativos/is,
      en: /Prepare, review, and publish.{0,220}Publication makes/is,
      pt: /Prepare, revise e publique.{0,220}A publicação torna operacionais/is,
      fr: /Préparez, révisez et publiez.{0,220}La publication rend opérationnels/is,
    };

    for (const locale of LOCALES) {
      const article = byLocale[locale].find((candidate) => candidate.id === 'primeros-pasos');
      expect(article).toBeDefined();
      expect(article!.body).toMatch(connectionMarkers[locale]);
      expect(article!.body).toMatch(publicationMarkers[locale]);
    }
  });

  it('keeps volatile prices, trial durations, and plan matrices out of runtime help', () => {
    for (const locale of LOCALES) {
      for (const article of byLocale[locale]) {
        expect(article.body).not.toMatch(/^\|\s*\*{0,2}(?:Emprendedor|Starter|Pro|Enterprise|Custom)\*{0,2}(?:\s*\([^)]*\))?\s*\|/m);
        expect(article.body).not.toMatch(/\b(?:Starter|Pro|Enterprise|Custom|Emprendedor)\b[^\n]{0,80}\b\d+\s+(?:agents?|agentes?|accounts?|cuentas?|contas?|comptes?|users?|usuarios?|utilisateurs?|contacts?|contactos?|contatos?|calendars?|calendarios?|channels?|canales?|canais|numbers?|números?|numeros?|rules?|reglas?|regras?|campaigns?|campañas?|campanhas?|messages?|mensajes?|mensagens?|services?|servicios?|serviços?)\b/i);
        expect(article.raw).not.toMatch(/\b(?:Mercado\s*Pago|MercadoPago|DIAN)\b/i);

        if (article.id === 'facturacion-planes') {
          expect(article.body).not.toMatch(/(?:(?:USD|COP|EUR)\s*(?:\$|€)?|US\$|\$|€)\s*\d[\d.,]*|\b\d[\d.,]*\s*(?:USD|COP|EUR)\b/i);
          expect(article.body).not.toMatch(/\b(?:trial|prueba|teste|essai)\b[^\n]{0,80}\b\d+\s*(?:days?|días?|dias?|jours?|months?|meses?|mois)\b/i);
          expect(article.body).not.toMatch(/\b\d+\s*(?:days?|días?|dias?|jours?|months?|meses?|mois)\b[^\n]{0,80}\b(?:trial|prueba|teste|essai)\b/i);
        }
      }
    }
  });
});
