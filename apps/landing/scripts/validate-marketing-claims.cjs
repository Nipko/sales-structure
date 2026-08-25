const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const landingRoot = path.resolve(__dirname, "..");
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

  const statLabels = [1, 2, 3, 4, 5].map((index) => messages?.socialProof?.[`stat${index}Label`]);
  assert(
    statLabels.every((label) => typeof label === "string" && label.trim().length > 0),
    `${locale}: all five code-backed capability labels are required`,
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
const supportedChannelKeys = ["whatsapp", "instagram", "messenger", "telegram", "sms", "email"];
assert(capabilityCounts.verticals === verticals.length, "Capability stat must match the vertical registry");
assert(
  capabilityCounts.channels === Object.keys(channelRegistry || {}).length
    && supportedChannelKeys.every((channel) => channelRegistry?.[channel]),
  "Capability stat must match the six registered messaging adapters",
);
assert(capabilityCounts.interfaceLanguages === locales.length, "Capability stat must match es/en/pt/fr locales");

const repoRoot = path.resolve(landingRoot, "..", "..");
const positiveRegistry = loadTsModule(path.join("src", "data", "marketing-claims.ts"));
const positiveClaims = Object.values(positiveRegistry.MARKETING_CLAIMS || {});
const validationDate = process.env.MARKETING_CLAIM_VALIDATION_DATE
  || new Date().toISOString().slice(0, 10);
assert(
  positiveRegistry.MARKETING_CLAIM_REGISTRY_VERSION === 1,
  "Positive marketing claim registry must publish version 1",
);
assert(positiveClaims.length === 5, "All five visible quantitative claims must be registered");
assert(
  new Set(positiveClaims.map((claim) => claim.claimId)).size === positiveClaims.length,
  "Positive marketing claim ids must be unique",
);
const capabilityValueByClaim = {
  "product.verticals.count": capabilityCounts.verticals,
  "product.channels.adapters.count": capabilityCounts.channels,
  "product.interface_languages.count": capabilityCounts.interfaceLanguages,
  "product.knowledge_tiers.count": capabilityCounts.knowledgeTiers,
  "product.prompt_layers.count": capabilityCounts.promptLayers,
};
for (const claim of positiveClaims) {
  assert(claim.status === "verified", `${claim.claimId}: visible quantitative claim must be verified`);
  assert(
    capabilityValueByClaim[claim.claimId] === claim.value,
    `${claim.claimId}: registry value must drive the rendered capability count`,
  );
  assert(/^\d{4}-\d{2}-\d{2}$/.test(claim.verifiedAt || ""), `${claim.claimId}: verifiedAt is required`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(claim.expiresAt || ""), `${claim.claimId}: expiresAt is required`);
  assert(claim.expiresAt >= validationDate, `${claim.claimId}: evidence expired on ${claim.expiresAt}`);
  const expectedPlanScope = claim.claimId === "product.channels.adapters.count"
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
const knowledgeEvidenceFiles = [
  "apps/api/src/modules/business-info/business-info.service.ts",
  "apps/api/src/modules/catalog/catalog.service.ts",
  "apps/api/src/modules/faqs/faqs.service.ts",
  "apps/api/src/modules/policies/policies.service.ts",
  "apps/api/src/modules/knowledge/knowledge.service.ts",
];
assert(
  capabilityCounts.knowledgeTiers === knowledgeEvidenceFiles.length
    && knowledgeEvidenceFiles.every((file) => fs.existsSync(path.join(repoRoot, file))),
  "Capability stat must match the five implemented knowledge tiers",
);
const promptAssemblerSource = fs.readFileSync(
  path.join(repoRoot, "apps", "api", "src", "modules", "conversations", "prompt-assembler.service.ts"),
  "utf8",
);
assert(
  capabilityCounts.promptLayers === 3
    && /const layer1\s*=\s*this\.buildContractLayer\(\)/.test(promptAssemblerSource)
    && /const layer2\s*=\s*this\.personaService\.buildSystemPrompt/.test(promptAssemblerSource)
    && /const layer3\s*=\s*this\.buildTurnLayer\(turn\)/.test(promptAssemblerSource),
  "Capability stat must match the three-layer prompt assembler",
);

const statsSource = fs.readFileSync(
  path.join(landingRoot, "src", "components", "sections", "StatsCounter.tsx"),
  "utf8",
);
assert(
  statsSource.includes("PRODUCT_CAPABILITY_COUNTS.verticals")
    && statsSource.includes("PRODUCT_CAPABILITY_COUNTS.channels")
    && statsSource.includes("PRODUCT_CAPABILITY_COUNTS.interfaceLanguages")
    && statsSource.includes("PRODUCT_CAPABILITY_COUNTS.knowledgeTiers")
    && statsSource.includes("PRODUCT_CAPABILITY_COUNTS.promptLayers"),
  "StatsCounter must render only code-backed product capability counts",
);
assert(
  statsSource.includes("MARKETING_CLAIMS")
    && statsSource.includes("data-claim-id={s.claimId}"),
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

const english = loadJson("en");
assert(
  /\b18\b/.test(english?.verticals?.subtitle || "")
    && /\bvertical configurations\b/i.test(english?.verticals?.subtitle || ""),
  "en: verticals.subtitle must describe the 18 registered vertical configurations",
);
assert(/\b18\b/.test(english?.howItWorks?.step2Desc || ""), "en: howItWorks.step2Desc must advertise 18 templates");

if (failures.length) {
  console.error("Marketing claim contract failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Marketing claim contract passed for 18 verticals, es/en/pt/fr + es-AR, evidence gates and plan floors.");
