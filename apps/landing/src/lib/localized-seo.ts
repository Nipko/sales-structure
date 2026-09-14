import type { Metadata } from "next";
import { buildMetadata, type SupportedLocale } from "./seo";
import esMessages from "../../messages/es.json";
import enMessages from "../../messages/en.json";
import ptMessages from "../../messages/pt.json";
import frMessages from "../../messages/fr.json";

type Copy = Record<SupportedLocale, { title: string; description: string }>;

const PAGE_COPY: Record<string, Copy> = {
  "/": {
    es: esMessages.meta,
    en: enMessages.meta,
    pt: ptMessages.meta,
    fr: frMessages.meta,
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
    es: { title: "Plataforma para atención, ventas y seguimiento", description: "Configura canales, agentes IA, conocimiento, CRM y agenda con Parallly Assist como guía. Tu equipo coordina y revisa la calidad." },
    en: { title: "Platform for service, sales and follow-up", description: "Set up channels, AI agents, knowledge, CRM and scheduling with guidance from Parallly Assist. Your team coordinates and reviews quality." },
    pt: { title: "Plataforma para atendimento, vendas e acompanhamento", description: "Configure canais, agentes de IA, conhecimento, CRM e agenda com orientação do Parallly Assist. Sua equipe coordena e revisa a qualidade." },
    fr: { title: "Plateforme pour le service, les ventes et le suivi", description: "Configurez canaux, agents IA, connaissances, CRM et agenda avec Parallly Assist. Votre équipe coordonne et contrôle la qualité." },
  },
  "/producto/agente-ia": {
    es: { title: "Agentes de IA", description: "Configura agentes con conocimiento, catálogo, políticas, reservas y transferencia humana." },
    en: { title: "AI agents", description: "Configure agents with knowledge, catalog, policies, bookings and human handoff." },
    pt: { title: "Agentes de IA", description: "Configure agentes com conhecimento, catálogo, políticas, reservas e transferência humana." },
    fr: { title: "Agents IA", description: "Configurez des agents avec connaissances, catalogue, règles, rendez-vous et transfert humain." },
  },
  "/producto/conocimiento": {
    es: { title: "Base de conocimiento para tus agentes", description: "Organiza identidad del negocio, catálogo, preguntas frecuentes, políticas y artículos para dar contexto a tus agentes IA." },
    en: { title: "Knowledge base for your agents", description: "Organize business identity, catalog, FAQs, policies and articles to give your AI agents context." },
    pt: { title: "Base de conhecimento para seus agentes", description: "Organize identidade do negócio, catálogo, perguntas frequentes, políticas e artigos para contextualizar seus agentes de IA." },
    fr: { title: "Base de connaissances pour vos agents", description: "Organisez identité de l’entreprise, catalogue, FAQ, règles et articles pour contextualiser vos agents IA." },
  },
  "/producto/parallly-assist": {
    es: { title: "Parallly Assist: tu guía en la plataforma", description: "Recibe orientación para configurar agentes, usar herramientas y entender la calidad según tu rol en Parallly." },
    en: { title: "Parallly Assist: your platform guide", description: "Get guidance on agent setup, tools and understanding quality based on your role in Parallly." },
    pt: { title: "Parallly Assist: seu guia na plataforma", description: "Receba orientação para configurar agentes, usar ferramentas e entender a qualidade conforme seu perfil na Parallly." },
    fr: { title: "Parallly Assist : votre guide dans la plateforme", description: "Obtenez des conseils pour configurer les agents, utiliser les outils et comprendre la qualité selon votre rôle dans Parallly." },
  },
  "/producto/calidad": {
    es: { title: "Centro de calidad y control de agentes", description: "Revisa la preparación de tu agente, prueba respuestas y observa señales de producción para orientar mejoras con tu equipo." },
    en: { title: "Agent quality and control center", description: "Review agent readiness, test replies and observe production signals to guide improvements with your team." },
    pt: { title: "Central de qualidade e controle dos agentes", description: "Revise a preparação do agente, teste respostas e observe sinais de produção para orientar melhorias com sua equipe." },
    fr: { title: "Centre de qualité et contrôle des agents", description: "Vérifiez la préparation de l’agent, testez ses réponses et observez les signaux de production pour guider les améliorations avec votre équipe." },
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
    es: { title: "Parallly para Android — Disponible en Google Play", description: "Descarga Parallly en Google Play. Atiende conversaciones y sigue contactos, oportunidades y tareas desde Android con los permisos de tu equipo." },
    en: { title: "Parallly for Android — Available on Google Play", description: "Download Parallly on Google Play. Handle conversations and follow contacts, opportunities and tasks from Android with your team's permissions." },
    pt: { title: "Parallly para Android — Disponível no Google Play", description: "Baixe a Parallly no Google Play. Atenda conversas e acompanhe contatos, oportunidades e tarefas pelo Android com as permissões da sua equipe." },
    fr: { title: "Parallly pour Android — Disponible sur Google Play", description: "Téléchargez Parallly sur Google Play. Traitez les conversations et suivez contacts, opportunités et tâches sur Android selon les autorisations de votre équipe." },
  },
  "/soluciones": {
    es: { title: "Soluciones por industria", description: "Explora configuraciones para ventas, atención, CRM y reservas por tipo de negocio." },
    en: { title: "Solutions by industry", description: "Explore configurations for sales, service, CRM and bookings by business type." },
    pt: { title: "Soluções por setor", description: "Explore configurações de vendas, atendimento, CRM e reservas por tipo de negócio." },
    fr: { title: "Solutions par secteur", description: "Explorez les configurations de vente, service, CRM et réservation par activité." },
  },
  "/support": {
    es: { title: "Orientación y soporte para tu empresa", description: "Evalúa cómo adaptar Parallly a tu negocio, conoce Parallly Assist o prepara una consulta para soporte." },
    en: { title: "Guidance and support for your business", description: "Explore how Parallly fits your business, discover Parallly Assist or prepare a support inquiry." },
    pt: { title: "Orientação e suporte para sua empresa", description: "Avalie como adaptar a Parallly ao seu negócio, conheça o Parallly Assist ou prepare uma consulta ao suporte." },
    fr: { title: "Conseils et assistance pour votre entreprise", description: "Étudiez l’adaptation de Parallly à votre activité, découvrez Parallly Assist ou préparez une demande d’assistance." },
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
