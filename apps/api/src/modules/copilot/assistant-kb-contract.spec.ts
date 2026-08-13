import * as fs from 'fs';
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
].sort();
const VERTICAL_LABELS: Record<(typeof LOCALES)[number], Record<string, string>> = {
  es: {
    salud: 'salud', moda_belleza: 'moda y belleza', inmobiliaria: 'inmobiliaria', restaurantes: 'restaurantes', automotriz: 'automotriz', turismo: 'turismo', education: 'educación', finanzas: 'finanzas', servicios_profesionales: 'servicios profesionales', retail: 'retail', technology: 'tecnología', veterinaria: 'veterinaria', gimnasios: 'gimnasios', seguros: 'seguros', servicios_hogar: 'servicios del hogar', pet_services: 'servicios para mascotas', fotografia: 'fotografía', otro: 'otros',
  },
  en: {
    salud: 'healthcare', moda_belleza: 'fashion and beauty', inmobiliaria: 'real estate', restaurantes: 'restaurants', automotriz: 'automotive', turismo: 'tourism', education: 'education', finanzas: 'finance', servicios_profesionales: 'professional services', retail: 'retail', technology: 'technology', veterinaria: 'veterinary', gimnasios: 'fitness', seguros: 'insurance', servicios_hogar: 'home services', pet_services: 'pet services', fotografia: 'photography', otro: 'other',
  },
  pt: {
    salud: 'saúde', moda_belleza: 'moda e beleza', inmobiliaria: 'imobiliário', restaurantes: 'restaurantes', automotriz: 'automotivo', turismo: 'turismo', education: 'educação', finanzas: 'finanças', servicios_profesionales: 'serviços profissionais', retail: 'varejo', technology: 'tecnologia', veterinaria: 'veterinária', gimnasios: 'academias', seguros: 'seguros', servicios_hogar: 'serviços domésticos', pet_services: 'serviços para pets', fotografia: 'fotografia', otro: 'outros',
  },
  fr: {
    salud: 'santé', moda_belleza: 'mode et beauté', inmobiliaria: 'immobilier', restaurantes: 'restaurants', automotriz: 'automobile', turismo: 'tourisme', education: 'éducation', finanzas: 'finance', servicios_profesionales: 'services professionnels', retail: 'commerce de détail', technology: 'technologie', veterinaria: 'vétérinaire', gimnasios: 'fitness', seguros: 'assurances', servicios_hogar: 'services à domicile', pet_services: 'services animaliers', fotografia: 'photographie', otro: 'autre',
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
const verticalManifestPath = path.resolve(
  __dirname,
  '../../../../../packages/shared/src/vertical-capability-manifest.ts',
);
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

describe('Parallly Assist knowledge-base contract', () => {
  const byLocale = Object.fromEntries(
    LOCALES.map((locale) => [locale, loadLocale(locale)]),
  ) as Record<(typeof LOCALES)[number], Article[]>;
  const navigationSource = fs.readFileSync(navigationContractPath, 'utf8');
  const verticalManifestSource = fs.readFileSync(verticalManifestPath, 'utf8');
  const whatsappSeedTemplatesSource = fs.readFileSync(whatsappSeedTemplatesPath, 'utf8');
  const canonicalRoutes = new Set(
    [...navigationSource.matchAll(/pattern:\s*"([^"]+)"/g)].map((match) => match[1]),
  );
  const canonicalVerticalBlock = verticalManifestSource.match(
    /VERTICAL_MANIFEST_INDUSTRIES\s*=\s*\[([\s\S]*?)\]\s*as const/,
  )?.[1] ?? '';
  const canonicalVerticalIds = [
    ...canonicalVerticalBlock.matchAll(/'([^']+)'/g),
  ].map((match) => match[1]);

  it.each(LOCALES)('%s has the complete, unique 26-article set', (locale) => {
    const articles = byLocale[locale];
    const ids = articles.map((article) => article.id);
    expect(articles).toHaveLength(26);
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

  it.each(LOCALES)('%s documents every canonical vertical profile', (locale) => {
    const labels = VERTICAL_LABELS[locale];
    expect(canonicalVerticalIds).toHaveLength(18);
    expect(new Set(Object.keys(labels))).toEqual(new Set(canonicalVerticalIds));

    const article = byLocale[locale].find(
      (candidate) => candidate.id === 'modulos-industria',
    );
    expect(article).toBeDefined();
    const normalizedBody = article!.body.toLocaleLowerCase(locale);
    for (const label of Object.values(labels)) {
      expect(normalizedBody).toContain(label.toLocaleLowerCase(locale));
    }
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
