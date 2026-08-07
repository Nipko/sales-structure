"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { useVerticalTerms } from "@/hooks/useVerticalTerms";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import {
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
  Loader2,
  Compass
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger
} from "@/components/ui/sheet";
import { ParalllyAssistant, type ParalllyState } from "@/components/ParalllyAssistant";

const ANNOUNCED_KEY = "parallly:assistant-announced";

/** Chispas que salen disparadas cuando Parallly aterriza. */
const INTRO_SPARKS = [
  { sx: "-40px", sy: "-48px", delay: "120ms", cls: "size-1.5 bg-[#3897f0]" },
  { sx: "36px", sy: "-56px", delay: "260ms", cls: "size-2 bg-amber-400" },
  { sx: "-54px", sy: "-12px", delay: "400ms", cls: "size-1 bg-[#7ab9f5]" },
  { sx: "50px", sy: "-16px", delay: "540ms", cls: "size-1.5 bg-indigo-400" },
];

/** Fases de la presentación: cae → aterriza y saluda → habla → se retira. */
type IntroPhase = "hidden" | "enter" | "talk" | "done";

export function HelpAssistant() {
  const t = useTranslations("helpAssistant");
  const locale = useLocale();
  const pathname = usePathname();
  const vt = useVerticalTerms();
  const { user } = useAuth();

  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [intro, setIntro] = useState<IntroPhase>("done");

  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeGuideId, setActiveGuideId] = useState<string | null>(null);

  // Dual-tab navigation state — el Asistente IA es la puerta de entrada
  const [activeTab, setActiveTab] = useState<'guides' | 'chat'>('chat');

  // Abrir siempre en el Asistente IA: es lo primero que ve quien pide ayuda.
  const openAssistant = () => {
    setActiveTab('chat');
    setIntro("done");
    setOpen(true);
  };

  // Presentación de bienvenida: una vez por sesión. Parallly entra rebotando,
  // suelta chispas, saluda y cuenta para qué está. A los ~9s se retira solo.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    try {
      if (typeof window === "undefined" || sessionStorage.getItem(ANNOUNCED_KEY)) return;
    } catch { return; }

    const mark = () => { try { sessionStorage.setItem(ANNOUNCED_KEY, "1"); } catch { /* ignore */ } };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      // Sin movimiento: el mensaje igual aparece, solo que sin la entrada.
      timers.push(setTimeout(() => { mark(); setIntro("talk"); }, 1200));
      timers.push(setTimeout(() => setIntro("done"), 10200));
    } else {
      setIntro("hidden");
      timers.push(setTimeout(() => { mark(); setIntro("enter"); }, 900));
      timers.push(setTimeout(() => setIntro("talk"), 1700));
      timers.push(setTimeout(() => setIntro("done"), 10000));
    }
    return () => timers.forEach(clearTimeout);
  }, []);

  // Allow other parts of the app (e.g. the onboarding tour) to open the copilot.
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && localStorage.getItem("parallly:openCopilot")) {
        localStorage.removeItem("parallly:openCopilot");
        openAssistant();
      }
    } catch { /* ignore */ }
    const handler = () => openAssistant();
    window.addEventListener("parallly:open-copilot", handler);
    return () => window.removeEventListener("parallly:open-copilot", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AI Chat state
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    {
      role: 'assistant',
      content: t("chat.welcome")
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
          userName: user?.firstName || t("chat.defaultUserName"),
          userRole: user?.role || 'agent',
          locale
        },
        history: chatHistory
      });
      
      if (response && response.success && response.data?.reply) {
        const replyContent = response.data.reply;
        setMessages(prev => [...prev, { role: 'assistant', content: replyContent }]);
      } else {
        const errorMsg = response?.error || t("chat.invalidResponse");
        setMessages(prev => [...prev, { role: 'assistant', content: errorMsg }]);
      }
    } catch (error) {
      console.error('Error calling copilotChat API:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: t("chat.connectionError")
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
      code1: `Cómo leer tu tasa de contención:
- Mide el % de conversaciones que la IA resolvió
  sola, sin pasar a una persona de tu equipo.
- Ejemplo: de 200 conversaciones del mes, la IA
  resolvió 160 → 80% de contención.
- Una tasa saludable supera el 70%.
- Si baja, refuerza tu Base de Conocimiento y
  revisa en el Inbox qué preguntas se derivaron.`,
      sub2Title: t("overview.sub2Title"),
      sub2Desc: t("overview.sub2Desc"),
      code2: `Rutas más usadas del menú lateral:
- Inbox: responde chats y revisa derivaciones.
- CRM: perfiles, notas y puntaje de tus leads.
- Embudo de ventas: oportunidades por etapa.
- Citas: agenda, disponibilidad y calendarios.
- Agente IA: personalidad y objetivos del bot.
- Configuración → Facturación: plan y consumos.`
    },
    {
      id: "inbox",
      icon: MessageSquare,
      title: t("inbox.title"),
      description: t("inbox.description"),
      sub1Title: t("inbox.sub1Title"),
      sub1Desc: t("inbox.sub1Desc"),
      code1: `Cómo evitar respuestas duplicadas:
- Junto a cada conversación verás quién del
  equipo la está viendo o escribiendo.
- Si un compañero ya atiende el chat, coordina
  antes de intervenir.
- Tu estado (disponible / ausente) controla si
  el sistema te asigna nuevas conversaciones.`,
      sub2Title: t("inbox.sub2Title"),
      sub2Desc: t("inbox.sub2Desc"),
      code2: `Asignar una conversación a una persona:
1. Abre la conversación en el Inbox.
2. Usa el botón de asignar y elige al miembro
   del equipo indicado.
3. La persona asignada recibe una notificación
   al instante.

La IA también deriva sola cuando el cliente
pide hablar con un humano o se frustra.`
    },
    {
      id: "contacts",
      icon: Users,
      title: t("contacts.title"),
      description: t("contacts.description"),
      sub1Title: t("contacts.sub1Title"),
      sub1Desc: t("contacts.sub1Desc"),
      code1: `Cómo funciona el puntaje (1 a 10):
- Sube con la actividad del lead: mensajes,
  respuestas, etiquetas y etapa del embudo.
- Puntaje alto (8-10) = lead caliente:
  priorízalo en tu seguimiento comercial.
- Toca el puntaje en la ficha del lead para
  ver el desglose de factores.
- Ajusta las ponderaciones en
  Configuración → Scoring de leads.`,
      sub2Title: t("contacts.sub2Title"),
      sub2Desc: t("contacts.sub2Desc"),
      code2: `Crear campos propios para tus leads:
1. Ve a Configuración → Atributos
   Personalizados.
2. Crea el campo con su tipo (texto, número,
   lista, fecha…). Ejemplos: "Presupuesto",
   "Ciudad", "Modalidad preferida".
3. Los campos aparecen en la ficha de cada
   lead y la IA puede completarlos durante
   la conversación.`
    },
    {
      id: "pipeline",
      icon: TrendingUp,
      title: t("pipeline.title"),
      description: t("pipeline.description"),
      sub1Title: t("pipeline.sub1Title"),
      sub1Desc: t("pipeline.sub1Desc"),
      code1: `Etapas del embudo (de inicio a cierre):
1. Nuevo            — acaba de llegar
2. Contactado       — ya hubo primer contacto
3. Calificado       — cumple el perfil
4. Caliente         — muestra intención real
5. Listo para Cierre — negociación final
6. Ganado           — venta concretada

Personaliza nombres, colores y etapas en
Configuración → Embudo de ventas.`,
      sub2Title: t("pipeline.sub2Title"),
      sub2Desc: t("pipeline.sub2Desc"),
      code2: `Avance automático y aprobaciones:
- Activa el avance automático desde el
  encabezado del embudo: la plataforma mueve
  el lead de etapa según las señales de la
  conversación (interés, datos entregados…).
- Los supervisores pueden exigir aprobación
  antes de mover una oportunidad a las etapas
  finales, y aprobar o rechazar con motivo.`
    },
    {
      id: "broadcast",
      icon: Megaphone,
      title: t("broadcast.title"),
      description: t("broadcast.description"),
      sub1Title: t("broadcast.sub1Title"),
      sub1Desc: t("broadcast.sub1Desc"),
      code1: `Enviar una campaña paso a paso:
1. Ve a Campañas y crea una nueva.
2. Elige el canal y la plantilla aprobada por
   Meta (créalas en Canales → WhatsApp →
   Plantillas; la aprobación puede tardar).
3. Selecciona el segmento de contactos.
4. Completa las variables de la plantilla,
   por ejemplo {{1}} = nombre del cliente.
5. Envía ahora o programa fecha y hora.`,
      sub2Title: t("broadcast.sub2Title"),
      sub2Desc: t("broadcast.sub2Desc"),
      code2: `Cómo leer los resultados de la campaña:
Enviado → Entregado → Leído → Respondido

- Entregado bajo: depura números inválidos o
  contactos que ya no usan ese canal.
- Leído bajo: prueba otro horario de envío.
- Respondido bajo: mejora el llamado a la
  acción del mensaje.`
    },
    {
      id: "agent",
      icon: Bot,
      title: t("agent.title"),
      description: t("agent.description"),
      sub1Title: t("agent.sub1Title"),
      sub1Desc: t("agent.sub1Desc"),
      code1: `Qué escribir en las instrucciones del agente:
- Quién es: nombre, rol y negocio que
  representa.
- Tono: cercano, formal, enérgico…
- Objetivo: vender, agendar citas, resolver
  dudas frecuentes.
- Límites: qué NO debe prometer ni responder.

Ejemplo: "Eres Laura, asesora de [tu negocio].
Atiendes con calidez, resuelves dudas de
precios y guías al cliente a agendar una cita."`,
      sub2Title: t("agent.sub2Title"),
      sub2Desc: t("agent.sub2Desc"),
      code2: `Configurar la derivación a humanos:
1. En el editor del agente define las palabras
   que fuerzan el paso a una persona, por
   ejemplo: "humano", "asesor", "hablar con
   alguien".
2. Define cuántas respuestas repetidas tolera
   el bot antes de derivar (recomendado: 3).
3. Las conversaciones derivadas llegan al
   Inbox con un resumen de lo conversado.`
    },
    {
      id: "channels",
      icon: LinkIcon,
      title: t("channels.title"),
      description: t("channels.description"),
      sub1Title: t("channels.sub1Title"),
      sub1Desc: t("channels.sub1Desc"),
      code1: `Conectar tu número de WhatsApp:
1. Ve a Canales → WhatsApp.
2. Pulsa "Conectar" e inicia sesión con la
   cuenta de Facebook de tu empresa.
3. Sigue el asistente de Meta: elige o crea tu
   cuenta de WhatsApp Business y verifica el
   número por SMS o llamada.
4. Al terminar, asigna un agente IA a esa
   conexión desde la sección Agente IA.`,
      sub2Title: t("channels.sub2Title"),
      sub2Desc: t("channels.sub2Desc"),
      code2: `Otros canales disponibles:
- Instagram y Messenger: se conectan con tu
  cuenta Business de Meta en un par de clics;
  el acceso se renueva automáticamente.
- Telegram, Email y chat web para tu sitio:
  también en Canales, según tu plan.

Recuerda: cada conexión tiene su propio agente
IA, y tu plan define cuántas conexiones del
mismo tipo puedes tener (por ejemplo, dos
números de WhatsApp en el plan Pro).`
    },
    {
      id: "users",
      icon: Users,
      title: t("users.title"),
      description: t("users.description"),
      sub1Title: t("users.sub1Title"),
      sub1Desc: t("users.sub1Desc"),
      code1: `Roles disponibles para tu equipo:
- Administrador: configura la plataforma y
  gestiona facturación, usuarios y canales.
- Supervisor: supervisa conversaciones, CRM
  y reportes; aprueba avances del embudo.
- Agente: atiende los chats que tiene
  asignados en el Inbox.

Invita miembros desde Usuarios; el número de
usuarios disponible depende de tu plan.`,
      sub2Title: t("users.sub2Title"),
      sub2Desc: t("users.sub2Desc"),
      code2: `Dirigir cada chat al especialista correcto:
1. En Usuarios, edita al miembro del equipo.
2. Agrega sus etiquetas de especialidad, por
   ejemplo: "ventas", "soporte", "facturación".
3. Cuando una conversación de ese tema pase a
   humanos, se asignará primero a quien tenga
   esa habilidad y cupo disponible.`
    },
    {
      id: "billing",
      icon: CreditCard,
      title: t("billing.title"),
      description: t("billing.description"),
      sub1Title: t("billing.sub1Title"),
      sub1Desc: t("billing.sub1Desc"),
      code1: `Planes (precio en USD por mes):
- Emprendedor  $21  — 1 agente IA,
  1 calendario, 1.000 respuestas IA/mes.
- Starter      $49  — 1 agente IA,
  1 calendario, 5.000 respuestas IA/mes.
- Pro          $129 — 3 agentes IA,
  3 calendarios, 25.000 respuestas IA/mes.
- Enterprise   $349 — 10 agentes IA,
  10 calendarios, 100.000 respuestas IA/mes.
- Custom — a cotizar, límites a tu medida.

Ciclo mensual o anual (~15% de descuento
si pagas el año completo).`,
      sub2Title: t("billing.sub2Title"),
      sub2Desc: t("billing.sub2Desc"),
      code2: `Revisar consumo y cambiar de plan:
1. Ve a Configuración → Facturación.
2. Revisa tus contadores del mes: respuestas
   de IA, audios/imágenes procesados y
   almacenamiento.
3. Al acercarte a un límite verás avisos en
   el panel; puedes subir de plan ahí mismo.
4. Desde esa página también actualizas tu
   método de pago y ves tu historial.`
    },
    {
      id: "apiKeys",
      icon: Shield,
      title: t("apiKeys.title"),
      description: t("apiKeys.description"),
      sub1Title: t("apiKeys.sub1Title"),
      sub1Desc: t("apiKeys.sub1Desc"),
      code1: `Crear una clave de API:
1. Ve a Configuración → Claves de API.
2. Pulsa "Crear clave" y asígnale un nombre
   que identifique su uso (ej. "Reportes BI").
3. Copia la clave y guárdala en un lugar
   seguro: por seguridad solo se muestra
   una vez.
4. Revoca cualquier clave que ya no uses.

Disponible desde el plan Pro; la cantidad de
claves depende de tu plan.`,
      sub2Title: t("apiKeys.sub2Title"),
      sub2Desc: t("apiKeys.sub2Desc"),
      code2: `Avisar a tus otras herramientas (webhooks):
1. Ve a Configuración → Integraciones →
   Webhooks.
2. Crea una suscripción: elige el evento
   (ej. lead creado, cita agendada) y pega
   la dirección que te entrega tu otra
   herramienta (CRM, hoja de cálculo, etc.).
3. Cada vez que ocurra el evento, Parallly
   le avisará a esa herramienta al instante.

La disponibilidad depende de tu plan.`
    },
    {
      id: "smtp",
      icon: Mail,
      title: t("smtp.title"),
      description: t("smtp.description"),
      sub1Title: t("smtp.sub1Title"),
      sub1Desc: t("smtp.sub1Desc"),
      code1: `Para que tus correos no caigan en spam:
1. Pide a tu proveedor de correo (o a quien
   administre tu dominio) activar SPF y DKIM
   para el remitente que usas en Parallly.
2. Usa un remitente con tu dominio propio
   (ej. hola@tunegocio.com), no direcciones
   gratuitas.
3. Envíate un correo de prueba y verifica
   que llegue a la bandeja principal.`,
      sub2Title: t("smtp.sub2Title"),
      sub2Desc: t("smtp.sub2Desc"),
      code2: `Ejemplo de plantilla con variables:

Hola {{customer_name}},

Confirmamos tu cita de {{service_name}}
el día {{appointment_date}}.

Gracias por confiar en {{business_name}}.

Edita tus plantillas en Configuración →
Plantillas de Email; las variables se
reemplazan solas con los datos de cada
cliente al enviar.`
    },
    {
      id: "automation",
      icon: Sliders,
      title: t("automation.title"),
      description: t("automation.description"),
      sub1Title: t("automation.sub1Title"),
      sub1Desc: t("automation.sub1Desc"),
      code1: `Ejemplo de regla en 3 pasos:
- Disparador: llega un mensaje nuevo.
- Condiciones: el lead escribió por Instagram
  y tiene un puntaje alto.
- Acciones: asignarlo a un asesor y enviarle
  un correo de seguimiento 2 horas después.

Crea la tuya en Automatización → Nueva regla,
con el asistente guiado de 4 pasos.`,
      sub2Title: t("automation.sub2Title"),
      sub2Desc: t("automation.sub2Desc"),
      code2: `Receta de seguimiento por inactividad:
1. Espera: 4 horas sin respuesta del cliente.
2. Filtro: el lead sigue en etapa "Tibio".
3. Acción: enviar "Hola, ¿pudiste revisar la
   información que te compartí?"

Consejo: uno o dos recordatorios bastan;
más pueden sentirse invasivos.`
    },
    {
      id: "knowledge",
      icon: Database,
      title: t("knowledge.title"),
      description: t("knowledge.description"),
      sub1Title: t("knowledge.sub1Title"),
      sub1Desc: t("knowledge.sub1Desc"),
      code1: `Ajustar la precisión de las respuestas:
1. Ve a Agente IA → tu agente → sección de
   Conocimiento.
2. Mueve el control de similitud (recomendado
   0.75): más alto = solo responde con textos
   casi exactos; más bajo = más cobertura.
3. Si el agente dice "no lo sé" muy seguido,
   baja un poco el valor o agrega más
   artículos a tu Base de Conocimiento.`,
      sub2Title: t("knowledge.sub2Title"),
      sub2Desc: t("knowledge.sub2Desc"),
      code2: `Ejemplo de cita en una respuesta del agente:
"De acuerdo con nuestra política de
cancelación [Política: cancelación], puedes
cancelar sin cargo hasta 24 horas antes del
servicio."

Mientras más completa esté tu Base de
Conocimiento (políticas, precios, FAQs),
más precisas y confiables serán las citas.`
    },
    {
      id: "alerts",
      icon: Bell,
      title: t("alerts.title"),
      description: t("alerts.description"),
      sub1Title: t("alerts.sub1Title"),
      sub1Desc: t("alerts.sub1Desc"),
      code1: `Qué vigila el sistema por ti:
- Subidas o caídas bruscas del volumen de
  conversaciones en un canal.
- Aumentos inusuales de errores de envío.
- Comportamientos fuera de lo normal frente
  a tus semanas anteriores.

Cuando algo se desvía de tu patrón habitual,
recibes una alerta automática: no necesitas
configurar fórmulas ni umbrales.`,
      sub2Title: t("alerts.sub2Title"),
      sub2Desc: t("alerts.sub2Desc"),
      code2: `Recibir las alertas donde trabaja tu equipo:
1. Ve a Configuración → Integraciones →
   Slack y conecta tu espacio de trabajo.
2. Elige el canal donde quieres recibir
   los avisos.
3. Ajusta qué notificaciones recibes en
   Configuración → Alertas y en
   Configuración → Notificaciones.`
    },
    {
      id: "appointments",
      icon: Calendar,
      title: t("appointments.title"),
      description: t("appointments.description"),
      sub1Title: t("appointments.sub1Title"),
      sub1Desc: t("appointments.sub1Desc"),
      code1: `Citas virtuales con enlace automático:
1. Ve a Citas → Configuración y conecta tu
   Google Calendar.
2. En cada servicio define la modalidad:
   presencial, virtual o híbrida.
3. Para servicios virtuales, el enlace de
   reunión (Google Meet o Teams) se genera
   solo y se incluye en la confirmación que
   recibe el cliente.`,
      sub2Title: t("appointments.sub2Title"),
      sub2Desc: t("appointments.sub2Desc"),
      code2: `Bloquear días sin atención:
1. Ve a Citas → Disponibilidad.
2. Agrega tus fechas bloqueadas: feriados,
   vacaciones o cierres puntuales.
   Ej.: 25 de diciembre, 1 de enero.
3. Define también tus días y horarios no
   laborables (ej. domingos): el agente IA
   nunca ofrecerá esos espacios al agendar.`
    }
  ];

  // Define general FAQs for searching
  const generalFaqs = [
    {
      question: t("faqs.aiHowItWorks.question"),
      answer: t("faqs.aiHowItWorks.answer"),
      category: t("faqs.aiHowItWorks.category")
    },
    {
      question: t("faqs.calendarSync.question"),
      answer: t("faqs.calendarSync.answer"),
      category: t("faqs.calendarSync.category")
    },
    {
      question: t("faqs.businessHours.question"),
      answer: t("faqs.businessHours.answer"),
      category: t("faqs.businessHours.category")
    },
    {
      question: t("faqs.leadScore.question"),
      answer: t("faqs.leadScore.answer"),
      category: t("faqs.leadScore.category")
    }
  ];

  // Dynamic industry-tailored prompt suggestions based on useVerticalTerms
  const getIndustryAdvice = () => {
    const ind = vt.industry?.toLowerCase();
    switch (ind) {
      case "vacation_rentals":
      case "properties":
        return {
          prompt: t("industryAdvice.hospitality.prompt"),
          example: t("industryAdvice.hospitality.example")
        };
      case "gyms":
      case "fitness":
        return {
          prompt: t("industryAdvice.fitness.prompt"),
          example: t("industryAdvice.fitness.example")
        };
      case "restaurants":
      case "food":
        return {
          prompt: t("industryAdvice.restaurants.prompt"),
          example: t("industryAdvice.restaurants.example")
        };
      default:
        return {
          prompt: t("industryAdvice.default.prompt"),
          example: t("industryAdvice.default.example")
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
    t("chat.suggestions.connectWhatsApp"),
    t("chat.suggestions.leadScoring"),
    t("chat.suggestions.configureRag"),
    t("chat.suggestions.syncCalendar")
  ];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          onClick={() => setOpen(true)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          aria-label={t("launcherTooltip")}
          className="fixed bottom-4 right-6 z-40 flex items-end justify-center hover:scale-105 active:scale-95 transition-transform duration-300 group cursor-pointer drop-shadow-[0_6px_18px_rgba(56,151,240,0.35)]"
        >
          {/* Globo de bienvenida (una sola vez) + tooltip al pasar el mouse */}
          <span
            className={`absolute bottom-full right-0 mb-1 bg-neutral-950 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[11px] font-semibold px-3 py-2 rounded-xl shadow-xl whitespace-nowrap border border-white/10 transition-all duration-300 ${
              greeting ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none"
            }`}
          >
            {t("greetingBubble")}
          </span>
          <span className="absolute bottom-full right-0 mb-1 scale-0 group-hover:scale-100 origin-bottom-right transition-transform duration-200 bg-neutral-950 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[11px] font-medium px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap border border-white/10">
            {t("launcherTooltip")}
          </span>
          <ParalllyAssistant
            size={64}
            state={greeting ? "wave" : hovered ? "hover" : "idle"}
            label={t("launcherTooltip")}
          />
        </button>
      </SheetTrigger>
      
      <SheetContent className="w-full sm:max-w-md bg-white/80 dark:bg-neutral-950/80 backdrop-blur-xl border-l border-neutral-200/50 dark:border-neutral-800/50 shadow-2xl flex flex-col p-0 overflow-hidden">
        {/* Header section with Glassmorphic Gradient */}
        <div className="p-6 pb-4 border-b border-neutral-200/50 dark:border-neutral-800/50 bg-linear-to-b from-indigo-50/30 to-white/0 dark:from-indigo-950/10 dark:to-transparent">
          <SheetHeader className="p-0 gap-1 select-none">
            <div className="flex items-center gap-2 text-[#3897f0]">
              {/* El mismo personaje del launcher: continuidad visual */}
              <ParalllyAssistant size={34} state={isSending ? "think" : "idle"} />
              <span className="text-xs font-bold uppercase tracking-wider bg-[#3897f0]/10 text-[#2b7cd4] dark:text-[#7ab9f5] px-2 py-0.5 rounded-md">
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
              {t("tabs.guides")}
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
              {t("tabs.chat")}
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
                    {t("industryTitle", { industry: vt.industry === "otro" ? t("industryGeneral") : vt.industry })}
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
                        <Code className="size-3" /> {t("industryAdvice.systemPromptLabel")}
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
                        <Terminal className="size-3" /> {t("industryAdvice.examplesLabel")}
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
                  {searchQuery ? t("searchResults", { count: filteredGuides.length + filteredFaqs.length }) : t("faqTitle")}
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
                <div className="self-start max-w-[85%] flex items-center gap-1.5 bg-white dark:bg-neutral-900 border border-neutral-200/50 dark:border-neutral-800/50 text-neutral-400 dark:text-neutral-500 rounded-2xl rounded-tl-none pl-2 pr-4 py-1.5 shadow-2xs text-xs select-none">
                  {/* Parallly "pensando": sus checks laten */}
                  <ParalllyAssistant size={30} state="think" />
                  <span className="text-[10px] text-neutral-400 dark:text-neutral-500 animate-pulse">
                    {t("chat.typing")}
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
                  placeholder={t("chat.inputPlaceholder")}
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
          <button
            type="button"
            onClick={() => {
              try { window.dispatchEvent(new Event("parallly:start-tour")); } catch { /* noop */ }
              setOpen(false);
            }}
            className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Compass className="size-2.5" /> {t("footer.restartTour")}
          </button>
          <a
            href="https://parallly-chat.cloud/support"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
          >
            {t("footer.support")} <ChevronRight className="size-2.5" />
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
