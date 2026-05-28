"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useVerticalTerms } from "@/hooks/useVerticalTerms";
import {
  HelpCircle,
  Sparkles,
  BookOpen,
  Lightbulb,
  Copy,
  Check,
  Search,
  ChevronRight,
  Database,
  Sliders,
  Shield,
  Bell,
  Calendar,
  Mail,
  Code,
  Terminal,
  X
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger
} from "@/components/ui/sheet";

export function HelpAssistant() {
  const t = useTranslations("helpAssistant");
  const pathname = usePathname();
  const vt = useVerticalTerms();

  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeGuideId, setActiveGuideId] = useState<string | null>(null);

  // Auto-detect guide based on current pathname
  useEffect(() => {
    if (!pathname) return;
    
    if (pathname.includes("/admin/settings/api-keys") || pathname.includes("/admin/webhooks")) {
      setActiveGuideId("apiKeys");
    } else if (pathname.includes("/admin/settings/smtp") || pathname.includes("/admin/settings/email-templates")) {
      setActiveGuideId("smtp");
    } else if (pathname.includes("/admin/automation")) {
      setActiveGuideId("automation");
    } else if (pathname.includes("/admin/knowledge")) {
      setActiveGuideId("knowledge");
    } else if (pathname.includes("/admin/alerts")) {
      setActiveGuideId("alerts");
    } else if (pathname.includes("/admin/appointments")) {
      setActiveGuideId("appointments");
    } else {
      setActiveGuideId(null);
    }
  }, [pathname]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Define guide data dynamically using translations
  const guides = [
    {
      id: "apiKeys",
      icon: Shield,
      title: t("apiKeys.title"),
      description: t("apiKeys.description"),
      sub1Title: t("apiKeys.sub1Title"),
      sub1Desc: t("apiKeys.sub1Desc"),
      code1: `// Meta HMAC Validation
const crypto = require("crypto");
const signature = req.headers["x-hub-signature-256"];
const payload = JSON.stringify(req.body);
const expected = "sha256=" + crypto
  .createHmac("sha256", process.env.META_APP_SECRET)
  .update(payload)
  .digest("hex");

if (signature === expected) {
  console.log("Verified Meta Webhook!");
}`,
      sub2Title: t("apiKeys.sub2Title"),
      sub2Desc: t("apiKeys.sub2Desc"),
      code2: `curl -X POST https://api.parallly-chat.cloud/api/v1/webhooks \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "event": "lead.created",
    "target_url": "https://yourcrm.hubspot.com/webhooks"
  }'`
    },
    {
      id: "smtp",
      icon: Mail,
      title: t("smtp.title"),
      description: t("smtp.description"),
      sub1Title: t("smtp.sub1Title"),
      sub1Desc: t("smtp.sub1Desc"),
      code1: `Host: smtp.mailgun.org
Port: 587 (TLS)
Username: postmaster@yourdomain.com
Password: ••••••••••••••••••••`,
      sub2Title: t("smtp.sub2Title"),
      sub2Desc: t("smtp.sub2Desc"),
      code2: `Hola {{customer_name}},

Confirmamos tu cita para el servicio de {{service_name}} el día {{appointment_date}}.

Gracias por confiar en {{business_name}}.`
    },
    {
      id: "automation",
      icon: Sliders,
      title: t("automation.title"),
      description: t("automation.description"),
      sub1Title: t("automation.sub1Title"),
      sub1Desc: t("automation.sub1Desc"),
      code1: `// Estructura de Regla de Automatización
{
  "trigger": "message.received",
  "conditions": {
    "lead_score": { "gte": 80 },
    "channel": "instagram"
  },
  "actions": [
    { "type": "assign_to_agent", "agent_id": "agent-uuid" },
    { "type": "send_nurturing_email", "delay_hours": 2 }
  ]
}`,
      sub2Title: t("automation.sub2Title"),
      sub2Desc: t("automation.sub2Desc"),
      code2: `1. Espera de Inactividad: 4 Horas
2. Filtro: Etapa del Lead == "Tibio"
3. Acción: Enviar mensaje "Hola, ¿pudiste revisar la información anterior?"`
    },
    {
      id: "knowledge",
      icon: Database,
      title: t("knowledge.title"),
      description: t("knowledge.description"),
      sub1Title: t("knowledge.sub1Title"),
      sub1Desc: t("knowledge.sub1Desc"),
      code1: `// Configuración RAG++ Recomendada
{
  "search": "hybrid", 
  "similarityThreshold": 0.75,
  "topK": 4,
  "boostKeywords": ["precio", "reserva", "horario"]
}`,
      sub2Title: t("knowledge.sub2Title"),
      sub2Desc: t("knowledge.sub2Desc"),
      code2: `Ejemplo de citación estructurada en la respuesta del agente IA:
"De acuerdo con nuestra política de cancelación [Política: cancelacion], puedes cancelar sin cargo hasta 24 horas antes del servicio."`
    },
    {
      id: "alerts",
      icon: Bell,
      title: t("alerts.title"),
      description: t("alerts.description"),
      sub1Title: t("alerts.sub1Title"),
      sub1Desc: t("alerts.sub1Desc"),
      code1: `// Umbral de Anomalía Z-Score
zScore = (x - mean) / stdDev
Flag: zScore > 2.0  // Alerta de desviación > 2σ`,
      sub2Title: t("alerts.sub2Title"),
      sub2Desc: t("alerts.sub2Desc"),
      code2: `{
  "username": "Parallly Z-Score Monitor",
  "content": "⚠️ **Alerta Estadística:** El volumen de conversaciones en el canal WhatsApp se ha desviado 2.4σ por encima de la media semanal."
}`
    },
    {
      id: "appointments",
      icon: Calendar,
      title: t("appointments.title"),
      description: t("appointments.description"),
      sub1Title: t("appointments.sub1Title"),
      sub1Desc: t("appointments.sub1Desc"),
      code1: `// Sincronización Google Meet / Teams
{
  "modality": "virtual",
  "autoCreateMeeting": true,
  "provider": "google_calendar"
}`,
      sub2Title: t("appointments.sub2Title"),
      sub2Desc: t("appointments.sub2Desc"),
      code2: `Fechas Bloqueadas:
- 25 Diciembre (Navidad)
- 1 Enero (Año Nuevo)
- Domingos (Días no laborables)`
    }
  ];

  // Define general FAQs for searching
  const generalFaqs = [
    {
      question: "¿Cómo funciona la IA para responder?",
      answer: "El agente IA analiza los mensajes de los clientes usando la Base de Conocimientos (RAG++) para responder preguntas frecuentes sobre precios, políticas, y agendar citas automáticamente. Si detecta intención de hablar con un humano o se frustra, inicia un Handoff.",
      category: "Agente IA"
    },
    {
      question: "¿Cómo se activa la sincronización del calendario?",
      answer: "Ve a la sección Citas -> Configuración de Calendario y haz clic en 'Conectar Google Calendar' o 'Conectar Microsoft Outlook'. El sistema validará tus slots ocupados y evitará colisiones automáticamente.",
      category: "Citas"
    },
    {
      question: "¿Dónde configuro el horario comercial de atención?",
      answer: "En Configuración -> Horarios de Empresa puedes registrar el huso horario de tu negocio y la ventana semanal activa. El agente IA respetará estas horas y aplicará flujos fuera de servicio si es necesario.",
      category: "Empresa"
    },
    {
      question: "¿Qué es el Lead Score y cómo lo personalizo?",
      answer: "El scoring de leads asigna puntos en tiempo real a tus contactos según sus acciones (etiquetas recibidas, mensajes enviados, etapa en el pipeline). Configura las ponderaciones en Configuración -> CRM -> Scoring de Leads.",
      category: "CRM"
    }
  ];

  // Dynamic industry-tailored prompt suggestions based on useVerticalTerms
  const getIndustryAdvice = () => {
    const ind = vt.industry?.toLowerCase();
    switch (ind) {
      case "vacation_rentals":
      case "properties":
        return {
          prompt: `Eres un conserje de hospitalidad premium para nuestros apartamentos vacacionales. Tu objetivo es ayudar a los huéspedes a coordinar el check-in, explicar las amenidades, y agendar reservas. Siempre transmite calidez, confort y profesionalismo.`,
          example: "Preguntas de ejemplo: '¿Cómo obtengo el código de acceso?', '¿Tienen cunas disponibles?'"
        };
      case "gyms":
      case "fitness":
        return {
          prompt: `Eres un asesor de membresía y coach motivacional para nuestro centro de bienestar. Tu objetivo es resolver dudas de precios, clases disponibles y agendar una sesión de prueba gratuita en la agenda. Sé enérgico, inspirador y servicial.`,
          example: "Preguntas de ejemplo: '¿Qué clases tienen los lunes?', '¿Cuánto cuesta el pase mensual?'"
        };
      case "restaurants":
      case "food":
        return {
          prompt: `Eres el host y camarero digital de nuestro prestigioso restaurante. Muestra el menú de hoy, recomienda especialidades del chef, aclara ingredientes alérgicos y gestiona reservaciones de mesa. Mantén un tono elegante y apetecible.`,
          example: "Preguntas de ejemplo: '¿Tienen opciones veganas?', '¿Puedo reservar para 4 personas hoy a las 8pm?'"
        };
      default:
        return {
          prompt: `Eres el agente inteligente y consultor de soporte principal del negocio. Tu misión es resolver las dudas frecuentes utilizando la base de conocimiento y guiar de manera fluida y educada al usuario a registrar una cita de asesoría.`,
          example: "Preguntas de ejemplo: '¿Cuáles son sus servicios?', '¿Cómo puedo agendar una llamada?'"
        };
    }
  };

  const industryAdvice = getIndustryAdvice();

  // Filter content based on search query
  const filteredGuides = guides.filter(g => 
    g.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    g.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    g.sub1Title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    g.sub2Title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredFaqs = generalFaqs.filter(faq =>
    faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 p-4 rounded-full flex items-center justify-center bg-linear-to-r from-indigo-600/90 to-purple-600/90 dark:from-indigo-500/90 dark:to-purple-500/90 hover:from-indigo-600 hover:to-purple-600 text-white shadow-[0_4px_24px_rgba(99,102,241,0.5)] border border-white/10 hover:scale-105 active:scale-95 transition-all duration-300 group cursor-pointer"
        >
          <HelpCircle className="size-6 transition-transform duration-500 group-hover:rotate-[360deg]" />
          <span className="absolute -top-12 right-0 scale-0 group-hover:scale-100 transition-all duration-200 bg-neutral-950 text-white text-[11px] font-medium px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap border border-white/10">
            {t("launcherTooltip")}
          </span>
        </button>
      </SheetTrigger>
      
      <SheetContent className="w-full sm:max-w-md bg-white/80 dark:bg-neutral-950/80 backdrop-blur-xl border-l border-neutral-200/50 dark:border-neutral-800/50 shadow-2xl flex flex-col p-0 overflow-hidden">
        {/* Header section with Glassmorphic Gradient */}
        <div className="p-6 pb-4 border-b border-neutral-200/50 dark:border-neutral-800/50 bg-linear-to-b from-indigo-50/30 to-white/0 dark:from-indigo-950/10 dark:to-transparent">
          <SheetHeader className="p-0 gap-1 select-none">
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400">
              <Sparkles className="size-5 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 rounded-md">
                Parallly Assist
              </span>
            </div>
            <SheetTitle className="text-2xl font-extrabold tracking-tight text-neutral-900 dark:text-white mt-1">
              {t("drawerTitle")}
            </SheetTitle>
            <SheetDescription className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed mt-0.5">
              {t("drawerSubtitle")}
            </SheetDescription>
          </SheetHeader>

          {/* Luxury Rounded Search Bar */}
          <div className="relative mt-4">
            <Search className="absolute left-3 top-2.5 size-4 text-neutral-400 dark:text-neutral-500" />
            <input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 rounded-xl text-sm bg-neutral-100/80 dark:bg-neutral-900/80 border border-neutral-200/50 dark:border-neutral-800/50 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30 text-neutral-900 dark:text-white transition-all placeholder-neutral-400 dark:placeholder-neutral-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-2.5 p-0.5 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
              >
                <X className="size-3 text-neutral-500" />
              </button>
            )}
          </div>
        </div>

        {/* Dynamic & Searchable Content Area */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 scrollbar-thin scrollbar-thumb-neutral-200 dark:scrollbar-thumb-neutral-800">
          
          {/* 1. Dynamic Path-Aware Guide */}
          {activeGuideId && !searchQuery && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-indigo-500/10 pb-2">
                <BookOpen className="size-4 text-indigo-500" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  {t("currentPathGuide")}
                </h3>
              </div>
              
              {guides.filter(g => g.id === activeGuideId).map((guide) => (
                <div key={guide.id} className="space-y-4">
                  <div className="rounded-xl border border-indigo-500/15 bg-indigo-500/5 dark:bg-indigo-500/10 p-4 space-y-2">
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
                        <guide.icon className="size-5" />
                      </div>
                      <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">
                        {guide.title}
                      </h4>
                    </div>
                    <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed pt-1">
                      {guide.description}
                    </p>
                  </div>

                  {/* Config Sub-Step 1 */}
                  <div className="space-y-2">
                    <h5 className="text-xs font-bold text-neutral-800 dark:text-neutral-300 flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-indigo-500" />
                      {guide.sub1Title}
                    </h5>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed pl-3">
                      {guide.sub1Desc}
                    </p>
                    
                    {guide.code1 && (
                      <div className="relative group/code pl-3">
                        <pre className="text-[11px] font-mono p-3 bg-neutral-950 dark:bg-neutral-900 text-neutral-200 dark:text-neutral-300 rounded-lg overflow-x-auto border border-neutral-800 shadow-inner select-all leading-normal">
                          <code>{guide.code1}</code>
                        </pre>
                        <button
                          onClick={() => copyToClipboard(guide.code1, `${guide.id}-c1`)}
                          className="absolute right-2 top-2 p-1.5 rounded-md bg-neutral-800/80 dark:bg-neutral-800 hover:bg-neutral-700 text-neutral-300 opacity-0 group-hover/code:opacity-100 transition-opacity duration-200 border border-neutral-700/50 cursor-pointer"
                        >
                          {copiedId === `${guide.id}-c1` ? (
                            <Check className="size-3 text-emerald-400" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Config Sub-Step 2 */}
                  <div className="space-y-2">
                    <h5 className="text-xs font-bold text-neutral-800 dark:text-neutral-300 flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-purple-500" />
                      {guide.sub2Title}
                    </h5>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed pl-3">
                      {guide.sub2Desc}
                    </p>

                    {guide.code2 && (
                      <div className="relative group/code pl-3">
                        <pre className="text-[11px] font-mono p-3 bg-neutral-950 dark:bg-neutral-900 text-neutral-200 dark:text-neutral-300 rounded-lg overflow-x-auto border border-neutral-800 shadow-inner select-all leading-normal">
                          <code>{guide.code2}</code>
                        </pre>
                        <button
                          onClick={() => copyToClipboard(guide.code2, `${guide.id}-c2`)}
                          className="absolute right-2 top-2 p-1.5 rounded-md bg-neutral-800/80 dark:bg-neutral-800 hover:bg-neutral-700 text-neutral-300 opacity-0 group-hover/code:opacity-100 transition-opacity duration-200 border border-neutral-700/50 cursor-pointer"
                        >
                          {copiedId === `${guide.id}-c2` ? (
                            <Check className="size-3 text-emerald-400" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 2. Industry-Tailored RAG / AI Coach Tips */}
          {!searchQuery && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 border-b border-purple-500/10 pb-2">
                <Lightbulb className="size-4 text-purple-500" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                  {t("industryTitle", { industry: vt.industry === "otro" ? "General" : vt.industry })}
                </h3>
              </div>
              
              <div className="rounded-xl border border-purple-500/15 bg-linear-to-r from-purple-500/5 to-indigo-500/5 dark:from-purple-500/10 dark:to-indigo-500/10 p-4 space-y-3 relative overflow-hidden">
                {/* Glowing decorative shape */}
                <div className="absolute -right-4 -bottom-4 size-16 rounded-full bg-purple-500/10 blur-xl pointer-events-none" />
                
                <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed font-medium">
                  {t("industryDesc")}
                </p>

                <div className="space-y-2 pl-1">
                  <div className="relative group/advice bg-white/50 dark:bg-neutral-900/50 p-3 rounded-lg border border-neutral-200/50 dark:border-neutral-800/50">
                    <span className="text-[10px] font-bold tracking-wider text-purple-500 uppercase flex items-center gap-1">
                      <Code className="size-3" /> Prompt del Sistema
                    </span>
                    <p className="text-[11px] text-neutral-700 dark:text-neutral-300 leading-relaxed italic mt-1 font-mono">
                      "{industryAdvice.prompt}"
                    </p>
                    <button
                      onClick={() => copyToClipboard(industryAdvice.prompt, "industry-prompt")}
                      className="absolute right-2 top-2 p-1 rounded-md bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-400 opacity-0 group-hover/advice:opacity-100 transition-opacity duration-200 cursor-pointer"
                    >
                      {copiedId === "industry-prompt" ? (
                        <Check className="size-3 text-emerald-500" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                  </div>

                  <div className="bg-white/30 dark:bg-neutral-900/30 p-3 rounded-lg border border-neutral-200/30 dark:border-neutral-800/30">
                    <span className="text-[10px] font-bold tracking-wider text-indigo-500 uppercase flex items-center gap-1">
                      <Terminal className="size-3" /> Casos de Ejemplo
                    </span>
                    <p className="text-[11px] text-neutral-600 dark:text-neutral-400 mt-1 leading-relaxed">
                      {industryAdvice.example}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. Search Results or All Guides List */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-neutral-200/50 dark:border-neutral-800/50 pb-2">
              <BookOpen className="size-4 text-neutral-500" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-800 dark:text-neutral-300">
                {searchQuery ? `Resultados (${filteredGuides.length + filteredFaqs.length})` : t("faqTitle")}
              </h3>
            </div>

            {/* List filtered guides first if searching */}
            {searchQuery && filteredGuides.map((guide) => (
              <div
                key={guide.id}
                onClick={() => {
                  setActiveGuideId(guide.id);
                  setSearchQuery("");
                }}
                className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:border-indigo-500/30 dark:hover:border-indigo-500/30 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/5 transition-all duration-200 cursor-pointer group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1 rounded-md bg-neutral-100 dark:bg-neutral-900 text-neutral-500 group-hover:text-indigo-500 transition-colors">
                      <guide.icon className="size-4" />
                    </div>
                    <span className="text-xs font-bold text-neutral-900 dark:text-white">
                      {guide.title}
                    </span>
                  </div>
                  <ChevronRight className="size-3.5 text-neutral-400 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all" />
                </div>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1 pl-7 line-clamp-2">
                  {guide.description}
                </p>
              </div>
            ))}

            {/* Filtered general FAQs */}
            <div className="space-y-3.5">
              {filteredFaqs.map((faq, index) => (
                <div
                  key={index}
                  className="p-3.5 rounded-xl bg-neutral-50 dark:bg-neutral-900/40 border border-neutral-200/50 dark:border-neutral-800/50 hover:border-neutral-300 dark:hover:border-neutral-700 transition-all duration-200"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-[13px] mt-0.5">💬</span>
                    <div>
                      <h4 className="text-xs font-bold text-neutral-900 dark:text-white leading-snug">
                        {faq.question}
                      </h4>
                      <p className="text-[11px] text-neutral-600 dark:text-neutral-400 mt-1 leading-relaxed">
                        {faq.answer}
                      </p>
                      <span className="inline-block text-[9px] font-bold text-indigo-500/80 bg-indigo-500/5 px-2 py-0.5 rounded-md mt-2 border border-indigo-500/10">
                        {faq.category}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {filteredGuides.length === 0 && filteredFaqs.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-xs text-neutral-400 dark:text-neutral-500">
                    {t("noResults")}
                  </p>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Footer Area with Branding and Quick links */}
        <div className="p-4 border-t border-neutral-200/50 dark:border-neutral-800/50 bg-neutral-50 dark:bg-neutral-900/50 flex items-center justify-between">
          <span className="text-[10px] font-medium text-neutral-400 dark:text-neutral-500">
            Parallly SaaS · V4.0.0
          </span>
          <a
            href="https://parallly-chat.cloud/support"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
          >
            Soporte Técnico <ChevronRight className="size-2.5" />
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
