const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { metaChargeDisclosureFailures } = require("./meta-charge-disclosure.cjs");

const landingRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(landingRoot, "..", "..");
const locales = ["es", "en", "pt", "fr"];
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function loadJson(locale) {
  const file = path.join(landingRoot, "messages", `${locale}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    failures.push(`${locale}.json is not valid JSON: ${error.message}`);
    return {};
  }
}

function getPath(object, dottedPath) {
  return String(dottedPath || '').split('.').reduce((value, key) => value?.[key], object);
}

const tsModuleCache = new Map();

function loadTsFile(file) {
  const absoluteFile = path.resolve(file);
  if (tsModuleCache.has(absoluteFile)) return tsModuleCache.get(absoluteFile).exports;
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
    },
    fileName: file,
  }).outputText;
  const loaded = { exports: {} };
  tsModuleCache.set(absoluteFile, loaded);
  const localRequire = (request) => {
    if (!request.startsWith('.')) return require(request);
    const base = path.resolve(path.dirname(absoluteFile), request);
    const candidates = [base, `${base}.ts`, `${base}.js`, `${base}.json`, path.join(base, 'index.ts')];
    const target = candidates.find(candidate => fs.existsSync(candidate));
    if (!target) throw new Error(`Cannot resolve ${request} from ${absoluteFile}`);
    if (target.endsWith('.ts')) return loadTsFile(target);
    if (target.endsWith('.json')) return JSON.parse(fs.readFileSync(target, 'utf8'));
    return require(target);
  };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, localRequire);
  return loaded.exports;
}

function loadTsModule(relativeFile) {
  return loadTsFile(path.join(landingRoot, relativeFile));
}

function loadVerticalData() {
  return loadTsModule(path.join("src", "data", "verticals.ts")).VERTICALS;
}

function deepMerge(base, overlay) {
  if (!base || typeof base !== "object" || Array.isArray(base)) return overlay;
  const result = { ...base };
  for (const [key, value] of Object.entries(overlay || {})) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge(base[key] || {}, value)
      : value;
  }
  return result;
}

function readMarketingSourceTree(directory) {
  const chunks = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const normalized = fullPath.replaceAll("\\", "/");
    if (/\/app\/(?:privacy|terms|data-policy|data-deletion)\//.test(normalized)) continue;
    if (entry.isDirectory()) chunks.push(readMarketingSourceTree(fullPath));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) chunks.push(fs.readFileSync(fullPath, "utf8"));
  }
  return chunks.join("\n");
}

function translatedDemoText(messages, slug) {
  const vertical = messages?.verticals?.[slug] || {};
  return Object.entries(vertical)
    .filter(([key, value]) => /^demo\d+$/.test(key) && typeof value === "string")
    .map(([, value]) => value)
    .join(" ");
}

const verticals = loadVerticalData();
assert(Array.isArray(verticals) && verticals.length === 18, "Vertical catalog must contain exactly 18 entries");
const canonicalProductPolicy = loadTsModule(path.join(
  "..", "..", "packages", "shared", "src", "vertical-product-policy.ts",
));
for (const vertical of verticals || []) {
  const expectedPolicy = canonicalProductPolicy.resolvePublicVerticalProductPolicy(vertical.slug);
  assert(
    vertical.demoMode === "illustrative",
    `${vertical.slug}: every demo must be explicitly marked illustrative`,
  );
  assert(
    vertical.productMode === expectedPolicy.mode,
    `${vertical.slug}: product mode must follow the adopted certification policy`,
  );
  assert(
    vertical.deepMarketingAllowed === expectedPolicy.deepMarketingAllowed,
    `${vertical.slug}: deep marketing state must come from the canonical product policy`,
  );
  assert(
    vertical.certificationState === expectedPolicy.certificationState,
    `${vertical.slug}: certification state must come from the canonical product policy`,
  );
  assert(
    JSON.stringify(vertical.certificationReasons) === JSON.stringify(expectedPolicy.certificationReasons),
    `${vertical.slug}: certification reasons must come from the canonical product policy`,
  );
}

const chatDemoSource = fs.readFileSync(
  path.join(landingRoot, "src", "components", "demos", "VerticalChatDemo.tsx"),
  "utf8",
);
const verticalsShowcaseSource = fs.readFileSync(
  path.join(landingRoot, "src", "components", "sections", "VerticalsShowcase.tsx"),
  "utf8",
);
const solutionsPageSource = fs.readFileSync(
  path.join(landingRoot, "src", "app", "(marketing)", "soluciones", "page.tsx"),
  "utf8",
);
const industryPageSource = fs.readFileSync(
  path.join(landingRoot, "src", "app", "(marketing)", "soluciones", "[slug]", "IndustryPageClient.tsx"),
  "utf8",
);
assert(
  solutionsPageSource.includes("data-product-mode={v.productMode}")
    && solutionsPageSource.includes("data-certification-state={v.certificationState}")
    && solutionsPageSource.includes("data-certification-reasons={v.certificationReasons.join")
    && solutionsPageSource.includes("solutions.productMode.${v.productMode}")
    && industryPageSource.includes("data-product-mode={vertical.productMode}")
    && industryPageSource.includes("data-certification-state={vertical.certificationState}")
    && industryPageSource.includes("data-certification-reasons={vertical.certificationReasons.join")
    && industryPageSource.includes("solutions.productMode.${vertical.productMode}"),
  "Solution list and detail pages must disclose the adopted product/certification mode",
);
assert(
  solutionsPageSource.includes("v.deepMarketingAllowed")
    && solutionsPageSource.includes("solutions.productModeDescription.${v.productMode}")
    && industryPageSource.includes("vertical.deepMarketingAllowed")
    && industryPageSource.includes("description: publicDescription")
    && industryPageSource.includes('data-deep-marketing="withheld"')
    && industryPageSource.includes("solutions.productModeDescription.${vertical.productMode}"),
  "Uncertified verticals must hide deep taglines, tier badges and specialized feature lists",
);
assert(
  chatDemoSource.includes('vertical.demoMode === "illustrative"')
    && chatDemoSource.includes('t("demoDisclaimer")'),
  "VerticalChatDemo must render the illustrative-data disclaimer",
);
assert(
  verticalsShowcaseSource.includes("current.deepMarketingAllowed")
    && verticalsShowcaseSource.includes('t("genericTagline")')
    && verticalsShowcaseSource.includes("genericFeature")
    && chatDemoSource.includes("vertical.deepMarketingAllowed")
    && chatDemoSource.includes("genericDemo"),
  "Home vertical showcase must fail closed to horizontal copy and demos until deep marketing is certified",
);

const markerPatterns = {
  es: /\b(?:ejemplo|ilustrativ[oa])\b/i,
  en: /\b(?:example|illustrative)\b/i,
  pt: /\b(?:exemplo|ilustrativ[oa])\b/i,
  fr: /\b(?:exemple|illustratif|illustrative)\b/i,
};

// Wave 0 claim freeze. These are either unsupported absolutes, invented
// performance metrics, unpublished commercial policies, or certifications not
// backed by evidence. Legal/privacy pages are intentionally outside this
// marketing-copy scan.
const frozenClaimPatterns = [
  { label: "invented +45%/-60% outcome", pattern: /(?:\+\s*45|[-−]\s*60)\s*%/i },
  { label: "unverified 3-second response SLA", pattern: /\b3\s*(?:sec(?:onds?)?|seg(?:undos?)?|secondes?)\b/i },
  {
    label: "unverified 5/10-minute setup promise",
    pattern: /(?:(?:setup|configura(?:ci[oó]n|ç[aã]o|tion)|onboarding|connect\w*|conect\w*|operat\w*)\b.{0,70}\b(?:5|10)\s*(?:min(?:ute)?s?|minutos?)\b|\b(?:5|10)\s*(?:min(?:ute)?s?|minutos?)\b.{0,70}\b(?:setup|configura(?:ci[oó]n|ç[aã]o|tion)|onboarding|connect\w*|conect\w*|operat\w*))/i,
  },
  { label: "unverified adoption or satisfaction metric", pattern: /\b(?:2[.,]?000[.,]?000|70\s*%|4[.,]9\s*\/\s*5)\b/i },
  { label: "unverified partner/certification badge", pattern: /\b(?:Meta Tech Provider|Mercado\s*Pago\s*Partner|MercadoPago\s*Partner)\b/i },
  { label: "unverified 24/7 support promise", pattern: /(?:\b(?:support|soporte|suporte)\b.{0,35}\b24\s*\/\s*7\b|\b24\s*\/\s*7\b.{0,35}\b(?:support|soporte|suporte)\b)/i },
  { label: "absolute or military-grade security claim", pattern: /\b(?:100\s*%\s*(?:secure|segur[oa]|s[ûu]r)|military-grade|cifrado militar|criptografia militar|chiffrement militaire)\b/i },
  { label: "unverified daily-backup or compliance claim", pattern: /\b(?:daily backups?|backups? diarios?|backups? diários?|backups? quotidiens?|GDPR-compliant|cumplimos GDPR|conforme RGPD)\b/i },
  { label: "unsupported subscription pause/refund/retention promise", pattern: /(?:\b(?:pause|paus(?:a|ar|e)|mettre en pause)\b.{0,45}\b(?:30|90)\s*(?:days?|días?|dias?|jours?)\b|\b(?:full refund|reembolso completo|remboursement complet)\b|\b(?:data|datos|dados|données)\b.{0,30}\b(?:kept|mantienen|mantidos|conservées)\b.{0,20}\b30\s*(?:days?|días?|dias?|jours?)\b)/i },
  { label: "unsupported direct CRM integration", pattern: /\b(?:HubSpot|Salesforce)\b/i },
  { label: "no-ban guarantee", pattern: /\b(?:no ban risk|sin riesgo de baneo|sem risco de banimento|sans risque de bannissement)\b/i },
  {
    label: "hard-coded 17% annual discount",
    pattern: /(?:17\s*%.{0,55}(?:annual|anual|annuel)|(?:annual|anual|annuel).{0,55}17\s*%)/i,
  },
  {
    label: "unsupported bidirectional calendar sync",
    pattern: /\b(?:syncs? bidirectionally|two-way sync|sincroniza(?:ci[oó]n)? bidireccional(?:mente)?|sincroniza(?:ç[aã]o)? bidirecional(?:mente)?|synchronisation bidirectionnelle)\b/i,
  },
  {
    label: "absolute no-price-hallucination promise",
    pattern: /\b(?:never (?:invents?|makes? up).{0,24}prices?|nunca inventa.{0,24}precios?|nunca inventa.{0,24}preços?|n['’]invente jamais.{0,24}prix)\b/i,
  },
  {
    label: "absolute no-hallucination promise",
    pattern: /\b(?:never makes? it up|never makes? things up|no inventa(?:da)?|n[aã]o inventa(?:da)?|n['’]invente rien|pas invent[eé]e?)\b/i,
  },
  {
    label: "absolute double-booking guarantee",
    pattern: /(?:\batomic slot lock|bloqueo at[oó]mico.{0,80}\bnunca|bloqueio at[oô]mico.{0,80}\bnunca|blocage atomique.{0,80}\bjamais|(?:guarantees?|garantiza|garante|garantit).{0,60}(?:never|nunca|jam[aá]s|jamais).{0,60}(?:book|reserv|agend))/i,
  },
  {
    label: "unsupported AI overage charge",
    pattern: /(?:pay extra.{0,70}(?:exceed|over).{0,40}AI|pagar[ií]as? extra.{0,70}exced.{0,40}(?:IA|AI)|pagaria extra.{0,70}exced.{0,40}(?:IA|AI)|suppl[eé]ment.{0,70}d[eé]pass.{0,40}IA)/i,
  },
  {
    label: "unsupported Instagram public-comment automation",
    pattern: /(?:reply to comments.{0,80}(?:Instagram|DM)|responde comentarios.{0,80}(?:Instagram|DM)|responde coment[aá]rios.{0,80}(?:Instagram|DM)|r[eé]pond aux commentaires.{0,80}(?:Instagram|DM))/i,
  },
  {
    label: "unsupported automated ticket management",
    pattern: /\b(?:automated support tickets?|tickets? de soporte automatizados?|tickets? de suporte automatizados?|tickets? de support automatisés?)\b/i,
  },
  {
    label: "unsupported automotive diagnosis or repair tracking",
    pattern: /\b(?:diagnosis and quotes? by chat|diagnóstico y cotización por chat|diagnóstico e cotação por chat|diagnostic et devis par chat|repair tracking|seguimiento de reparaciones|acompanhamento de reparos|suivi de réparations)\b/i,
  },
  {
    label: "unsupported financial quotes or portfolio tracking",
    pattern: /\b(?:personalized quotes? by chat|cotizaciones personalizadas por chat|cotações personalizadas por chat|devis personnalisés par chat|portfolio tracking|seguimiento de portafolio|acompanhamento de portfólio|suivi de portefeuille|investment profile qualification|calificación de perfil de inversión|qualificação de perfil de investimento|évaluation du profil d'investissement)\b/i,
  },
  {
    label: "services preconfigured across all 18 verticals",
    pattern: /\b18\b.{0,120}\b(?:pre-?configured services?|servicios pre-?configurados?|serviços pré-configurados?|services pré-configurés?)\b/i,
  },
  {
    // The canonical constant is CERTIFIED_SELF_SERVICE_CHANNELS, and the word
    // leaked out of it into eight strings per locale while the audited closure
    // report says 0 of 5 channels have finished certification. "Self-service"
    // is what the policy actually establishes; "certified" is a claim the
    // report refuses. The pairing is frozen so it cannot come back by copy-edit
    // — a real certification would change the report first, and this rule with it.
    label: "channels described as certified",
    pattern: /\b(?:canal(?:es)?|canais?|canaux)\s+certific(?:ad[oa]s?|és?|é)\b|\bcertified\s+channels?\b|\bchannels?\s+certified\b/i,
  },
  {
    // An architectural count of verticals or profiles. It told a buyer nothing,
    // and every version of it was wrong in one direction or the other: the
    // catalogue is larger than 18 and the certified part of it is zero.
    label: "architectural vertical or profile count",
    pattern: /\b\d{1,3}\s+(?:configuraciones?\s+verticales?|configurações?\s+verticais?|configurations?\s+verticales?|vertical\s+configurations?|perfiles?\s+(?:de\s+)?industria|industry\s+profiles?|verticales?\s+disponibles?|industrias?\s+disponibles?)\b/i,
  },
  {
    // Opening Meta's billing page, or coming back from it, proves neither that
    // the account is funded nor that the next message will arrive. Meta's API
    // reports whether a method is ATTACHED; balance, debt and delivery are not
    // in that answer, and a page that says otherwise sells a guarantee made of
    // somebody else's bank.
    label: "verified Meta funding or guaranteed delivery",
    pattern: /\b(?:pago\s+verificado|pagamento\s+verificado|paiement\s+vérifié|payment\s+verified|verified\s+payment)\b|\b(?:entrega\s+garantizada|entrega\s+garantida|livraison\s+garantie|guaranteed\s+delivery)\b/i,
  },
  {
    label: "unsupported autonomous-sales or zero-human promise",
    pattern: /\b(?:sells? on its own|vende solo|vende sozinho|vend toute seule|zero human intervention|cero intervenci[oó]n humana|zero interven[cç][aã]o humana|z[eé]ro intervention humaine|never sleeps|nunca duerme|nunca dorme|ne dort jamais)\b/i,
  },
  {
    label: "unsupported instant production-readiness promise",
    pattern: /(?:\b(?:from (?:the )?first minute|desde (?:el )?primer minuto|desde o primeiro minuto|d[eè]s la premi[eè]re minute)\b|\b(?:ready to operate|listo para operar|pronto para operar|pr[eê]t [aà] op[eé]rer)\b.{0,35}\b(?:day one|primer d[ií]a|primeiro dia|premier jour)\b)/i,
  },
  {
    label: "unsupported universal vertical adaptation promise",
    pattern: /\b(?:adapts? to any business|se adapta a cualquier negocio|se adapta a qualquer neg[oó]cio|s['’]adapte [aà] toute activit[eé])\b/i,
  },
  {
    label: "unsupported configure-once autonomy promise",
    pattern: /(?:\b(?:all|todas?|tout)\b.{0,45}\b(?:run|work|funcionan?|fonctionne)\b.{0,25}\bautomati|\b(?:configure once|configura(?:s|r)? una vez|configure uma vez|configurez une fois)\b.{0,55}\b(?:AI|IA|assistant).{0,25}\b(?:handle the rest|se encargue del resto|cuidar do resto|s['’]occuper du reste)\b)/i,
  },
  {
    label: "unverified customer outcome testimonial",
    pattern: /\b(?:real LatAm businesses that stopped losing sales|negocios reales de LatAm que dejaron de perder ventas|neg[oó]cios reais da LatAm que pararam de perder vendas|vraies entreprises LatAm qui ont arr[eê]t[eé] de perdre des ventes)\b/i,
  },
  {
    label: "absolute error-free booking promise",
    pattern: /\b(?:error-?free booking engine|motor de reservas sin errores|motor de reservas sem erros|moteur de r[eé]servation sans erreurs|offers only open slots|ofrece solo slots libres|oferece apenas slots livres|propose uniquement les cr[eé]neaux libres)\b/i,
  },
  {
    label: "instant human-handoff promise",
    pattern: /(?:\b(?:hands? off|passes? the conversation|pasa la conversaci[oó]n|passa a conversa|transf[eè]re la conversation)\b.{0,70}\b(?:instantly|al instante|instantaneamente|instantan[eé]ment)\b)/i,
  },
  {
    // Parallly is not the payer. From 1 October 2026 Meta bills the tenant's
    // own WhatsApp Business account, and a page that says otherwise promises
    // to absorb a cost that is unbounded outside Colombia — one number in an
    // expensive market can owe Meta several times the price of its plan.
    label: "unsupported absorption of Meta's WhatsApp charge",
    pattern: /(?:\b(?:Parallly|we)\s+(?:pays?|paga|paie|absorbs?|absorbe|assume)\b[^.\n]{0,20}\bMeta\b|\b(?:WhatsApp\s+messages?|mensajes\s+de\s+WhatsApp|mensagens\s+do\s+WhatsApp|messages\s+WhatsApp)\b[^.\n]{0,30}\b(?:included in (?:the|your) plan|incluidos en (?:el|tu) plan|inclu[íi]das no plano|inclus dans le forfait)\b)/i,
  },
  {
    // Meta revises its rate cards quarterly and prices by the RECIPIENT's
    // country, so any sub-cent figure printed here is a number that will be
    // wrong at the next revision and right for almost nobody in the meantime.
    label: "hard-coded Meta per-message rate",
    pattern: /(?:US\$|USD|COP|\$|€)\s*0[.,]\d{3,}/i,
  },
];

// Regression fixtures ensure every high-risk branch remains executable. The
// companion script also injects a fixture and verifies the validator exits 1.
const frozenClaimRegressionSamples = [
  ["invented +45%/-60% outcome", "Sales increased +45%"],
  ["unverified 3-second response SLA", "Reply in 3 seconds"],
  ["unverified 5/10-minute setup promise", "Setup in 10 minutes"],
  ["unverified adoption or satisfaction metric", "Rated 4.9/5"],
  ["unverified partner/certification badge", "Verified Meta Tech Provider"],
  ["unverified 24/7 support promise", "24/7 support"],
  ["absolute or military-grade security claim", "100% secure"],
  ["unverified daily-backup or compliance claim", "Daily backups"],
  ["unsupported subscription pause/refund/retention promise", "Full refund"],
  ["unsupported direct CRM integration", "Native HubSpot integration"],
  ["no-ban guarantee", "No ban risk"],
  ["hard-coded 17% annual discount", "Save 17% with the annual plan"],
  ["unsupported bidirectional calendar sync", "Two-way sync with Google Calendar"],
  ["absolute no-price-hallucination promise", "Your agent never invents prices"],
  ["absolute no-hallucination promise", "Answers with your information, never makes it up"],
  ["absolute double-booking guarantee", "Atomic slot lock so customers never book the same time"],
  ["unsupported AI overage charge", "You only pay extra if you exceed AI limits"],
  ["unsupported Instagram public-comment automation", "Reply to comments and DMs on Instagram"],
  ["unsupported automated ticket management", "Automated support tickets"],
  ["unsupported automotive diagnosis or repair tracking", "Ongoing repair tracking"],
  ["unsupported financial quotes or portfolio tracking", "Portfolio tracking"],
  ["services preconfigured across all 18 verticals", "18 verticals with pre-configured services"],
  ["unsupported autonomous-sales or zero-human promise", "Your business sells on its own with zero human intervention"],
  ["unsupported instant production-readiness promise", "Ready to operate from day one"],
  ["unsupported universal vertical adaptation promise", "Parallly adapts to any business"],
  ["unsupported configure-once autonomy promise", "Configure once and let the AI handle the rest"],
  ["unverified customer outcome testimonial", "Real LatAm businesses that stopped losing sales"],
  ["absolute error-free booking promise", "Error-free booking engine"],
  ["instant human-handoff promise", "Passes the conversation to your team instantly"],
  ["unsupported absorption of Meta's WhatsApp charge", "Parallly pays Meta for you"],
  ["hard-coded Meta per-message rate", "Each WhatsApp reply costs US$0.0008"],
  ["channels described as certified", "All certified channels in one place"],
  ["architectural vertical or profile count", "18 vertical configurations available"],
  ["verified Meta funding or guaranteed delivery", "Payment verified — guaranteed delivery"],
];
for (const [label, sample] of frozenClaimRegressionSamples) {
  const rule = frozenClaimPatterns.find((claim) => claim.label === label);
  assert(rule?.pattern.test(sample), `claim-freeze regression rule must reject: ${label}`);
}

const unsupportedClaims = [
  {
    slug: "inmobiliaria",
    label: "hard-coded property inventory",
    pattern: /\b(?:12|5)\s+(?:opciones|options|apartamentos|apartments|appartements|opções)\b/i,
  },
  {
    slug: "seguros",
    label: "unverified insurance plan or price",
    pattern: /[$€£]\s*\d|\b(?:básico|basic|basique|completo|full|complète|premium)\b.{0,40}\d/i,
  },
  {
    slug: "veterinaria",
    label: "specific veterinary diagnosis or vaccine",
    pattern: /\b(?:dhpp|v8|triple|parvovirus|parvovirose|parvovírus|vaccin polyvalent)\b/i,
  },
  {
    slug: "hogar",
    label: "unverified technician ETA or price",
    pattern: /\b35\s*(?:min|minutes?)\b|[$€£]\s*60k/i,
  },
  {
    slug: "tecnologia",
    label: "unsupported support ticket or ETA",
    pattern: /\b15\s*(?:min|minutes?)\b|(?:creat|gener|cr[ée]).{0,35}ticket.{0,25}(?:prior|support)/i,
  },
  {
    slug: "pet-services",
    label: "unverified boarding capacity or price",
    pattern: /[$€£]\s*45k|\b(?:tenemos cupo|we have space|temos vaga|nous avons de la place)\b/i,
  },
  {
    slug: "finanzas",
    label: "unverified personalized financial recommendation",
    pattern: /\b(?:tengo|i have|tenho|j'ai)\s+3\s+(?:opciones|options|opções)\b/i,
  },
];

// Keep the exact high-risk legacy examples from resurfacing in another landing
// section (the hero also carries scenario copy, independently of VERTICALS).
const legacyClaimsAnywhere = [
  {
    label: "hard-coded property inventory",
    pattern: /\b(?:12\s+(?:opciones|options|opções|appartements)|5\s+(?:aptos|apartamentos|apartments|opções|appartements))\b/i,
  },
  {
    label: "hard-coded insurance pricing",
    pattern: /\$\s*89k.{0,120}\$\s*145k.{0,120}\$\s*210k\b/i,
  },
  {
    label: "specific veterinary vaccine recommendation",
    pattern: /\b(?:dhpp|v8|triple|parvovirus|parvovirose|parvovírus|vaccin polyvalent)\b/i,
  },
  {
    label: "unverified 35-minute home-service ETA or price",
    pattern: /\b35\s*(?:min|minutes?)\b|\$\s*60k(?:\s*-\s*\$?\s*120k)?/i,
  },
  {
    label: "unsupported priority-ticket or 15-minute support promise",
    pattern: /\b15\s*(?:min|minutes?)\b|(?:creat|gener|gerar|cr[ée]).{0,35}ticket.{0,25}(?:prior|support)/i,
  },
  {
    label: "hard-coded pet-care price",
    pattern: /\$\s*45k\b/i,
  },
];

const rawBySlug = new Map((verticals || []).map((vertical) => [
  vertical.slug,
  vertical.demoMessages.map((message) => message.text).join(" "),
]));

for (const claim of unsupportedClaims) {
  assert(
    !claim.pattern.test(rawBySlug.get(claim.slug) || ""),
    `verticals.ts ${claim.slug}: ${claim.label}`,
  );
}

// ─── The charge that is not ours ────────────────────────────────────────────
//
// From 1 October 2026 Meta bills the tenant's OWN WhatsApp Business account per
// delivered service message, and an account with no payment method stops
// delivering rather than degrading. A pricing page that answers "are there
// hidden fees?" without naming that charge is not merely incomplete: on the day
// it starts, it is wrong.
//
// Both figures below are read from the rate table the engine prices against,
// never retyped here. Change the allowance or move the start date in that table
// and this validator goes red, which is the point: marketing copy about
// somebody else's money must not be able to drift away from what the product
// counts.
const whatsappRates = loadTsModule(path.join(
  "..", "..", "apps", "api", "src", "modules", "billing", "whatsapp-rates",
  "whatsapp-rate-table.generated.ts",
));
const freeServiceAllowance = whatsappRates.WHATSAPP_FREE_SERVICE_ALLOWANCE;
assert(
  freeServiceAllowance?.scope === "per_phone_number_per_calendar_month"
    && freeServiceAllowance?.rollsOver === false,
  "WhatsApp free allowance must still be per number, per calendar month, with no rollover",
);
const [chargeYear, chargeMonth, chargeDay] = String(freeServiceAllowance.effectiveFrom)
  .split("-")
  .map(Number);
// Only an October start has copy written for it. Any other month means Meta
// moved the date and the four locales must be rewritten deliberately, rather
// than a stale sentence passing because the check was month-agnostic.
assert(chargeMonth === 10, `Landing copy is written for an October start, not month ${chargeMonth}`);
const metaChargeDatePatterns = {
  es: new RegExp(`\\b${chargeDay}\\s+de\\s+octubre\\s+de\\s+${chargeYear}\\b`, "i"),
  en: new RegExp(`\\b${chargeDay}\\s+October\\s+${chargeYear}\\b`, "i"),
  pt: new RegExp(`\\b${chargeDay}º?\\s+de\\s+outubro\\s+de\\s+${chargeYear}\\b`, "i"),
  fr: new RegExp(`\\b${chargeDay}(?:er)?\\s+octobre\\s+${chargeYear}\\b`, "i"),
};
// How each locale writes the thousand. The digits are checked against the table
// so a change to Meta's allowance cannot be papered over by the separator.
const allowanceTextByLocale = { es: "1.000", en: "1,000", pt: "1.000", fr: "1 000" };
for (const [locale, text] of Object.entries(allowanceTextByLocale)) {
  assert(
    Number(text.replace(/\D/g, "")) === freeServiceAllowance.deliveries,
    `${locale}: free-allowance copy says ${text}, the rate table says ${freeServiceAllowance.deliveries}`,
  );
}

// The rules themselves live in `meta-charge-disclosure.cjs` as a pure function,
// so `test-marketing-claim-regressions.cjs` can feed them copy this file does
// not contain — the narrow, service-messages-only answer that shipped first —
// and prove they reject it. A disclosure check nobody can test is a disclosure
// check that quietly weakens with every rewrite of the copy it guards.
function assertMetaChargeDisclosure(locale, messages, label) {
  for (const problem of metaChargeDisclosureFailures({
    locale,
    label,
    faqA3: messages?.pricingPage?.faqA3,
    faqA9: messages?.pricingPage?.faqA9,
    allowanceText: allowanceTextByLocale[locale],
    datePattern: metaChargeDatePatterns[locale],
  })) {
    assert(false, problem);
  }
}

for (const locale of locales) {
  const messages = loadJson(locale);
  const allLandingCopy = JSON.stringify(messages);
  const marker = markerPatterns[locale];
  const heroDemoDisclosure = `${messages?.hero?.visualLabel || ""} ${messages?.hero?.visualDisclaimer || ""}`;
  assert(
    marker.test(heroDemoDisclosure),
    `${locale}: the hero visual must say the example is illustrative`,
  );
  assert(marker.test(messages?.verticals?.demoRespondedIn || ""), `${locale}: demo badge must say the demo is illustrative`);
  assert(
    typeof messages?.verticals?.demoDisclaimer === "string"
      && messages.verticals.demoDisclaimer.trim().length >= 20,
    `${locale}: verticals.demoDisclaimer is required`,
  );
  assert(
    marker.test(messages?.channels?.demoDisclaimer || ""),
    `${locale}: multichannel scenarios must be explicitly illustrative`,
  );
  assert(
    !/\d/.test(messages?.verticals?.demoRespondedIn || ""),
    `${locale}: illustrative demo badge must not claim a measured response time`,
  );

  for (const claim of unsupportedClaims) {
    assert(
      !claim.pattern.test(translatedDemoText(messages, claim.slug)),
      `${locale} ${claim.slug}: ${claim.label}`,
    );
  }

  for (const claim of legacyClaimsAnywhere) {
    assert(
      !claim.pattern.test(allLandingCopy),
      `${locale}: legacy claim resurfaced anywhere in landing copy (${claim.label})`,
    );
  }

  const regulatedText = ["salud", "veterinaria", "seguros", "finanzas", "servicios-profesionales"]
    .map((slug) => translatedDemoText(messages, slug))
    .join(" ");
  assert(
    !/\b(?:guaranteed coverage|cobertura garantizada|cobertura garantida|garantie assurée|approved|aprobado|aprovado|approuvé)\b/i.test(regulatedText),
    `${locale}: regulated demos must not promise coverage or approval`,
  );

  for (const claim of frozenClaimPatterns) {
    assert(!claim.pattern.test(allLandingCopy), `${locale}: frozen marketing claim (${claim.label})`);
  }

  assertMetaChargeDisclosure(locale, messages, locale);

  const statLabels = [1, 2, 3].map((index) => messages?.socialProof?.[`stat${index}Label`]);
  assert(
    statLabels.every((label) => typeof label === "string" && label.trim().length > 0),
    `${locale}: all three code-backed capability labels are required`,
  );
  // A retired claim whose label survives is a claim waiting to be re-rendered.
  assert(
    messages?.socialProof?.stat4Label === undefined
      && messages?.socialProof?.stat5Label === undefined,
    `${locale}: the retired knowledge-tier and prompt-layer labels must not be reintroduced`,
  );
  assert(
    Object.values(messages?.solutions?.productModeDescription || {}).length === 4
      && Object.values(messages.solutions.productModeDescription).every((value) => (
        typeof value === 'string' && value.trim().length >= 20
      ))
      && typeof messages?.solutions?.validationRequired === 'string',
    `${locale}: honest-mode descriptions are required for every product mode`,
  );
}

const spanish = loadJson("es");
const argentinaOverlay = loadJson("es-AR");
const argentinaMessages = deepMerge(spanish, argentinaOverlay);
assert(Object.keys(argentinaOverlay).length > 0, "es-AR: regional overlay must be present and valid JSON");
// The overlay overrides the hidden-fees answer, so it can silently revert the
// disclosure for the one market where Meta's service rate is among the highest
// we sell into. Checked on the merged result, which is what a visitor reads.
assertMetaChargeDisclosure("es", argentinaMessages, "es-AR");
for (const claim of frozenClaimPatterns) {
  assert(
    !claim.pattern.test(JSON.stringify(argentinaMessages)),
    `es-AR: frozen marketing claim (${claim.label})`,
  );
}

const marketingSource = [
  readMarketingSourceTree(path.join(landingRoot, "src")),
  process.env.MARKETING_CLAIM_PROBE || "",
].join("\n");
for (const claim of frozenClaimPatterns) {
  assert(!claim.pattern.test(marketingSource), `landing source: frozen marketing claim (${claim.label})`);
}

// Testimonial publication fails closed: importing the section into the home is
// allowed only after both explicit enablement and verifiable evidence/consent.
const homeSource = fs.readFileSync(path.join(landingRoot, "src", "app", "(marketing)", "page.tsx"), "utf8");
const testimonialComponentSource = fs.readFileSync(
  path.join(landingRoot, "src", "components", "sections", "TestimonialsSection.tsx"),
  "utf8",
);
const testimonialContract = loadTsModule(path.join("src", "data", "testimonial-evidence.ts"));
const testimonialEvidence = testimonialContract.VERIFIED_TESTIMONIAL_EVIDENCE || [];
const testimonialEvidenceReady = testimonialContract.TESTIMONIALS_PUBLICATION_ENABLED === true
  && testimonialEvidence.length > 0
  && testimonialEvidence.every((item) => (
    typeof item.id === "string" && item.id.length > 0
    && typeof item.evidenceUrl === "string" && /^https:\/\//.test(item.evidenceUrl)
    && /^\d{4}-\d{2}-\d{2}$/.test(item.consentRecordedAt || "")
  ));
const homePublishesTestimonials = /TestimonialsSection/.test(homeSource);
assert(!homePublishesTestimonials, "Wave 0: TestimonialsSection must remain removed from the home until evidence is approved");
assert(
  !homePublishesTestimonials || testimonialEvidenceReady,
  "TestimonialsSection cannot be published without enablement, source evidence and recorded consent",
);
assert(
  testimonialComponentSource.includes("TESTIMONIALS_PUBLICATION_ENABLED")
    && testimonialComponentSource.includes("VERIFIED_TESTIMONIAL_EVIDENCE.length === 0"),
  "TestimonialsSection must fail closed when publication evidence is absent",
);

// Code-backed stats: compare the displayed product counts with their concrete
// registries/modules instead of trusting marketing copy.
const capabilityCounts = loadTsModule(path.join("src", "data", "product-capabilities.ts"))
  .PRODUCT_CAPABILITY_COUNTS;
const channelRegistry = loadTsModule(path.join("src", "data", "channels.ts")).CHANNELS;
const certifiedChannelPolicy = loadTsModule(path.join(
  "..", "..", "packages", "shared", "src", "channel-policy.ts",
)).CERTIFIED_SELF_SERVICE_CHANNELS;
const expectedCertifiedChannelKeys = ["whatsapp", "instagram", "messenger", "telegram", "web_widget"];
assert(
  capabilityCounts.publishedIndustryPages === verticals.length,
  "Published industry-page count must match the vertical registry",
);
assert(
  capabilityCounts.selfServiceChannels === certifiedChannelPolicy.length
    && JSON.stringify(certifiedChannelPolicy) === JSON.stringify(expectedCertifiedChannelKeys)
    && Object.keys(channelRegistry || {}).every((channel) => certifiedChannelPolicy.includes(channel)),
  "Capability stat and demo skins must match the five self-service channels",
);
assert(capabilityCounts.interfaceLanguages === locales.length, "Capability stat must match es/en/pt/fr locales");

// ─── The certified count is not ours to choose ──────────────────────────────
//
// It is read from the generated closure report, which derives it from the code.
// Typing a friendlier number here fails; making it true means certifying a
// channel, which regenerates the report and turns this green on its own.
const closureReport = JSON.parse(fs.readFileSync(
  path.join(repoRoot, "docs", "audits", "2026-09-09", "closure-report.json"),
  "utf8",
));
assert(
  capabilityCounts.selfServiceChannels === closureReport.authorities?.channelsSelfService,
  `Self-service channel count (${capabilityCounts.selfServiceChannels}) drifted from the closure report `
  + `(${closureReport.authorities?.channelsSelfService})`,
);
assert(
  capabilityCounts.certifiedChannels === closureReport.authorities?.channelsCertified,
  `Certified channel count (${capabilityCounts.certifiedChannels}) drifted from the closure report `
  + `(${closureReport.authorities?.channelsCertified})`,
);
// A landing may not present a catalogue as proven while the report certifies
// none of it. This is the rule the retired vertical count kept breaking.
assert(
  closureReport.authorities?.certifiedProfiles !== 0
    || !/certificad[oa]s?\b/i.test(String(loadJson("es")?.verticals?.title || "")),
  "The industry headline must not describe the catalogue as certified while 0 profiles are certified",
);

const positiveRegistry = loadTsModule(path.join("src", "data", "marketing-claims.ts"));
const positiveClaims = Object.values(positiveRegistry.MARKETING_CLAIMS || {});
const validationDate = process.env.MARKETING_CLAIM_VALIDATION_DATE
  || new Date().toISOString().slice(0, 10);
assert(
  positiveRegistry.MARKETING_CLAIM_REGISTRY_VERSION === 2,
  "Positive marketing claim registry must publish version 2",
);
assert(positiveClaims.length === 3, "All three visible quantitative claims must be registered");
assert(
  new Set(positiveClaims.map((claim) => claim.claimId)).size === positiveClaims.length,
  "Positive marketing claim ids must be unique",
);
const capabilityValueByClaim = {
  "product.channels.self_service.count": capabilityCounts.selfServiceChannels,
  "product.channels.certified.count": capabilityCounts.certifiedChannels,
  "product.interface_languages.count": capabilityCounts.interfaceLanguages,
};
assert(
  JSON.stringify(positiveClaims.map((claim) => claim.claimId).sort())
    === JSON.stringify(Object.keys(capabilityValueByClaim).sort()),
  "The registry and the rendered capability counts must cover exactly the same claims",
);
for (const claim of positiveClaims) {
  assert(claim.status === "verified", `${claim.claimId}: visible quantitative claim must be verified`);
  assert(
    capabilityValueByClaim[claim.claimId] === claim.value,
    `${claim.claimId}: registry value must drive the rendered capability count`,
  );
  assert(/^\d{4}-\d{2}-\d{2}$/.test(claim.verifiedAt || ""), `${claim.claimId}: verifiedAt is required`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(claim.expiresAt || ""), `${claim.claimId}: expiresAt is required`);
  assert(claim.expiresAt >= validationDate, `${claim.claimId}: evidence expired on ${claim.expiresAt}`);
  const expectedPlanScope = claim.claimId === "product.channels.self_service.count"
    ? "plan_dependent_catalog"
    : "all";
  assert(
    claim.scope?.plans === expectedPlanScope && claim.scope?.regions === "global",
    `${claim.claimId}: scope must be ${expectedPlanScope}/global`,
  );
  assert(claim.owner === "product-engineering", `${claim.claimId}: evidence owner is required`);
  assert(Array.isArray(claim.evidence) && claim.evidence.length > 0, `${claim.claimId}: evidence is required`);
  for (const evidence of claim.evidence || []) {
    assert(
      typeof evidence.id === "string"
        && evidence.id.length > 0
        && fs.existsSync(path.join(repoRoot, evidence.repositoryPath || "")),
      `${claim.claimId}: missing repository evidence ${evidence.repositoryPath || "<empty>"}`,
    );
  }
  const [, localeKey] = String(claim.localeKey || "").split(".");
  for (const locale of claim.locales || []) {
    const localeMessages = loadJson(locale);
    const copy = localeMessages?.socialProof?.[localeKey];
    assert(typeof copy === "string" && copy.trim().length > 0, `${claim.claimId}: missing ${locale} copy`);
    for (const localePath of claim.localePaths || []) {
      const occurrence = getPath(localeMessages, localePath);
      assert(
        typeof occurrence === 'string' && occurrence.includes(String(claim.value)),
        `${claim.claimId}: ${locale}.${localePath} must be driven by registered value ${claim.value}`,
      );
    }
  }
}
const layoutSource = fs.readFileSync(path.join(landingRoot, "src", "app", "layout.tsx"), "utf8");
const seoSource = fs.readFileSync(path.join(landingRoot, "src", "lib", "seo.ts"), "utf8");
const metadataPublishesProductCounts = new RegExp(
  `\\b(?:${capabilityCounts.verticals}\\b.{0,60}(?:vertical|industr|config)|${capabilityCounts.channels}\\b.{0,60}(?:channel|canal))`,
  "i",
).test(layoutSource);
assert(
  !metadataPublishesProductCounts || (
    layoutSource.includes("PRODUCT_CAPABILITY_COUNTS.verticals")
      && layoutSource.includes("PRODUCT_CAPABILITY_COUNTS.channels")
  ),
  "Quantitative metadata must derive product counts from the positive registry, or omit those counts",
);
assert(
  !/aggregateRating|ratingValue|ratingCount/.test(seoSource),
  "Aggregate ratings must remain unpublished until testimonial/rating evidence is registered",
);
assert(
  !/AggregateOffer|priceCurrency|lowPrice|highPrice|offerCount|"@type": "Offer"/.test(seoSource),
  "Structured data must not publish static prices while billing plans are loaded from a mutable authoritative source",
);
const channelModuleSource = fs.readFileSync(
  path.join(repoRoot, "apps", "api", "src", "modules", "channels", "channels.module.ts"),
  "utf8",
);
const adapterClassByChannel = {
  whatsapp: "WhatsAppAdapter",
  instagram: "InstagramAdapter",
  messenger: "MessengerAdapter",
  telegram: "TelegramAdapter",
  sms: "SmsAdapter",
  email: "EmailAdapter",
};
for (const [channel, adapterClass] of Object.entries(adapterClassByChannel)) {
  const adapterFile = path.join(
    repoRoot,
    "apps",
    "api",
    "src",
    "modules",
    "channels",
    channel,
    `${channel}.adapter.ts`,
  );
  assert(fs.existsSync(adapterFile), `${channel}: backend channel adapter file is required`);
  assert(
    channelModuleSource.includes(adapterClass)
      && channelModuleSource.includes(`registerAdapter(this.${channel}Adapter)`),
    `${channel}: backend adapter must be registered in ChannelsModule`,
  );
}
// The knowledge-tier and prompt-layer stats are gone: they were architecture,
// not an answer to anything a buyer asks, and their assertions went with them.
// What replaced them is the pair below, which a reader can act on.
const statsSource = fs.readFileSync(
  path.join(landingRoot, "src", "components", "sections", "StatsCounter.tsx"),
  "utf8",
);
assert(
  statsSource.includes("PRODUCT_CAPABILITY_COUNTS.selfServiceChannels")
    && statsSource.includes("PRODUCT_CAPABILITY_COUNTS.certifiedChannels")
    && statsSource.includes("PRODUCT_CAPABILITY_COUNTS.interfaceLanguages"),
  "StatsCounter must render only code-backed product capability counts",
);
assert(
  !/PRODUCT_CAPABILITY_COUNTS\.publishedIndustryPages/.test(statsSource),
  "The published-page count is a routing fact, not a headline number",
);
assert(
  statsSource.includes("MARKETING_CLAIMS")
    && /data-claim-id=\{\w+\.claimId\}/.test(statsSource),
  "Every StatsCounter quantitative claim must render its positive registry id",
);

const trustSource = fs.readFileSync(
  path.join(landingRoot, "src", "components", "sections", "TrustRow.tsx"),
  "utf8",
);
const footerSource = fs.readFileSync(path.join(landingRoot, "src", "components", "layout", "Footer.tsx"), "utf8");
assert(
  !/meta-tech-provider\.svg|Tech Provider|MercadoPago Partner/i.test(`${trustSource}\n${footerSource}`),
  "TrustRow/Footer must present integrations and capabilities, not certifications",
);

// The detailed pricing matrix reads live values from the billing catalog. Keep
// the bootstrap floors aligned with the seed, and prevent commercial rows from
// regressing to hardcoded fallback values.
const pricing = loadTsModule(path.join("src", "data", "pricing.ts"));
const planSeedSource = fs.readFileSync(path.join(repoRoot, "apps", "api", "prisma", "seed-billing-plans.js"), "utf8");
function featureFromSeed(slug, feature) {
  const start = planSeedSource.indexOf(`slug: '${slug}'`);
  const end = planSeedSource.indexOf("\n    {", start + 1);
  const block = planSeedSource.slice(start, end === -1 ? undefined : end);
  const match = block.match(new RegExp(`${feature}:\\s*(-?\\d+)`));
  return match ? Number(match[1]) : undefined;
}
function channelsFromSeed(slug) {
  const start = planSeedSource.indexOf(`slug: '${slug}'`);
  const end = planSeedSource.indexOf("\n    {", start + 1);
  const block = planSeedSource.slice(start, end === -1 ? undefined : end);
  const match = block.match(/channels:\s*\[([^\]]*)\]/);
  return match ? [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]) : [];
}
for (const slug of ["emprendedor", "starter"]) {
  const floor = pricing.VERTICAL_BOOTSTRAP_PLAN_FLOORS?.[slug];
  assert(floor?.pipelineStages === 7, `${slug}: landing pipeline-stage floor must be 7`);
  assert(floor?.appointmentsServices === 4, `${slug}: landing service floor must be 4`);
  assert(
    floor?.pipelineStages === featureFromSeed(slug, "pipelineStages"),
    `${slug}: landing pipeline-stage fallback drifted from billing seed`,
  );
  assert(
    floor?.appointmentsServices === featureFromSeed(slug, "appointmentsServices"),
    `${slug}: landing service fallback drifted from billing seed`,
  );
}
const pipelineRow = pricing.FEATURE_MATRIX.find((row) => row.key === "pipelineStages");
const servicesRow = pricing.FEATURE_MATRIX.find((row) => row.key === "services");
const channelRow = pricing.FEATURE_MATRIX.find((row) => row.key === "channels");
assert(
  pipelineRow?.src === "feat:pipelineStages",
  "Pricing must read pipeline stages from the live billing catalog",
);
assert(
  servicesRow?.src === "feat:appointmentsServices",
  "Pricing must read appointment services from the live billing catalog",
);
assert(
  channelRow?.src === "feat:channels",
  "Pricing must read channel availability from the live billing catalog",
);
for (const slug of ["emprendedor", "starter", "pro", "enterprise", "custom"]) {
  assert(channelsFromSeed(slug).length > 0, `${slug}: billing seed must declare its channel set`);
}

// ─── The industry catalogue states its state, not its size ──────────────────
//
// The count is frozen above. What has to be PRESENT is the state: every locale's
// two industry headlines must say that specialised capability waits on
// validation, because that is the fact the number used to hide.
const certificationStatePatterns = {
  es: /valida(?:ci[oó]n|rse|da)|certificaci[oó]n|certificad/i,
  en: /validat|certif/i,
  pt: /valida(?:ç[aã]o|r|da)|certifica/i,
  fr: /validation|valid[ée]|certifi/i,
};
for (const locale of locales) {
  const messages = loadJson(locale);
  for (const localePath of ["verticals.subtitle", "solutions.heroSubtitle", "howItWorks.step2Desc"]) {
    const copy = String(getPath(messages, localePath) || "");
    assert(copy.trim().length > 0, `${locale}: ${localePath} is required`);
    assert(
      certificationStatePatterns[locale].test(copy),
      `${locale}: ${localePath} must state the certification/validation state of the industry catalogue`,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
//   THE THREE PAYMENTS
// ════════════════════════════════════════════════════════════════════════════
//
// A page about somebody else's money is the easiest place on this site to be
// accidentally wrong, and the most expensive: a reader who believes Meta's
// charge is inside their plan budgets nothing for it and loses delivery on
// 1 October 2026. So the shared contract is pinned to the rate table the engine
// prices against, and the page copy is pinned to the contract.

const paymentModel = loadTsModule(path.join("src", "data", "payment-model.ts"));
const metaCharge = paymentModel.META_WHATSAPP_CHARGE;
const paymentParties = paymentModel.PAYMENT_PARTIES || [];

assert(
  metaCharge?.effectiveFrom === freeServiceAllowance.effectiveFrom,
  `payment-model effectiveFrom (${metaCharge?.effectiveFrom}) drifted from the rate table `
  + `(${freeServiceAllowance.effectiveFrom})`,
);
assert(
  metaCharge?.freeServiceDeliveries === freeServiceAllowance.deliveries,
  `payment-model allowance (${metaCharge?.freeServiceDeliveries}) drifted from the rate table `
  + `(${freeServiceAllowance.deliveries})`,
);
// Meta's deadline is the day before the charge starts. If the charge date moves,
// this catches a deadline sentence that stayed behind.
const dayBeforeCharge = new Date(`${freeServiceAllowance.effectiveFrom}T00:00:00Z`);
dayBeforeCharge.setUTCDate(dayBeforeCharge.getUTCDate() - 1);
assert(
  metaCharge?.paymentMethodDeadline === dayBeforeCharge.toISOString().slice(0, 10),
  "The funding deadline must be the day before Meta's charge begins",
);
// Every category the rate table prices must be disclosed. A subset reads as a
// complete list, and the expensive one — marketing — is the easiest to omit.
const tableCategories = new Set(whatsappRates.WHATSAPP_MESSAGE_CATEGORIES || []);
for (const category of metaCharge?.billedCategories || []) {
  assert(tableCategories.has(category), `payment-model names a category the rate table does not price: ${category}`);
}
for (const category of ["service", "marketing", "utility", "authentication"]) {
  assert(
    (metaCharge?.billedCategories || []).includes(category),
    `payment-model must disclose the ${category} category Meta bills separately`,
  );
}
for (const [field, url] of Object.entries({
  officialRatesUrl: metaCharge?.officialRatesUrl,
  billingManagerUrl: metaCharge?.billingManagerUrl,
  addPaymentMethodHelpUrl: metaCharge?.addPaymentMethodHelpUrl,
})) {
  assert(
    /^https:\/\/(?:[\w.-]+\.)?(?:facebook\.com|whatsapp\.com)\//.test(String(url || "")),
    `payment-model.${field} must point at an official Meta destination over HTTPS`,
  );
}
assert(
  paymentParties.length === 3
    && JSON.stringify(paymentParties.map((party) => party.id))
      === JSON.stringify(["subscription", "whatsappDelivery", "customerPayments"]),
  "The payment model must carry exactly the three payments, in order",
);
assert(
  paymentParties.find((party) => party.id === "whatsappDelivery")?.methodEnteredAt === "meta"
    && paymentParties.find((party) => party.id === "whatsappDelivery")?.parallelyVisibility === "status_only",
  "Meta's card is entered at Meta, and our visibility of it stops at status",
);
assert(
  paymentParties.find((party) => party.id === "customerPayments")?.parallelyVisibility === "none",
  "Money from a tenant's customers does not pass through Parallly and must not claim visibility",
);
for (const party of paymentParties) {
  for (const evidencePath of party.evidence || []) {
    assert(
      fs.existsSync(path.join(repoRoot, evidencePath)),
      `payment-model ${party.id}: missing repository evidence ${evidencePath}`,
    );
  }
}

// The notice has to reach the two places where somebody is about to act.
const noticeSource = fs.readFileSync(
  path.join(landingRoot, "src", "components", "sections", "ThreePaymentsNotice.tsx"),
  "utf8",
);
assert(
  noticeSource.includes("routes.whatsappCosts") && noticeSource.includes('t("noticeShort")'),
  "The three-payments notice must carry the short disclosure and link to the canonical page",
);
const ctaBannerSource = fs.readFileSync(
  path.join(landingRoot, "src", "components", "layout", "CTABanner.tsx"),
  "utf8",
);
const pricingPageSource = fs.readFileSync(
  path.join(landingRoot, "src", "app", "(marketing)", "precios", "page.tsx"),
  "utf8",
);
assert(
  ctaBannerSource.includes("<ThreePaymentsNotice"),
  "The CTA banner must carry the three-payments notice next to the call to action",
);
assert(
  pricingPageSource.includes("<ThreePaymentsNotice") && pricingPageSource.includes("<ThreePaymentsPanel"),
  "The pricing page must carry the notice next to the price and the full panel before the FAQ",
);

const deadlineMonth = Number(String(metaCharge.paymentMethodDeadline).split("-")[1]);
assert(deadlineMonth === 9, `Copy is written for a September deadline, not month ${deadlineMonth}`);
const deadlineDay = Number(String(metaCharge.paymentMethodDeadline).split("-")[2]);
const deadlineYear = Number(String(metaCharge.paymentMethodDeadline).split("-")[0]);
const deadlinePatterns = {
  es: new RegExp(`\\b${deadlineDay}\\s+de\\s+septiembre\\s+de\\s+${deadlineYear}\\b`, "i"),
  en: new RegExp(`\\b${deadlineDay}\\s+September\\s+${deadlineYear}\\b`, "i"),
  pt: new RegExp(`\\b${deadlineDay}\\s+de\\s+setembro\\s+de\\s+${deadlineYear}\\b`, "i"),
  fr: new RegExp(`\\b${deadlineDay}\\s+septembre\\s+${deadlineYear}\\b`, "i"),
};
const categoryWords = {
  es: { marketing: /marketing/i, utility: /utilidad/i, authentication: /autenticaci[oó]n/i, service: /servicio/i },
  en: { marketing: /marketing/i, utility: /utility/i, authentication: /authentication/i, service: /service/i },
  pt: { marketing: /marketing/i, utility: /utilidade/i, authentication: /autentica[cç][aã]o/i, service: /servi[cç]o/i },
  fr: { marketing: /marketing/i, utility: /utilitaires?/i, authentication: /authentification/i, service: /service/i },
};
// Negation in French is "ne … pas" but also "ne … ni … ni", and every locale
// puts a pronoun between the verb and its negation. The patterns match the
// concept in each language's own grammar rather than one blessed sentence.
const custodyPatterns = {
  es: { receive: /no recibe/i, store: /no (?:la |lo )?guarda/i, verify: /comprobar|verificar/i },
  en: { receive: /does not receive/i, store: /does not store/i, verify: /verif/i },
  pt: { receive: /n[aã]o recebe/i, store: /n[aã]o (?:o |a )?guarda/i, verify: /verific/i },
  fr: {
    receive: /ne re[cç]oit (?:pas|ni)/i,
    store: /ne (?:la |le )?conserve pas/i,
    verify: /v[ée]rifi/i,
  },
};
const customerWord = /client|customer/i;

/**
 * Everything the three-payment copy must contain, in one locale.
 *
 * Taken as a function so the es-AR overlay can be checked on its MERGED result:
 * the overlay overrides the voseo half of this copy, which means it can narrow
 * the disclosure for one market without touching any of the four base files.
 */
function assertThreePaymentCopy(locale, messages, label) {
  const payments = messages?.payments || {};
  const costs = messages?.whatsappCosts || {};

  // ── The shared three-payment copy ────────────────────────────────────────
  assert(/Parallly/.test(String(payments.subscriptionWho || "")), `${label}: payment 1 must name Parallly as the payee`);
  assert(/\bMeta\b/.test(String(payments.whatsappDeliveryWho || "")), `${label}: payment 2 must name Meta as the payee`);
  assert(
    customerWord.test(String(payments.customerPaymentsWho || "")),
    `${label}: payment 3 must say the customers pay the business`,
  );
  assert(
    metaChargeDatePatterns[locale].test(String(payments.whatsappDeliveryBody || "")),
    `${label}: payment 2 must date the charge Meta starts issuing`,
  );
  assert(
    metaChargeDatePatterns[locale].test(String(payments.noticeShort || ""))
      && /Parallly/.test(String(payments.noticeShort || ""))
      && /\bMeta\b/.test(String(payments.noticeShort || "")),
    `${label}: the short notice must name all three payments and date Meta's charge`,
  );
  // The subscription card is the single most common thing a reader assumes
  // also pays Meta. Every locale has to say, explicitly, that it does not.
  assert(
    /\bMeta\b/.test(String(payments.subscriptionNote || "")),
    `${label}: the subscription card must say it does not configure or pay Meta`,
  );

  // ── /costos-whatsapp ─────────────────────────────────────────────────────
  assert(Object.keys(costs).length > 0, `${label}: the whatsappCosts namespace is required`);
  assert(
    metaChargeDatePatterns[locale].test(String(costs.ruleIntro || "")),
    `${label}: the costs page must date the start of Meta's charge`,
  );
  assert(
    String(costs.allowanceBody || "").includes(allowanceTextByLocale[locale]),
    `${label}: the costs page must state the free allowance exactly as the rate table counts it`,
  );
  for (const [category, pattern] of Object.entries(categoryWords[locale])) {
    assert(
      pattern.test(String(costs[`category${category.charAt(0).toUpperCase()}${category.slice(1)}`] || "")),
      `${label}: the costs page must describe the ${category} category Meta bills`,
    );
  }
  assert(
    deadlinePatterns[locale].test(String(costs.deadlineBody || "")),
    `${label}: the costs page must carry Meta's funding deadline`,
  );
  assert(
    metaChargeDatePatterns[locale].test(String(costs.deadlineBody || "")),
    `${label}: the deadline must say what changes on the day the charge starts`,
  );
  const custody = `${costs.security1 || ""} ${costs.security2 || ""} ${costs.security3 || ""}`;
  for (const [aspect, pattern] of Object.entries(custodyPatterns[locale])) {
    assert(
      pattern.test(custody),
      `${label}: the costs page must say Parallly does not ${aspect} the Meta card`,
    );
  }
  // Embedded Signup and adding the card are different steps. A page that blurs
  // them produces accounts that are connected and unfunded.
  assert(
    String(costs.setupIntro || "").length >= 40
      && /\bMeta\b/.test(String(costs.setupIntro || ""))
      && /Parallly/.test(String(costs.setupIntro || "")),
    `${label}: the setup introduction must separate connecting the number from adding the card`,
  );
  assert(
    String(costs.setupStep5Body || "").length >= 40,
    `${label}: the costs page must explain what an attached payment method does not prove`,
  );
  // No rate, and no estimated total dressed as one.
  assert(
    String(costs.ratesBody || "").length >= 40 && String(costs.noEstimateBody || "").length >= 40,
    `${label}: the costs page must explain why it publishes neither a rate nor an estimated maximum`,
  );
  assert(
    !/(?:US\$|USD|COP|€)\s*\d/.test(JSON.stringify(costs)),
    `${label}: the costs page must not print a currency figure for somebody else's rate card`,
  );
  // ── The two answers a narrowing edit would reach for first ───────────────
  //
  // "Who pays Meta" is the whole page in one sentence, and the es-AR overlay
  // rewrites it for voseo — so an edit can shorten it to "your business" in one
  // market and leave the other four intact. It has to keep naming both
  // companies and keep saying the money does not run through us.
  assert(
    /\bMeta\b/.test(String(costs.faqA1 || ""))
      && /Parallly/.test(String(costs.faqA1 || ""))
      && String(costs.faqA1 || "").length >= 80,
    `${label}: the "who pays Meta" answer must name both companies and say the money does not pass through Parallly`,
  );
  // The allowance is the most repeatable misreading on the page: per number,
  // per calendar month, service only. An answer that stops stating the figure
  // invites the reader to supply their own.
  assert(
    String(costs.faqA3 || "").includes(allowanceTextByLocale[locale]),
    `${label}: the allowance answer must keep stating the figure the rate table counts`,
  );
}

for (const locale of locales) assertThreePaymentCopy(locale, loadJson(locale), locale);
// Argentina reads the merged result, and the overlay overrides the voseo half
// of this copy — including the answer to "who pays Meta". Checked as Spanish,
// reported as es-AR.
assertThreePaymentCopy("es", argentinaMessages, "es-AR");

// ════════════════════════════════════════════════════════════════════════════
//   THE COMPARISON
// ════════════════════════════════════════════════════════════════════════════
//
// Meta's own agent learns a business, sets a tone, books on Google Calendar and
// hands off to a person. A comparison that denies any of that is refutable in
// one click, and takes the rest of the page down with it. These rules keep the
// page to states with sources, and out of superlatives nobody has measured.

const comparison = loadTsModule(path.join("src", "data", "meta-comparison.ts"));
const comparisonTasks = comparison.COMPARISON_TASKS || [];
const comparisonSurfaces = comparison.META_SURFACES || [];

assert(
  /^\d{4}-\d{2}-\d{2}$/.test(comparison.COMPARISON_VERIFIED_AT || ""),
  "The comparison must carry the date its sources were read",
);
assert(
  comparison.COMPARISON_EXPIRES_AT >= validationDate,
  `The Meta comparison expired on ${comparison.COMPARISON_EXPIRES_AT}; re-verify the sources or take it down`,
);
assert(comparisonTasks.length >= 8, "A task-by-task comparison needs the tasks");
assert(comparisonSurfaces.length === 3, "The three Meta surfaces must stay distinguished");
for (const surface of comparisonSurfaces) {
  assert(/^https:\/\//.test(surface.sourceUrl || ""), `${surface.id}: surface source must be an HTTPS primary source`);
}
const validStates = new Set([
  "implementedNotCertified", "documented", "documentedWithLimits", "requiresAccountCheck", "notDocumented",
]);
const validVerdicts = new Set(["bothCovered", "differentScope", "notComparable", "nativeMayBeEnough"]);
for (const task of comparisonTasks) {
  assert(validStates.has(task.parallly), `${task.id}: unknown evidence state for Parallly`);
  assert(validStates.has(task.meta), `${task.id}: unknown evidence state for Meta`);
  assert(validVerdicts.has(task.verdict), `${task.id}: unknown verdict`);
  // Our own side may never read as certified: the closure report certifies none.
  assert(
    task.parallly !== "documented" || task.id === "cost",
    `${task.id}: Parallly's state must be the product's own state, not a documentation claim`,
  );
  assert(
    Array.isArray(task.sources) && task.sources.length > 0
      && task.sources.every((url) => /^https:\/\//.test(url)),
    `${task.id}: every compared task needs at least one HTTPS primary source`,
  );
  assert(
    ["appAgent", "platformApi", "ownerAssistant"].includes(task.metaSurface),
    `${task.id}: every row must name which Meta product it compares`,
  );
}

const superlativePatterns = {
  es: /\b(?:mejor(?:es)?|m[aá]s barat[oa]s?|m[aá]s r[aá]pid[oa]s?|l[ií]der del mercado)\b/i,
  en: /\b(?:better|best|cheaper|cheapest|faster|fastest|market leader)\b/i,
  pt: /\b(?:melhor(?:es)?|mais barat[oa]s?|mais r[aá]pid[oa]s?|l[ií]der de mercado)\b/i,
  fr: /\b(?:meilleur(?:e|s|es)?|moins cher(?:s|ère|ères)?|plus rapides?|leader du march[ée])\b/i,
};
const notDocumentedCaveat = {
  es: /no significa que/i,
  en: /does not mean/i,
  pt: /n[aã]o significa que/i,
  fr: /ne signifie pas/i,
};

for (const locale of locales) {
  const messages = loadJson(locale);
  const compare = messages?.compareMeta || {};
  assert(Object.keys(compare).length > 0, `${locale}: the compareMeta namespace is required`);

  assert(
    String(compare.heroDate || "").includes(comparison.COMPARISON_VERIFIED_AT.slice(0, 4)),
    `${locale}: the comparison must print the year its sources were read`,
  );
  assert(
    notDocumentedCaveat[locale].test(String(compare.method4 || "")),
    `${locale}: the comparison must say that undocumented is not the same as absent`,
  );
  assert(
    String(compare.methodLimit1 || "").length >= 40 && String(compare.methodLimit2 || "").length >= 40,
    `${locale}: the comparison must state that no benchmark was run and that availability varies`,
  );
  assert(
    String(compare.nativeEnoughIntro || "").length >= 40
      && ["Single", "Informational", "NoOperation"].every(
        (suffix) => String(compare[`nativeEnough${suffix}`] || "").length >= 20,
      ),
    `${locale}: the comparison must concede where the native agent is enough`,
  );

  for (const task of comparisonTasks) {
    const id = task.id.charAt(0).toUpperCase() + task.id.slice(1);
    for (const suffix of ["Label", "Parallly", "Meta"]) {
      assert(
        typeof compare[`task${id}${suffix}`] === "string" && compare[`task${id}${suffix}`].trim().length > 0,
        `${locale}: missing comparison copy task${id}${suffix}`,
      );
    }
  }

  // Superlatives are allowed in exactly one place: the section that quotes the
  // claims in order to refuse them, and the limits that say we will not make them.
  for (const [key, value] of Object.entries(compare)) {
    if (typeof value !== "string") continue;
    if (/^(?:refuted|methodLimit)/.test(key)) continue;
    assert(
      !superlativePatterns[locale].test(value),
      `${locale}: compareMeta.${key} makes a comparative claim with no benchmark behind it`,
    );
    assert(
      !/\d+\s*%|\b\d+\s*x\b/i.test(value),
      `${locale}: compareMeta.${key} publishes a quantitative result with no benchmark behind it`,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════════
//   ROUTES, PAGES AND THE SITEMAP AGREE
// ════════════════════════════════════════════════════════════════════════════
//
// A page that exists and is not in the sitemap is a page nobody finds; a route
// in the sitemap with no page behind it is a 404 served to a crawler.

const routesModule = loadTsModule(path.join("src", "lib", "routes.ts")).routes;
const sitemap = fs.readFileSync(path.join(landingRoot, "public", "sitemap.xml"), "utf8");
const appRoot = path.join(landingRoot, "src", "app");
const staticRoutes = Object.values(routesModule).filter((route) => typeof route === "string");

for (const route of staticRoutes) {
  if (route === "/") continue;
  const candidates = [
    path.join(appRoot, "(marketing)", ...route.split("/").filter(Boolean), "page.tsx"),
    path.join(appRoot, ...route.split("/").filter(Boolean), "page.tsx"),
  ];
  assert(candidates.some((candidate) => fs.existsSync(candidate)), `route ${route} has no page behind it`);
  assert(sitemap.includes(`https://parallly-chat.cloud${route}</loc>`), `route ${route} is missing from the sitemap`);
}
for (const newRoute of ["/costos-whatsapp", "/comparar/meta-business-agent"]) {
  const layout = path.join(appRoot, "(marketing)", ...newRoute.split("/").filter(Boolean), "layout.tsx");
  const layoutSourceText = fs.existsSync(layout) ? fs.readFileSync(layout, "utf8") : "";
  assert(
    layoutSourceText.includes("buildMetadata") && layoutSourceText.includes(`path: "${newRoute}"`),
    `${newRoute}: metadata must declare its own canonical path`,
  );
}
const navigationSource = fs.readFileSync(path.join(landingRoot, "src", "data", "navigation.ts"), "utf8");
assert(
  navigationSource.includes('href: "/costos-whatsapp"')
    && navigationSource.includes('href: "/comparar/meta-business-agent"'),
  "Both new pages must be reachable from navigation, not only from a link inside prose",
);

if (failures.length) {
  console.error("Marketing claim contract failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(
  `Marketing claim contract passed: ${verticals.length} industry pages, es/en/pt/fr + es-AR, `
  + `${positiveClaims.length} registered counts (${capabilityCounts.certifiedChannels} of `
  + `${capabilityCounts.selfServiceChannels} channels certified), the three payments, `
  + `${comparisonTasks.length} sourced comparison rows, evidence gates and plan floors.`,
);
