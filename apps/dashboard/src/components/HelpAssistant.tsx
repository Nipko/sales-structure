"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useVerticalTerms } from "@/hooks/useVerticalTerms";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
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
  X,
  Home,
  MessageSquare,
  Users,
  TrendingUp,
  Megaphone,
  Bot,
  Link as LinkIcon,
  CreditCard,
  Send,
  Loader2
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
  const { user } = useAuth();

  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeGuideId, setActiveGuideId] = useState<string | null>(null);
  
  // Dual-tab navigation state
  const [activeTab, setActiveTab] = useState<'guides' | 'chat'>('guides');

  // AI Chat state
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    {
      role: 'assistant',
      content: '¡Hola! 👋 Soy tu copiloto de ayuda de Parallly. Estoy aquí para responder tus preguntas funcionales sobre la plataforma: configuración de canales, CRM, automatizaciones, citas y más. ¿En qué puedo ayudarte hoy?'
    }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat timeline to the bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  // Auto-detect guide based on current pathname (mapping 12 distinct routes)
  useEffect(() => {
    if (!pathname) return;
    
    if (pathname === "/admin" || pathname === "/admin/") {
      setActiveGuideId("overview");
    } else if (pathname.includes("/admin/inbox")) {
      setActiveGuideId("inbox");
    } else if (pathname.includes("/admin/contacts")) {
      setActiveGuideId("contacts");
    } else if (pathname.includes("/admin/pipeline")) {
      setActiveGuideId("pipeline");
    } else if (pathname.includes("/admin/appointments")) {
      setActiveGuideId("appointments");
    } else if (pathname.includes("/admin/broadcast")) {
      setActiveGuideId("broadcast");
    } else if (pathname.includes("/admin/automation")) {
      setActiveGuideId("automation");
    } else if (pathname.includes("/admin/knowledge")) {
      setActiveGuideId("knowledge");
    } else if (pathname.includes("/admin/agent")) {
      setActiveGuideId("agent");
    } else if (pathname.includes("/admin/channels")) {
      setActiveGuideId("channels");
    } else if (pathname.includes("/admin/users")) {
      setActiveGuideId("users");
    } else if (pathname.includes("/admin/settings/billing")) {
      setActiveGuideId("billing");
    } else if (pathname.includes("/admin/settings/api-keys") || pathname.includes("/admin/webhooks")) {
      setActiveGuideId("apiKeys");
    } else if (pathname.includes("/admin/settings/smtp") || pathname.includes("/admin/settings/email-templates")) {
      setActiveGuideId("smtp");
    } else if (pathname.includes("/admin/alerts")) {
      setActiveGuideId("alerts");
    } else {
      setActiveGuideId(null);
    }
  }, [pathname]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSuggestionClick = (text: string) => {
    if (isSending) return;
    sendMessage(text);
  };

  const sendMessage = async (text: string) => {
    if (!text.trim()) return;
    const userMsg = { role: 'user' as const, content: text };
    setMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setIsSending(true);
    
    try {
      const chatHistory = messages.map(m => ({ role: m.role, content: m.content }));
      
      const response = await api.copilotChat({
        message: text,
        context: {
          page: pathname,
          tenantId: user?.tenantId,
          userName: user?.firstName || 'Usuario',
          userRole: user?.role || 'agent'
        },
        history: chatHistory
      });
      
      if (response && response.success && response.data?.reply) {
        const replyContent = response.data.reply;
        setMessages(prev => [...prev, { role: 'assistant', content: replyContent }]);
      } else {
        const errorMsg = response?.error || 'No he recibido una respuesta válida. ¿Podrías intentar nuevamente?';
        setMessages(prev => [...prev, { role: 'assistant', content: errorMsg }]);
      }
    } catch (error) {
      console.error('Error calling copilotChat API:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Lo siento, ha ocurrido un error al conectar con mi cerebro de IA. Por favor, asegúrate de que tu suscripción esté activa y tus proveedores de IA estén configurados en la plataforma.'
      }]);
    } finally {
      setIsSending(false);
    }
  };

  // Helper to parse bold, inline code, paragraphs, and list formatting inline in chat bubbles
  const renderFormattedText = (text: string) => {
    return text.split("\n").map((line, lineIdx) => {
      const isListItem = line.trim().startsWith("- ") || line.trim().startsWith("* ");
      const isNumberedItem = /^\d+\.\s/.test(line.trim());
      
      let cleanLine = line;
      if (isListItem) cleanLine = line.trim().substring(2);
      if (isNumberedItem) cleanLine = line.trim().replace(/^\d+\.\s/, "");

      const parts = [];
      let currentText = cleanLine;
      const regex = /(\*\*.*?\*\*|`.*?`)/g;
      let match;
      let lastIndex = 0;

      while ((match = regex.exec(cleanLine)) !== null) {
        const index = match.index;
        const matchStr = match[0];

        if (index > lastIndex) {
          parts.push(<span key={lastIndex}>{cleanLine.substring(lastIndex, index)}</span>);
        }

        if (matchStr.startsWith("**") && matchStr.endsWith("**")) {
          parts.push(<strong key={index} className="font-extrabold text-neutral-900 dark:text-white">{matchStr.slice(2, -2)}</strong>);
        } else if (matchStr.startsWith("`") && matchStr.endsWith("`")) {
          parts.push(<code key={index} className="font-mono bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded-md text-[10px] text-pink-600 dark:text-pink-400 border border-neutral-200/30 dark:border-neutral-700/30">{matchStr.slice(1, -1)}</code>);
        }

        lastIndex = regex.lastIndex;
      }

      if (lastIndex < cleanLine.length) {
        parts.push(<span key={lastIndex}>{cleanLine.substring(lastIndex)}</span>);
      }

      if (isListItem) {
        return (
          <li key={lineIdx} className="list-disc ml-4 my-1 pl-1 text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300">
            {parts}
          </li>
        );
      }
      if (isNumberedItem) {
        return (
          <li key={lineIdx} className="list-decimal ml-4 my-1 pl-1 text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300">
            {parts}
          </li>
        );
      }

      return (
        <p key={lineIdx} className="min-h-[8px] my-1 text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300">
          {parts}
        </p>
      );
    });
  };

  // Define guide data dynamically using translations (15 comprehensive items)
  const guides = [
    {
      id: "overview",
      icon: Home,
      title: t("overview.title"),
      description: t("overview.description"),
      sub1Title: t("overview.sub1Title"),
      sub1Desc: t("overview.sub1Desc"),
      code1: `// Fórmula de Contención de IA
tasaContencion = (conversacionesResueltasPorIA / totalConversaciones) * 100

// Monitorea el ahorro operativo mensual directamente en tu panel principal.`,
      sub2Title: t("overview.sub2Title"),
      sub2Desc: t("overview.sub2Desc"),
      code2: `Estimación de Costo de Tokens:
Costos = tokensEntrada * $0.0015 + tokensSalida * $0.002`
    },
    {
      id: "inbox",
      icon: MessageSquare,
      title: t("inbox.title"),
      description: t("inbox.description"),
      sub1Title: t("inbox.sub1Title"),
      sub1Desc: t("inbox.sub1Desc"),
      code1: `// Mutex de Conversación (Redis Lock)
// Previene condiciones de carrera cuando llegan múltiples mensajes simultáneos.
lockKey = "lock:conv:" + conversationId
SETNX lockKey "1" EX 30`,
      sub2Title: t("inbox.sub2Title"),
      sub2Desc: t("inbox.sub2Desc"),
      code2: `Asignación manual de agente a conversación:
POST /api/v1/conversations/:id/assign
Payload: { "agentId": "agent-uuid" }`
    },
    {
      id: "contacts",
      icon: Users,
      title: t("contacts.title"),
      description: t("contacts.description"),
      sub1Title: t("contacts.sub1Title"),
      sub1Desc: t("contacts.sub1Desc"),
      code1: `// Algoritmo de scoring automático de leads (1 al 10)
score = Math.min(10, Math.max(1, countMessages * 0.5 + stageWeight))`,
      sub2Title: t("contacts.sub2Title"),
      sub2Desc: t("contacts.sub2Desc"),
      code2: `Ejemplo de esquema de Atributos Personalizados:
{
  "custom_attributes": {
    "preferred_modality": "virtual",
    "budget_range": "1000-2000"
  }
}`
    },
    {
      id: "pipeline",
      icon: TrendingUp,
      title: t("pipeline.title"),
      description: t("pipeline.description"),
      sub1Title: t("pipeline.sub1Title"),
      sub1Desc: t("pipeline.sub1Desc"),
      code1: `Etapas del Embudo Kanban:
1. Nuevo
2. Contactado
3. Calificado
4. Caliente
5. Listo para Cierre
6. Ganado`,
      sub2Title: t("pipeline.sub2Title"),
      sub2Desc: t("pipeline.sub2Desc"),
      code2: `Regla de avance automático por Scoring:
IF lead_score >= 8 THEN MOVE_STAGE("caliente")`
    },
    {
      id: "broadcast",
      icon: Megaphone,
      title: t("broadcast.title"),
      description: t("broadcast.description"),
      sub1Title: t("broadcast.sub1Title"),
      sub1Desc: t("broadcast.sub1Desc"),
      code1: `// Envío masivo con plantilla aprobada por Meta
POST /api/v1/broadcast/send
{
  "templateName": "bienvenida_cliente",
  "segmentId": "segment-uuid",
  "parameters": ["Juan"]
}`,
      sub2Title: t("broadcast.sub2Title"),
      sub2Desc: t("broadcast.sub2Desc"),
      code2: `Métricas del Embudo de Campaña:
Enviado -> Entregado -> Leído -> Conversión`
    },
    {
      id: "agent",
      icon: Bot,
      title: t("agent.title"),
      description: t("agent.description"),
      sub1Title: t("agent.sub1Title"),
      sub1Desc: t("agent.sub1Desc"),
      code1: `// Arquitectura del Prompt de Turno
SystemPrompt = Layer1 (Contract) + Layer2 (Persona) + Layer3 (Turn Context)`,
      sub2Title: t("agent.sub2Title"),
      sub2Desc: t("agent.sub2Desc"),
      code2: `Configuración de Circuit Breaker (Handoff Express):
{
  "maxRepetitions": 3,
  "forceHandoffKeywords": ["humano", "asesor", "hablar con alguien"]
}`
    },
    {
      id: "channels",
      icon: LinkIcon,
      title: t("channels.title"),
      description: t("channels.description"),
      sub1Title: t("channels.sub1Title"),
      sub1Desc: t("channels.sub1Desc"),
      code1: `// Payloads de Conexión de Canales (Instagram OAuth)
POST /api/v1/channels/instagram/connect
{
  "provider": "instagram",
  "accessToken": "EAAG...",
  "pageId": "10492837..."
}`,
      sub2Title: t("channels.sub2Title"),
      sub2Desc: t("channels.sub2Desc"),
      code2: `Cron de renovación de tokens de API:
0 6 * * * -> InstagramTokenRefreshService (Ejecución Diaria @6AM)`
    },
    {
      id: "users",
      icon: Users,
      title: t("users.title"),
      description: t("users.description"),
      sub1Title: t("users.sub1Title"),
      sub1Desc: t("users.sub1Desc"),
      code1: `Jerarquía de Roles de Plataforma:
- super_admin (Control global)
- tenant_admin (Ajustes y facturación)
- tenant_supervisor (Auditoría y CRM)
- tenant_agent (Atención al cliente)`,
      sub2Title: t("users.sub2Title"),
      sub2Desc: t("users.sub2Desc"),
      code2: `Enrutamiento por Habilidades:
IF tags CONTAINS "soporte_tecnico" THEN ROUTE_TO_SKILL("soporte")`
    },
    {
      id: "billing",
      icon: CreditCard,
      title: t("billing.title"),
      description: t("billing.description"),
      sub1Title: t("billing.sub1Title"),
      sub1Desc: t("billing.sub1Desc"),
      code1: `Límites de Suscripción por Plan:
- Starter: 1 agente, 1 calendario
- Pro: 3 agentes, 3 calendarios
- Enterprise: 10 agentes, 10 calendarios`,
      sub2Title: t("billing.sub2Title"),
      sub2Desc: t("billing.sub2Desc"),
      code2: `Cuotas de envío y automatización por hora:
- Starter: 50 auto + 200 outbound
- Pro: 500 auto + 2000 outbound`
    },
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

  // Quick suggestion chips for Asistente IA Chat
  const chatSuggestions = [
    "¿Cómo conecto WhatsApp?",
    "¿Cómo funciona el Lead Scoring?",
    "¿Cómo configuro el RAG++?",
    "¿Cómo sincronizo mi calendario?"
  ];

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

          {/* Premium Glassmorphic Toggle Tabs */}
          <div className="flex p-1 mt-4 bg-neutral-100/80 dark:bg-neutral-900/80 rounded-xl border border-neutral-200/50 dark:border-neutral-800/50 backdrop-blur-md">
            <button
              onClick={() => setActiveTab('guides')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all duration-300 cursor-pointer ${
                activeTab === 'guides'
                  ? 'bg-white dark:bg-neutral-800 text-indigo-600 dark:text-indigo-400 shadow-xs border border-neutral-200/30 dark:border-neutral-700/30'
                  : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-300'
              }`}
            >
              <BookOpen className="size-3.5" />
              Guías & FAQs
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all duration-300 cursor-pointer ${
                activeTab === 'chat'
                  ? 'bg-white dark:bg-neutral-800 text-indigo-600 dark:text-indigo-400 shadow-xs border border-neutral-200/30 dark:border-neutral-700/30'
                  : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-300'
              }`}
            >
              <Sparkles className="size-3.5 animate-pulse text-indigo-500" />
              Asistente IA
            </button>
          </div>

          {/* Guide Search Bar - Only rendered when on Guides tab */}
          {activeTab === 'guides' && (
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
                  className="absolute right-3 top-2.5 p-0.5 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                >
                  <X className="size-3 text-neutral-500" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Tab View Content Logic */}
        {activeTab === 'guides' ? (
          /* ========================================================================= */
          /* TAB 1: GUIDES & FAQS                                                      */
          /* ========================================================================= */
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

            {/* 2. Industry-Tailored AI Coach Tips */}
            {!searchQuery && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2 border-b border-purple-500/10 pb-2">
                  <Lightbulb className="size-4 text-purple-500" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                    {t("industryTitle", { industry: vt.industry === "otro" ? "General" : vt.industry })}
                  </h3>
                </div>
                
                <div className="rounded-xl border border-purple-500/15 bg-linear-to-r from-purple-500/5 to-indigo-500/5 dark:from-purple-500/10 dark:to-indigo-500/10 p-4 space-y-3 relative overflow-hidden">
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
        ) : (
          /* ========================================================================= */
          /* TAB 2: INTERACTIVE AI COPILOT CHET                                         */
          /* ========================================================================= */
          <div className="flex-1 flex flex-col overflow-hidden bg-neutral-50/10 dark:bg-neutral-950/10">
            {/* Messages timeline area */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 flex flex-col scrollbar-thin scrollbar-thumb-neutral-200 dark:scrollbar-thumb-neutral-800">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`max-w-[85%] ${
                    msg.role === 'user' ? 'self-end' : 'self-start'
                  }`}
                >
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-xs shadow-xs leading-relaxed transition-all duration-200 ${
                      msg.role === 'user'
                        ? 'bg-linear-to-r from-indigo-600 to-purple-600 dark:from-indigo-500 dark:to-purple-500 text-white rounded-tr-none border border-white/5 shadow-md shadow-indigo-500/10'
                        : 'bg-white dark:bg-neutral-900 border border-neutral-200/50 dark:border-neutral-800/50 text-neutral-800 dark:text-neutral-200 rounded-tl-none shadow-2xs'
                    }`}
                  >
                    {msg.role === 'user' ? msg.content : renderFormattedText(msg.content)}
                  </div>
                </div>
              ))}
              
              {/* Typing indicator */}
              {isSending && (
                <div className="self-start max-w-[85%] flex items-center gap-1.5 bg-white dark:bg-neutral-900 border border-neutral-200/50 dark:border-neutral-800/50 text-neutral-400 dark:text-neutral-500 rounded-2xl rounded-tl-none px-4 py-3 shadow-2xs text-xs select-none">
                  <span className="size-1.5 rounded-full bg-indigo-500/80 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="size-1.5 rounded-full bg-indigo-500/80 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="size-1.5 rounded-full bg-indigo-500/80 animate-bounce" style={{ animationDelay: '300ms' }} />
                  <span className="ml-1 text-[10px] text-neutral-400 dark:text-neutral-500 animate-pulse">
                    Copilot está escribiendo...
                  </span>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Suggestion Chips */}
            <div className="flex gap-2 px-6 py-2 overflow-x-auto scrollbar-none select-none border-t border-neutral-200/30 dark:border-neutral-800/30 bg-neutral-50/20 dark:bg-neutral-950/20 shrink-0">
              {chatSuggestions.map((sug, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSuggestionClick(sug)}
                  disabled={isSending}
                  className="text-[10px] font-semibold text-neutral-600 dark:text-neutral-400 bg-white dark:bg-neutral-900 border border-neutral-200/50 dark:border-neutral-800/50 hover:border-indigo-500/30 dark:hover:border-indigo-500/30 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/5 px-2.5 py-1.5 rounded-full whitespace-nowrap shadow-2xs hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
                >
                  {sug}
                </button>
              ))}
            </div>

            {/* Bottom input area */}
            <div className="p-4 border-t border-neutral-200/50 dark:border-neutral-800/50 bg-neutral-50 dark:bg-neutral-900/50 shrink-0">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendMessage(chatInput);
                }}
                className="flex gap-2 relative items-center"
              >
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={isSending}
                  placeholder="Pregúntame sobre la plataforma..."
                  className="w-full pl-4 pr-12 py-2.5 text-xs bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500/30 text-neutral-900 dark:text-white transition-all disabled:opacity-50 placeholder-neutral-400"
                />
                <button
                  type="submit"
                  disabled={isSending || !chatInput.trim()}
                  className="absolute right-1.5 p-2 rounded-lg bg-indigo-600 dark:bg-indigo-500 hover:bg-indigo-700 text-white disabled:opacity-40 hover:scale-105 active:scale-95 disabled:hover:scale-100 transition-all cursor-pointer"
                >
                  {isSending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Footer Area with Branding and Quick links */}
        <div className="p-4 border-t border-neutral-200/50 dark:border-neutral-800/50 bg-neutral-50 dark:bg-neutral-900/50 flex items-center justify-between shrink-0">
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
