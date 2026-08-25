import {
  resolvePublicVerticalProductPolicy,
  type VerticalCertificationState,
  type VerticalProductMode,
} from "../../../../packages/shared/src/vertical-product-policy";
import type { VerticalCertificationReasonCode } from "../../../../packages/shared/src/vertical-certification-contract";

export type VerticalTier = 1 | 2 | 3;
export type { VerticalProductMode };

export type VerticalCluster =
  | "salud-bienestar"
  | "comercio-servicios"
  | "profesional-finanzas"
  | "lifestyle-creativos";

export interface VerticalDef {
  slug: string;
  emoji: string;
  color: string;
  glow: string;
  tier: VerticalTier;
  cluster: VerticalCluster;
  channel: "whatsapp" | "instagram" | "messenger" | "telegram";
  demoMode: "illustrative";
  productMode: VerticalProductMode;
  certificationState: VerticalCertificationState;
  certificationReasons: readonly VerticalCertificationReasonCode[];
  deepMarketingAllowed: boolean;
  demoMessages: { from: "customer" | "ai"; text: string }[];
}

export const VERTICALS: VerticalDef[] = ([
  // ── Tier 1 (8): Full industry pages with pipeline demos ──
  {
    slug: "salud",
    emoji: "🩺",
    color: "#00d68f",
    glow: "0 0 40px rgba(0,214,143,0.3)",
    tier: 1,
    cluster: "salud-bienestar",
    channel: "whatsapp",
    demoMessages: [
      { from: "customer", text: "Hola, necesito una cita con el dentista" },
      { from: "ai", text: "¡Hola! Soy Sofía, asistente de la clínica. Tenemos disponibilidad mañana jueves a las 9am y 3pm. ¿Cuál te queda mejor?" },
      { from: "customer", text: "Jueves 9am porfa" },
      { from: "ai", text: "Perfecto ✅ Tu cita queda confirmada para jueves 9:00 AM. Te enviaré un recordatorio el miércoles. ¿Necesitas algo más?" },
    ],
  },
  {
    slug: "restaurantes",
    emoji: "🍽️",
    color: "#ff6b35",
    glow: "0 0 40px rgba(255,107,53,0.3)",
    tier: 1,
    cluster: "comercio-servicios",
    channel: "whatsapp",
    demoMessages: [
      { from: "customer", text: "Quiero pedir para domicilio" },
      { from: "ai", text: "¡Hola! Soy Luca 🍽️ Te paso el menú del día. ¿Quieres ver el menú completo o las promociones?" },
      { from: "customer", text: "Las promociones" },
      { from: "ai", text: "🔥 Hoy: 2x1 en hamburguesas + bebida gratis en pedidos +$35k. ¿Te anoto algo?" },
    ],
  },
  {
    slug: "inmobiliaria",
    emoji: "🏠",
    color: "#3b82f6",
    glow: "0 0 40px rgba(59,130,246,0.3)",
    tier: 1,
    cluster: "comercio-servicios",
    channel: "whatsapp",
    demoMessages: [
      { from: "customer", text: "Hola, busco apto en arriendo en Chapinero" },
      { from: "ai", text: "¡Hola! Soy Carlos, tu asesor inmobiliario. Puedo filtrar las propiedades publicadas. ¿Cuál es tu presupuesto mensual?" },
      { from: "customer", text: "Entre 2 y 3 millones" },
      { from: "ai", text: "Perfecto. Buscaré coincidencias en el inventario del negocio y te compartiré las fichas disponibles. ¿Quieres que revisemos horarios de visita?" },
    ],
  },
  {
    slug: "belleza",
    emoji: "💇‍♀️",
    color: "#e91e90",
    glow: "0 0 40px rgba(233,30,144,0.3)",
    tier: 1,
    cluster: "salud-bienestar",
    channel: "instagram",
    demoMessages: [
      { from: "customer", text: "Hola! Vi tu trabajo, quiero mechas balayage" },
      { from: "ai", text: "¡Hola! Soy Luna 💇‍♀️ Gracias por escribirnos. Mechas balayage desde $180k. ¿Para cuándo te gustaría?" },
      { from: "customer", text: "Este sábado si hay" },
      { from: "ai", text: "Sábado tenemos 10am y 2pm con Camila (especialista en color). ¿Cuál prefieres?" },
    ],
  },
  {
    slug: "gimnasios",
    emoji: "💪",
    color: "#f97316",
    glow: "0 0 40px rgba(249,115,22,0.3)",
    tier: 1,
    cluster: "salud-bienestar",
    channel: "messenger",
    demoMessages: [
      { from: "customer", text: "Hola, info sobre membresías" },
      { from: "ai", text: "¡Hola! Soy Coach 💪 Tenemos mensual $89k, trimestral $240k (ahorras $27k). ¿Te agendo una visita?" },
      { from: "customer", text: "Sí, mañana puedo" },
      { from: "ai", text: "Te agendo mañana a las 10am para tour + clase de prueba gratis ✅" },
    ],
  },
  {
    slug: "turismo",
    emoji: "✈️",
    color: "#06b6d4",
    glow: "0 0 40px rgba(6,182,212,0.3)",
    tier: 1,
    cluster: "comercio-servicios",
    channel: "whatsapp",
    demoMessages: [
      { from: "customer", text: "Hola, buscamos paquete a Cartagena 4 noches" },
      { from: "ai", text: "¡Hola! Soy Maya ✈️ Tengo 3 opciones. ¿Cuántas personas y fechas?" },
      { from: "customer", text: "2 adultos, del 15 al 19 de julio" },
      { from: "ai", text: "Disponible 🙌 Hotel Caribe: $2.4M pp todo incluido. Hotel Playa: $1.8M pp con desayuno. ¿Te interesa alguno?" },
    ],
  },
  {
    slug: "educacion",
    emoji: "📚",
    color: "#8b5cf6",
    glow: "0 0 40px rgba(139,92,246,0.3)",
    tier: 1,
    cluster: "profesional-finanzas",
    channel: "whatsapp",
    demoMessages: [
      { from: "customer", text: "Quiero info sobre cursos de inglés" },
      { from: "ai", text: "¡Hola! Soy Ana 📚 Tenemos cursos A1-C2, presencial y virtual. ¿Sabes tu nivel actual?" },
      { from: "customer", text: "No, nunca hice prueba" },
      { from: "ai", text: "Te hago un mini diagnóstico acá mismo (5 preguntas). ¿Empezamos? Primera: How would you describe your daily routine?" },
    ],
  },
  {
    slug: "seguros",
    emoji: "🛡️",
    color: "#0ea5e9",
    glow: "0 0 40px rgba(14,165,233,0.3)",
    tier: 1,
    cluster: "profesional-finanzas",
    channel: "whatsapp",
    demoMessages: [
      { from: "customer", text: "Necesito cotización de seguro auto" },
      { from: "ai", text: "¡Hola! Soy Roberto 🛡️ Con gusto te cotizo. ¿Marca, modelo y año del vehículo?" },
      { from: "customer", text: "Mazda CX-5 2023" },
      { from: "ai", text: "Con esos datos puedo consultar las opciones y coberturas cargadas por la agencia. La cotización final la confirma un asesor autorizado. ¿Continuamos?" },
    ],
  },

  // ── Tier 2 (5): Good industry pages ──
  {
    slug: "veterinaria",
    emoji: "🐾",
    color: "#22c55e",
    glow: "0 0 40px rgba(34,197,94,0.3)",
    tier: 2,
    cluster: "salud-bienestar",
    channel: "whatsapp",
    demoMessages: [
      { from: "customer", text: "Mi perrito necesita vacunas" },
      { from: "ai", text: "¡Hola! Soy Toby 🐾 ¿Qué raza y edad tiene? Así verifico el esquema de vacunación." },
      { from: "customer", text: "Golden Retriever, 3 meses" },
      { from: "ai", text: "Gracias. El esquema debe validarlo el equipo veterinario según su historia clínica. Puedo ayudarte a solicitar una cita. ¿Quieres ver horarios?" },
    ],
  },
  {
    slug: "fotografia",
    emoji: "📸",
    color: "#ec4899",
    glow: "0 0 40px rgba(236,72,153,0.3)",
    tier: 2,
    cluster: "lifestyle-creativos",
    channel: "instagram",
    demoMessages: [
      { from: "customer", text: "Vi tu trabajo, cuánto vale una sesión de boda?" },
      { from: "ai", text: "¡Gracias! Soy Diego 📸 Tenemos 3 paquetes: Gold $3.5M, Premium $5.2M, Luxury $8M. ¿Cuándo es la fecha?" },
      { from: "customer", text: "15 de junio" },
      { from: "ai", text: "Disponible 🙌 Te paso el portafolio y detalles por aquí." },
    ],
  },
  {
    slug: "automotriz",
    emoji: "🚗",
    color: "#ef4444",
    glow: "0 0 40px rgba(239,68,68,0.3)",
    tier: 2,
    cluster: "comercio-servicios",
    channel: "whatsapp",
    demoMessages: [
      { from: "customer", text: "Hola, necesito revisión de frenos" },
      { from: "ai", text: "¡Hola! Soy Mech 🚗 Puedo registrar la solicitud y consultar los servicios configurados. ¿Qué vehículo tienes?" },
      { from: "customer", text: "Renault Sandero 2021" },
      { from: "ai", text: "Gracias. Puedo consultar los horarios disponibles para una revisión. ¿Qué día prefieres?" },
    ],
  },
  {
    slug: "hogar",
    emoji: "🔧",
    color: "#f59e0b",
    glow: "0 0 40px rgba(245,158,11,0.3)",
    tier: 2,
    cluster: "comercio-servicios",
    channel: "telegram",
    demoMessages: [
      { from: "customer", text: "Se me tapó el desagüe, urgente" },
      { from: "ai", text: "Entendido 🚨 Soy Iván. ¿Dirección para enviar técnico?" },
      { from: "customer", text: "Calle 50 #15-20" },
      { from: "ai", text: "Gracias. Registraré la urgencia y consultaré disponibilidad y tarifa con el equipo técnico antes de confirmar la visita. ¿Te parece?" },
    ],
  },
  {
    slug: "finanzas",
    emoji: "💰",
    color: "#14b8a6",
    glow: "0 0 40px rgba(20,184,166,0.3)",
    tier: 2,
    cluster: "profesional-finanzas",
    channel: "whatsapp",
    demoMessages: [
      { from: "customer", text: "Hola, necesito asesoría para invertir" },
      { from: "ai", text: "¡Hola! Soy Alex 💰 ¿Cuál es tu perfil: conservador, moderado o agresivo? ¿Y monto aproximado?" },
      { from: "customer", text: "Moderado, unos 20 millones" },
      { from: "ai", text: "Puedo recopilar tus objetivos y coordinar una conversación con un asesor autorizado. Las recomendaciones las confirma el asesor. ¿Quieres agendar?" },
    ],
  },

  // ── Tier 3 (5): Generic/template pages ──
  {
    slug: "servicios-profesionales",
    emoji: "⚖️",
    color: "#6366f1",
    glow: "0 0 40px rgba(99,102,241,0.3)",
    tier: 3,
    cluster: "profesional-finanzas",
    channel: "whatsapp",
    demoMessages: [
      { from: "customer", text: "Necesito asesoría legal para mi empresa" },
      { from: "ai", text: "¡Hola! ¿En qué área necesitas apoyo: laboral, societario, tributario?" },
      { from: "customer", text: "Tributario" },
      { from: "ai", text: "Tengo disponibilidad para una consulta esta semana. ¿Te agendo?" },
    ],
  },
  {
    slug: "tecnologia",
    emoji: "💻",
    color: "#a855f7",
    glow: "0 0 40px rgba(168,85,247,0.3)",
    tier: 3,
    cluster: "profesional-finanzas",
    channel: "whatsapp",
    demoMessages: [
      { from: "customer", text: "Hola, necesito soporte con mi software" },
      { from: "ai", text: "¡Hola! ¿Es un problema técnico o quieres info sobre planes y servicios?" },
      { from: "customer", text: "Problema técnico, no puedo iniciar sesión" },
      { from: "ai", text: "Entendido. Puedo recopilar los datos para que el equipo de soporte continúe el caso. ¿Qué correo está asociado a tu cuenta?" },
    ],
  },
  {
    slug: "retail",
    emoji: "🛍️",
    color: "#f43f5e",
    glow: "0 0 40px rgba(244,63,94,0.3)",
    tier: 3,
    cluster: "lifestyle-creativos",
    channel: "instagram",
    demoMessages: [
      { from: "customer", text: "Hola, tienen la camiseta en talla M?" },
      { from: "ai", text: "¡Hola! Sí, tenemos en M y L. ¿Te interesa algún color en particular?" },
      { from: "customer", text: "Negra" },
      { from: "ai", text: "Disponible ✅ $65k con envío gratis. ¿Te la separo?" },
    ],
  },
  {
    slug: "pet-services",
    emoji: "🐶",
    color: "#fb923c",
    glow: "0 0 40px rgba(251,146,60,0.3)",
    tier: 3,
    cluster: "salud-bienestar",
    channel: "whatsapp",
    demoMessages: [
      { from: "customer", text: "Hola, necesito guardería para mi perro" },
      { from: "ai", text: "¡Hola! ¿Para qué fechas y qué raza es tu peludo?" },
      { from: "customer", text: "Del viernes al domingo, es un Beagle" },
      { from: "ai", text: "Perfecto. Consultaré disponibilidad, condiciones y tarifa configuradas por la guardería antes de confirmar. ¿Tu perro necesita cuidados especiales?" },
    ],
  },
  {
    slug: "otro",
    emoji: "🏢",
    color: "#64748b",
    glow: "0 0 40px rgba(100,116,139,0.3)",
    tier: 3,
    cluster: "lifestyle-creativos",
    channel: "whatsapp",
    demoMessages: [
      { from: "customer", text: "Hola, necesito información sobre sus servicios" },
      { from: "ai", text: "¡Hola! Con gusto te ayudo. ¿Qué servicio te interesa?" },
      { from: "customer", text: "Quiero cotizar" },
      { from: "ai", text: "Perfecto. Te paso las opciones disponibles. ¿Prefieres que te agende una llamada?" },
    ],
  },
] satisfies Omit<VerticalDef, "demoMode" | "productMode" | "certificationState" | "certificationReasons" | "deepMarketingAllowed">[]).map((vertical) => ({
  ...vertical,
  demoMode: "illustrative" as const,
  productMode: resolvePublicVerticalProductPolicy(vertical.slug).mode,
  certificationState: resolvePublicVerticalProductPolicy(vertical.slug).certificationState,
  certificationReasons: resolvePublicVerticalProductPolicy(vertical.slug).certificationReasons,
  deepMarketingAllowed: resolvePublicVerticalProductPolicy(vertical.slug).deepMarketingAllowed,
}));

export const CLUSTER_LABELS: Record<VerticalCluster, string> = {
  "salud-bienestar": "clusterHealth",
  "comercio-servicios": "clusterCommerce",
  "profesional-finanzas": "clusterProfessional",
  "lifestyle-creativos": "clusterLifestyle",
};

export function getVerticalBySlug(slug: string): VerticalDef | undefined {
  return VERTICALS.find((v) => v.slug === slug);
}

export function getVerticalsByCluster(cluster: VerticalCluster): VerticalDef[] {
  return VERTICALS.filter((v) => v.cluster === cluster);
}

export function getVerticalsByTier(tier: VerticalTier): VerticalDef[] {
  return VERTICALS.filter((v) => v.tier === tier);
}
