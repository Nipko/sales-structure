import type { Metadata } from "next";
import { buildMetadata, type SupportedLocale } from "./seo";
import esMessages from "../../messages/es.json";
import enMessages from "../../messages/en.json";
import ptMessages from "../../messages/pt.json";
import frMessages from "../../messages/fr.json";

type Copy = Record<SupportedLocale, { title: string; description: string }>;

const PAGE_COPY: Record<string, Copy> = {
  "/": {
    es: { title: "Parallly — Convierte conversaciones en ventas, citas y tareas", description: "Conecta conversaciones, IA, CRM, agenda, automatizaciones y equipo en una sola plataforma." },
    en: { title: "Parallly — Turn conversations into sales, bookings and tasks", description: "Connect conversations, AI, CRM, scheduling, automations and your team in one platform." },
    pt: { title: "Parallly — Transforme conversas em vendas, reservas e tarefas", description: "Conecte conversas, IA, CRM, agenda, automações e sua equipe em uma única plataforma." },
    fr: { title: "Parallly — Transformez les conversations en ventes, rendez-vous et tâches", description: "Connectez conversations, IA, CRM, planning, automatisations et équipe sur une seule plateforme." },
  },
  "/precios": {
    es: { title: "Planes y precios", description: "Consulta precios, moneda, prueba, límites y funciones desde el catálogo activo de Parallly." },
    en: { title: "Plans and pricing", description: "See prices, currency, trial, limits and features from Parallly's active catalog." },
    pt: { title: "Planos e preços", description: "Consulte preços, moeda, teste, limites e recursos do catálogo ativo da Parallly." },
    fr: { title: "Forfaits et tarifs", description: "Consultez les prix, devises, essais, limites et fonctions du catalogue actif de Parallly." },
  },
  "/costos-whatsapp": {
    es: { title: "Costos de WhatsApp: quién cobra qué", description: "Distingue la suscripción a Parallly, los mensajes que Meta cobra a tu WABA y los pagos de tus clientes." },
    en: { title: "WhatsApp costs: who charges what", description: "Separate your Parallly subscription, messages Meta charges to your WABA and payments from your customers." },
    pt: { title: "Custos do WhatsApp: quem cobra o quê", description: "Separe a assinatura da Parallly, as mensagens cobradas pela Meta à sua WABA e os pagamentos dos clientes." },
    fr: { title: "Coûts WhatsApp : qui facture quoi", description: "Distinguez l'abonnement Parallly, les messages facturés par Meta à votre WABA et les paiements clients." },
  },
  "/comparar/meta-business-agent": {
    es: { title: "Parallly y el agente de negocios de Meta", description: "Comparación tarea por tarea con fuentes, fecha de consulta y límites comprobables." },
    en: { title: "Parallly and Meta Business Agent", description: "A task-by-task comparison with sources, review date and verifiable limits." },
    pt: { title: "Parallly e o agente de negócios da Meta", description: "Comparação tarefa por tarefa com fontes, data de revisão e limites verificáveis." },
    fr: { title: "Parallly et l'agent professionnel de Meta", description: "Comparaison tâche par tâche avec sources, date de révision et limites vérifiables." },
  },
  "/producto": {
    es: { title: "Producto", description: "Conoce cómo Parallly conecta canales, agentes de IA, CRM, agenda y equipo." },
    en: { title: "Product", description: "See how Parallly connects channels, AI agents, CRM, scheduling and your team." },
    pt: { title: "Produto", description: "Veja como a Parallly conecta canais, agentes de IA, CRM, agenda e equipe." },
    fr: { title: "Produit", description: "Découvrez comment Parallly relie canaux, agents IA, CRM, planning et équipe." },
  },
  "/producto/agente-ia": {
    es: { title: "Agentes de IA", description: "Configura agentes con conocimiento, catálogo, políticas, reservas y transferencia humana." },
    en: { title: "AI agents", description: "Configure agents with knowledge, catalog, policies, bookings and human handoff." },
    pt: { title: "Agentes de IA", description: "Configure agentes com conhecimento, catálogo, políticas, reservas e transferência humana." },
    fr: { title: "Agents IA", description: "Configurez des agents avec connaissances, catalogue, règles, rendez-vous et transfert humain." },
  },
  "/producto/canales": {
    es: { title: "Canales conectados", description: "Centraliza WhatsApp, Instagram, Messenger, Telegram y Web Chat según tu plan." },
    en: { title: "Connected channels", description: "Centralize WhatsApp, Instagram, Messenger, Telegram and Web Chat according to your plan." },
    pt: { title: "Canais conectados", description: "Centralize WhatsApp, Instagram, Messenger, Telegram e Web Chat conforme seu plano." },
    fr: { title: "Canaux connectés", description: "Centralisez WhatsApp, Instagram, Messenger, Telegram et Web Chat selon votre forfait." },
  },
  "/producto/reservas": {
    es: { title: "Reservas y agenda", description: "Gestiona disponibilidad, servicios, personal, recordatorios y calendarios desde conversaciones." },
    en: { title: "Bookings and scheduling", description: "Manage availability, services, staff, reminders and calendars from conversations." },
    pt: { title: "Reservas e agenda", description: "Gerencie disponibilidade, serviços, equipe, lembretes e calendários pelas conversas." },
    fr: { title: "Réservations et planning", description: "Gérez disponibilités, services, équipe, rappels et calendriers depuis les conversations." },
  },
  "/producto/crm": {
    es: { title: "CRM conversacional", description: "Convierte conversaciones en contactos, oportunidades, tareas y seguimiento comercial." },
    en: { title: "Conversational CRM", description: "Turn conversations into contacts, opportunities, tasks and sales follow-up." },
    pt: { title: "CRM conversacional", description: "Transforme conversas em contatos, oportunidades, tarefas e acompanhamento comercial." },
    fr: { title: "CRM conversationnel", description: "Transformez les conversations en contacts, opportunités, tâches et suivi commercial." },
  },
  "/producto/app-android": {
    es: { title: "App Android para agentes", description: "Opera conversaciones, copiloto y CRM desde Android en acceso anticipado." },
    en: { title: "Android app for agents", description: "Handle conversations, copilot and CRM from Android in early access." },
    pt: { title: "App Android para agentes", description: "Opere conversas, copiloto e CRM no Android em acesso antecipado." },
    fr: { title: "Application Android pour agents", description: "Gérez conversations, copilote et CRM sur Android en accès anticipé." },
  },
  "/soluciones": {
    es: { title: "Soluciones por industria", description: "Explora configuraciones para ventas, atención, CRM y reservas por tipo de negocio." },
    en: { title: "Solutions by industry", description: "Explore configurations for sales, service, CRM and bookings by business type." },
    pt: { title: "Soluções por setor", description: "Explore configurações de vendas, atendimento, CRM e reservas por tipo de negócio." },
    fr: { title: "Solutions par secteur", description: "Explorez les configurations de vente, service, CRM et réservation par activité." },
  },
  "/support": {
    es: { title: "Centro de soporte", description: "Contacta a soporte y consulta qué información incluir para recibir ayuda." },
    en: { title: "Support center", description: "Contact support and see what information to include when requesting help." },
    pt: { title: "Central de suporte", description: "Entre em contato com o suporte e veja quais informações incluir ao pedir ajuda." },
    fr: { title: "Centre d'assistance", description: "Contactez l'assistance et consultez les informations à fournir pour obtenir de l'aide." },
  },
  "/privacy": {
    es: { title: "Política de privacidad", description: "Cómo Parallly trata, protege y elimina datos personales." },
    en: { title: "Privacy policy", description: "How Parallly processes, protects and deletes personal data." },
    pt: { title: "Política de privacidade", description: "Como a Parallly trata, protege e exclui dados pessoais." },
    fr: { title: "Politique de confidentialité", description: "Comment Parallly traite, protège et supprime les données personnelles." },
  },
  "/terms": {
    es: { title: "Términos de servicio", description: "Condiciones aplicables al uso de Parallly." },
    en: { title: "Terms of service", description: "Terms that apply to the use of Parallly." },
    pt: { title: "Termos de serviço", description: "Condições aplicáveis ao uso da Parallly." },
    fr: { title: "Conditions d'utilisation", description: "Conditions applicables à l'utilisation de Parallly." },
  },
  "/data-policy": {
    es: { title: "Política de tratamiento de datos", description: "Reglas de tratamiento de datos personales en Parallly." },
    en: { title: "Data processing policy", description: "Rules for processing personal data in Parallly." },
    pt: { title: "Política de tratamento de dados", description: "Regras para o tratamento de dados pessoais na Parallly." },
    fr: { title: "Politique de traitement des données", description: "Règles de traitement des données personnelles chez Parallly." },
  },
  "/data-deletion": {
    es: { title: "Solicitar eliminación de datos", description: "Solicita y consulta la eliminación de tus datos en Parallly." },
    en: { title: "Request data deletion", description: "Request and track deletion of your data in Parallly." },
    pt: { title: "Solicitar exclusão de dados", description: "Solicite e acompanhe a exclusão dos seus dados na Parallly." },
    fr: { title: "Demander la suppression des données", description: "Demandez et suivez la suppression de vos données chez Parallly." },
  },
  "/data-deletion/status": {
    es: { title: "Estado de eliminación de datos", description: "Consulta el estado de tu solicitud de eliminación de datos." },
    en: { title: "Data deletion status", description: "Check the status of your data deletion request." },
    pt: { title: "Status da exclusão de dados", description: "Consulte o status da sua solicitação de exclusão de dados." },
    fr: { title: "État de suppression des données", description: "Consultez l'état de votre demande de suppression des données." },
  },
  "/signup": {
    es: { title: "Crear cuenta", description: "Continúa al registro seguro de Parallly." },
    en: { title: "Create account", description: "Continue to secure Parallly registration." },
    pt: { title: "Criar conta", description: "Continue para o cadastro seguro da Parallly." },
    fr: { title: "Créer un compte", description: "Continuez vers l'inscription sécurisée de Parallly." },
  },
};

export function localizedMetadata(path: string, locale: SupportedLocale, noIndex = false): Metadata {
  const copy = PAGE_COPY[path] ?? PAGE_COPY["/"];
  return buildMetadata({ ...copy[locale], path, locale, noIndex });
}

export function localizedIndustryMetadata(locale: SupportedLocale, slug: string): Metadata {
  const messages = { es: esMessages, en: enMessages, pt: ptMessages, fr: frMessages } as const;
  const vertical = (messages[locale].verticals as Record<string, { name?: string; tagline?: string }>)[slug];
  const name = vertical?.name ?? slug.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  const tagline = vertical?.tagline;
  const copy: Copy = {
    es: { title: `Parallly para ${name}`, description: tagline ?? `Configuración de Parallly para negocios de ${name}.` },
    en: { title: `Parallly for ${name}`, description: tagline ?? `Parallly configuration for ${name} businesses.` },
    pt: { title: `Parallly para ${name}`, description: tagline ?? `Configuração da Parallly para negócios de ${name}.` },
    fr: { title: `Parallly pour ${name}`, description: tagline ?? `Configuration Parallly pour les activités de ${name}.` },
  };
  return buildMetadata({ ...copy[locale], path: `/soluciones/${slug}`, locale });
}
