import { PrismaClient } from '@prisma/client';

const templates = [
    // ─── Lead Nurturing ──────────────────────────────────────────────
    {
        name: { es: 'Secuencia de bienvenida', en: 'Welcome Sequence', pt: 'Sequencia de boas-vindas', fr: 'Sequence de bienvenue' },
        description: {
            es: 'Envía un mensaje de bienvenida al capturar un lead, seguido de un mensaje de seguimiento tras 4 horas',
            en: 'Sends a welcome message when a lead is captured, followed by a follow-up after 4 hours',
            pt: 'Envia uma mensagem de boas-vindas ao capturar um lead, seguida de um acompanhamento após 4 horas',
            fr: 'Envoie un message de bienvenue lors de la capture d\'un lead, suivi d\'un suivi après 4 heures',
        },
        category: 'lead_nurturing',
        industry: null,
        icon: '👋',
        triggerConfig: { trigger_type: 'lead.captured', conditions: [] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{template_name}}', language: '{{language}}' }, delay: 0 },
            { type: 'send_template', config: { template_name: '{{followup_template}}', language: '{{language}}' }, delay: 14400 },
        ],
        variables: [
            { key: 'template_name', label: { es: 'Plantilla de bienvenida', en: 'Welcome template', pt: 'Modelo de boas-vindas', fr: 'Modele de bienvenue' }, type: 'string', default: 'welcome_message' },
            { key: 'followup_template', label: { es: 'Plantilla de seguimiento', en: 'Follow-up template', pt: 'Modelo de acompanhamento', fr: 'Modele de suivi' }, type: 'string', default: 'followup_message' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    {
        name: { es: 'Calificacion de leads', en: 'Lead Qualification', pt: 'Qualificacao de leads', fr: 'Qualification de leads' },
        description: {
            es: 'Envia preguntas de calificacion despues de capturar un lead para determinar su interes',
            en: 'Sends qualifying questions after capturing a lead to determine interest',
            pt: 'Envia perguntas de qualificacao apos capturar um lead para determinar interesse',
            fr: 'Envoie des questions de qualification apres la capture d\'un lead pour determiner l\'interet',
        },
        category: 'lead_nurturing',
        industry: null,
        icon: '🎯',
        triggerConfig: { trigger_type: 'lead.captured', conditions: [] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{qualification_template}}', language: '{{language}}' }, delay: 300 },
            { type: 'add_tag', config: { tag: 'pending_qualification' }, delay: 0 },
        ],
        variables: [
            { key: 'qualification_template', label: { es: 'Plantilla de calificacion', en: 'Qualification template', pt: 'Modelo de qualificacao', fr: 'Modele de qualification' }, type: 'string', default: 'lead_qualification' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    // ─── Appointment Reminders ────────────────────────────────────────
    {
        name: { es: 'Recordatorio 24h antes', en: '24h Reminder', pt: 'Lembrete 24h antes', fr: 'Rappel 24h avant' },
        description: {
            es: 'Envia un recordatorio de cita 24 horas antes del turno',
            en: 'Sends an appointment reminder 24 hours before the slot',
            pt: 'Envia um lembrete de consulta 24 horas antes do horario',
            fr: 'Envoie un rappel de rendez-vous 24 heures avant le creneau',
        },
        category: 'appointment_reminders',
        industry: null,
        icon: '⏰',
        triggerConfig: { trigger_type: 'lead.captured', conditions: [{ field: 'source', operator: 'equals', value: 'appointment' }] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{reminder_template}}', language: '{{language}}' }, delay: 0 },
        ],
        variables: [
            { key: 'reminder_template', label: { es: 'Plantilla de recordatorio', en: 'Reminder template', pt: 'Modelo de lembrete', fr: 'Modele de rappel' }, type: 'string', default: 'appointment_reminder_24h' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    {
        name: { es: 'Recordatorio 1h antes', en: '1h Reminder', pt: 'Lembrete 1h antes', fr: 'Rappel 1h avant' },
        description: {
            es: 'Envia un recordatorio de cita 1 hora antes del turno',
            en: 'Sends an appointment reminder 1 hour before the slot',
            pt: 'Envia um lembrete de consulta 1 hora antes do horario',
            fr: 'Envoie un rappel de rendez-vous 1 heure avant le creneau',
        },
        category: 'appointment_reminders',
        industry: null,
        icon: '🔔',
        triggerConfig: { trigger_type: 'lead.captured', conditions: [{ field: 'source', operator: 'equals', value: 'appointment' }] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{reminder_template}}', language: '{{language}}' }, delay: 0 },
        ],
        variables: [
            { key: 'reminder_template', label: { es: 'Plantilla de recordatorio', en: 'Reminder template', pt: 'Modelo de lembrete', fr: 'Modele de rappel' }, type: 'string', default: 'appointment_reminder_1h' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    // ─── Abandoned Cart ──────────────────────────────────────────────
    {
        name: { es: 'Recuperacion de carrito', en: 'Cart Recovery', pt: 'Recuperacao de carrinho', fr: 'Recuperation de panier' },
        description: {
            es: 'Envia un mensaje cuando se abandona un carrito, con oferta de descuento despues de 30 minutos',
            en: 'Sends a message when a cart is abandoned, with a discount offer after 30 minutes',
            pt: 'Envia uma mensagem quando um carrinho e abandonado, com oferta de desconto apos 30 minutos',
            fr: 'Envoie un message quand un panier est abandonne, avec une offre de reduction apres 30 minutes',
        },
        category: 'abandoned_cart',
        industry: null,
        icon: '🛒',
        triggerConfig: { trigger_type: 'lead.captured', conditions: [{ field: 'tag', operator: 'contains', value: 'cart_abandoned' }] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{cart_template}}', language: '{{language}}' }, delay: 1800 },
            { type: 'send_template', config: { template_name: '{{discount_template}}', language: '{{language}}' }, delay: 7200 },
        ],
        variables: [
            { key: 'cart_template', label: { es: 'Plantilla de carrito', en: 'Cart template', pt: 'Modelo de carrinho', fr: 'Modele de panier' }, type: 'string', default: 'cart_reminder' },
            { key: 'discount_template', label: { es: 'Plantilla de descuento', en: 'Discount template', pt: 'Modelo de desconto', fr: 'Modele de reduction' }, type: 'string', default: 'cart_discount' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    // ─── Welcome Sequence ────────────────────────────────────────────
    {
        name: { es: 'Bienvenida nuevo cliente', en: 'New Customer Welcome', pt: 'Boas-vindas novo cliente', fr: 'Bienvenue nouveau client' },
        description: {
            es: 'Secuencia completa: bienvenida, tips despues de 1 dia, y solicitud de feedback despues de 3 dias',
            en: 'Complete sequence: welcome, tips after 1 day, and feedback request after 3 days',
            pt: 'Sequencia completa: boas-vindas, dicas apos 1 dia, e solicitacao de feedback apos 3 dias',
            fr: 'Sequence complete: bienvenue, conseils apres 1 jour, et demande de retour apres 3 jours',
        },
        category: 'welcome_sequence',
        industry: null,
        icon: '🎉',
        triggerConfig: { trigger_type: 'lead.captured', conditions: [] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{welcome_template}}', language: '{{language}}' }, delay: 0 },
            { type: 'send_template', config: { template_name: '{{tips_template}}', language: '{{language}}' }, delay: 86400 },
            { type: 'send_template', config: { template_name: '{{feedback_template}}', language: '{{language}}' }, delay: 259200 },
        ],
        variables: [
            { key: 'welcome_template', label: { es: 'Plantilla de bienvenida', en: 'Welcome template', pt: 'Modelo de boas-vindas', fr: 'Modele de bienvenue' }, type: 'string', default: 'welcome_new_customer' },
            { key: 'tips_template', label: { es: 'Plantilla de tips', en: 'Tips template', pt: 'Modelo de dicas', fr: 'Modele de conseils' }, type: 'string', default: 'useful_tips' },
            { key: 'feedback_template', label: { es: 'Plantilla de feedback', en: 'Feedback template', pt: 'Modelo de feedback', fr: 'Modele de retour' }, type: 'string', default: 'request_feedback' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    // ─── Reactivation ────────────────────────────────────────────────
    {
        name: { es: 'Recuperar clientes inactivos', en: 'Win Back Inactive', pt: 'Recuperar clientes inativos', fr: 'Recuperer clients inactifs' },
        description: {
            es: 'Envia un mensaje a contactos inactivos despues de 30 dias sin interaccion',
            en: 'Sends a message to inactive contacts after 30 days without interaction',
            pt: 'Envia uma mensagem a contatos inativos apos 30 dias sem interacao',
            fr: 'Envoie un message aux contacts inactifs apres 30 jours sans interaction',
        },
        category: 'reactivation',
        industry: null,
        icon: '🔄',
        triggerConfig: { trigger_type: 'inactivity', conditions: [] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{winback_template}}', language: '{{language}}' }, delay: 0 },
            { type: 'change_stage', config: { stage: 'contactado' }, delay: 0 },
        ],
        variables: [
            { key: 'winback_template', label: { es: 'Plantilla de reactivacion', en: 'Win-back template', pt: 'Modelo de reativacao', fr: 'Modele de reactivation' }, type: 'string', default: 'win_back_30d' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    {
        name: { es: 'Re-engagement 14 dias', en: 'Re-engagement 14 Days', pt: 'Re-engajamento 14 dias', fr: 'Re-engagement 14 jours' },
        description: {
            es: 'Envia una oferta especial a contactos sin actividad durante 14 dias',
            en: 'Sends a special offer to contacts inactive for 14 days',
            pt: 'Envia uma oferta especial a contatos inativos por 14 dias',
            fr: 'Envoie une offre speciale aux contacts inactifs depuis 14 jours',
        },
        category: 'reactivation',
        industry: null,
        icon: '💌',
        triggerConfig: { trigger_type: 'inactivity', conditions: [] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{offer_template}}', language: '{{language}}' }, delay: 0 },
            { type: 'add_tag', config: { tag: 're-engagement' }, delay: 0 },
        ],
        variables: [
            { key: 'offer_template', label: { es: 'Plantilla de oferta', en: 'Offer template', pt: 'Modelo de oferta', fr: 'Modele d\'offre' }, type: 'string', default: 'special_offer_14d' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    // ─── Feedback Collection ─────────────────────────────────────────
    {
        name: { es: 'Encuesta post-servicio', en: 'Post-Service Feedback', pt: 'Pesquisa pos-servico', fr: 'Enquete post-service' },
        description: {
            es: 'Envia una encuesta de satisfaccion despues de completar un servicio',
            en: 'Sends a satisfaction survey after service completion',
            pt: 'Envia uma pesquisa de satisfacao apos a conclusao do servico',
            fr: 'Envoie une enquete de satisfaction apres la fin du service',
        },
        category: 'feedback_collection',
        industry: null,
        icon: '📋',
        triggerConfig: { trigger_type: 'stage_changed', conditions: [{ field: 'stage', operator: 'equals', value: 'listo_para_cierre' }] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{survey_template}}', language: '{{language}}' }, delay: 3600 },
        ],
        variables: [
            { key: 'survey_template', label: { es: 'Plantilla de encuesta', en: 'Survey template', pt: 'Modelo de pesquisa', fr: 'Modele d\'enquete' }, type: 'string', default: 'satisfaction_survey' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    // ─── VIP Treatment ───────────────────────────────────────────────
    {
        name: { es: 'Bienvenida VIP', en: 'VIP Welcome', pt: 'Boas-vindas VIP', fr: 'Bienvenue VIP' },
        description: {
            es: 'Bienvenida especial para leads de alto valor con asignacion inmediata a agente',
            en: 'Special welcome for high-value leads with immediate agent assignment',
            pt: 'Boas-vindas especiais para leads de alto valor com atribuicao imediata a agente',
            fr: 'Bienvenue speciale pour les leads de haute valeur avec attribution immediate a un agent',
        },
        category: 'vip_treatment',
        industry: null,
        icon: '⭐',
        triggerConfig: { trigger_type: 'lead.captured', conditions: [{ field: 'score', operator: 'greater_than', value: '80' }] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{vip_template}}', language: '{{language}}' }, delay: 0 },
            { type: 'add_tag', config: { tag: 'vip' }, delay: 0 },
            { type: 'assign_agent', config: { agent_id: '{{vip_agent_id}}' }, delay: 0 },
        ],
        variables: [
            { key: 'vip_template', label: { es: 'Plantilla VIP', en: 'VIP template', pt: 'Modelo VIP', fr: 'Modele VIP' }, type: 'string', default: 'vip_welcome' },
            { key: 'vip_agent_id', label: { es: 'ID del agente VIP', en: 'VIP agent ID', pt: 'ID do agente VIP', fr: 'ID de l\'agent VIP' }, type: 'string', default: '' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    // ─── After Hours ─────────────────────────────────────────────────
    {
        name: { es: 'Respuesta fuera de horario', en: 'After Hours Auto-Reply', pt: 'Resposta fora do horario', fr: 'Reponse hors horaires' },
        description: {
            es: 'Responde automaticamente fuera del horario comercial con informacion de horarios',
            en: 'Auto-replies outside business hours with schedule information',
            pt: 'Responde automaticamente fora do horario comercial com informacoes de horarios',
            fr: 'Repond automatiquement en dehors des heures d\'ouverture avec les informations d\'horaires',
        },
        category: 'after_hours',
        industry: null,
        icon: '🌙',
        triggerConfig: { trigger_type: 'new_message', conditions: [] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{after_hours_template}}', language: '{{language}}' }, delay: 0 },
        ],
        variables: [
            { key: 'after_hours_template', label: { es: 'Plantilla fuera de horario', en: 'After hours template', pt: 'Modelo fora do horario', fr: 'Modele hors horaires' }, type: 'string', default: 'after_hours_reply' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    // ─── Industry: Health ────────────────────────────────────────────
    {
        name: { es: 'Recordatorio de control', en: 'Check-up Reminder', pt: 'Lembrete de controle', fr: 'Rappel de controle' },
        description: {
            es: 'Envia un recordatorio para agendar control periodico en clinicas y consultorios',
            en: 'Sends a reminder to schedule periodic check-ups for clinics and offices',
            pt: 'Envia um lembrete para agendar controle periodico em clinicas e consultorios',
            fr: 'Envoie un rappel pour planifier un controle periodique dans les cliniques et cabinets',
        },
        category: 'appointment_reminders',
        industry: 'salud',
        icon: '🏥',
        triggerConfig: { trigger_type: 'inactivity', conditions: [] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{checkup_template}}', language: '{{language}}' }, delay: 0 },
        ],
        variables: [
            { key: 'checkup_template', label: { es: 'Plantilla de control', en: 'Check-up template', pt: 'Modelo de controle', fr: 'Modele de controle' }, type: 'string', default: 'checkup_reminder' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    // ─── Industry: Education ─────────────────────────────────────────
    {
        name: { es: 'Seguimiento de inscripcion', en: 'Enrollment Follow-up', pt: 'Acompanhamento de inscricao', fr: 'Suivi d\'inscription' },
        description: {
            es: 'Envia seguimiento a leads interesados en cursos que no completaron la inscripcion',
            en: 'Sends follow-up to leads interested in courses who did not complete enrollment',
            pt: 'Envia acompanhamento a leads interessados em cursos que nao completaram a inscricao',
            fr: 'Envoie un suivi aux leads interesses par des cours qui n\'ont pas termine l\'inscription',
        },
        category: 'lead_nurturing',
        industry: 'educacion',
        icon: '🎓',
        triggerConfig: { trigger_type: 'lead.captured', conditions: [{ field: 'source', operator: 'equals', value: 'course_inquiry' }] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{enrollment_template}}', language: '{{language}}' }, delay: 7200 },
            { type: 'add_tag', config: { tag: 'enrollment_pending' }, delay: 0 },
        ],
        variables: [
            { key: 'enrollment_template', label: { es: 'Plantilla de inscripcion', en: 'Enrollment template', pt: 'Modelo de inscricao', fr: 'Modele d\'inscription' }, type: 'string', default: 'enrollment_followup' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    // ─── Industry: Real Estate ───────────────────────────────────────
    {
        name: { es: 'Nuevas propiedades disponibles', en: 'New Properties Available', pt: 'Novas propriedades disponiveis', fr: 'Nouvelles proprietes disponibles' },
        description: {
            es: 'Notifica a leads calificados cuando hay nuevas propiedades que coinciden con su busqueda',
            en: 'Notifies qualified leads when new properties match their search criteria',
            pt: 'Notifica leads qualificados quando novas propriedades coincidem com sua busca',
            fr: 'Notifie les leads qualifies lorsque de nouvelles proprietes correspondent a leur recherche',
        },
        category: 'lead_nurturing',
        industry: 'inmobiliaria',
        icon: '🏠',
        triggerConfig: { trigger_type: 'stage_changed', conditions: [{ field: 'stage', operator: 'equals', value: 'calificado' }] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{properties_template}}', language: '{{language}}' }, delay: 0 },
        ],
        variables: [
            { key: 'properties_template', label: { es: 'Plantilla de propiedades', en: 'Properties template', pt: 'Modelo de propriedades', fr: 'Modele de proprietes' }, type: 'string', default: 'new_properties_alert' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
    // ─── SLA Escalation ──────────────────────────────────────────────
    {
        name: { es: 'Escalacion por SLA', en: 'SLA Escalation', pt: 'Escalacao por SLA', fr: 'Escalade SLA' },
        description: {
            es: 'Asigna automaticamente a un supervisor cuando se excede el tiempo de respuesta del SLA',
            en: 'Automatically assigns to a supervisor when SLA response time is exceeded',
            pt: 'Atribui automaticamente a um supervisor quando o tempo de resposta do SLA e excedido',
            fr: 'Attribue automatiquement a un superviseur lorsque le temps de reponse SLA est depasse',
        },
        category: 'lead_nurturing',
        industry: null,
        icon: '🚨',
        triggerConfig: { trigger_type: 'sla_timeout', conditions: [] },
        actionsConfig: [
            { type: 'assign_agent', config: { agent_id: '{{supervisor_id}}' }, delay: 0 },
            { type: 'add_tag', config: { tag: 'sla_breach' }, delay: 0 },
        ],
        variables: [
            { key: 'supervisor_id', label: { es: 'ID del supervisor', en: 'Supervisor ID', pt: 'ID do supervisor', fr: 'ID du superviseur' }, type: 'string', default: '' },
        ],
    },
    // ─── Hot Lead Assignment ─────────────────────────────────────────
    {
        name: { es: 'Asignar lead caliente', en: 'Hot Lead Assignment', pt: 'Atribuir lead quente', fr: 'Attribution lead chaud' },
        description: {
            es: 'Asigna automaticamente leads calientes al mejor agente disponible',
            en: 'Automatically assigns hot leads to the best available agent',
            pt: 'Atribui automaticamente leads quentes ao melhor agente disponivel',
            fr: 'Attribue automatiquement les leads chauds au meilleur agent disponible',
        },
        category: 'lead_nurturing',
        industry: null,
        icon: '🔥',
        triggerConfig: { trigger_type: 'stage_changed', conditions: [{ field: 'stage', operator: 'equals', value: 'caliente' }] },
        actionsConfig: [
            { type: 'assign_agent', config: { agent_id: '{{hot_lead_agent}}' }, delay: 0 },
            { type: 'create_task', config: { task_description: 'Follow up with hot lead immediately', task_due_hours: 1 }, delay: 0 },
        ],
        variables: [
            { key: 'hot_lead_agent', label: { es: 'Agente para leads calientes', en: 'Hot lead agent', pt: 'Agente para leads quentes', fr: 'Agent leads chauds' }, type: 'string', default: '' },
        ],
    },
    // ─── Industry: Restaurant ────────────────────────────────────────
    {
        name: { es: 'Promocion post-visita', en: 'Post-Visit Promotion', pt: 'Promocao pos-visita', fr: 'Promotion post-visite' },
        description: {
            es: 'Envia una promocion especial a clientes despues de su visita al restaurante',
            en: 'Sends a special promotion to customers after their restaurant visit',
            pt: 'Envia uma promocao especial a clientes apos sua visita ao restaurante',
            fr: 'Envoie une promotion speciale aux clients apres leur visite au restaurant',
        },
        category: 'reactivation',
        industry: 'restaurante',
        icon: '🍽️',
        triggerConfig: { trigger_type: 'stage_changed', conditions: [{ field: 'stage', operator: 'equals', value: 'listo_para_cierre' }] },
        actionsConfig: [
            { type: 'send_template', config: { template_name: '{{promo_template}}', language: '{{language}}' }, delay: 86400 },
        ],
        variables: [
            { key: 'promo_template', label: { es: 'Plantilla de promocion', en: 'Promotion template', pt: 'Modelo de promocao', fr: 'Modele de promotion' }, type: 'string', default: 'post_visit_promo' },
            { key: 'language', label: { es: 'Idioma', en: 'Language', pt: 'Idioma', fr: 'Langue' }, type: 'string', default: 'es' },
        ],
    },
];

export async function seedAutomationTemplates(prisma: PrismaClient) {
    for (const tpl of templates) {
        const nameEn = (tpl.name as any).en;
        const existing = await prisma.automationTemplate.findFirst({
            where: {
                name: { path: ['en'], equals: nameEn },
            },
        });

        if (existing) {
            await prisma.automationTemplate.update({
                where: { id: existing.id },
                data: {
                    name: tpl.name,
                    description: tpl.description,
                    category: tpl.category,
                    industry: tpl.industry,
                    icon: tpl.icon,
                    triggerConfig: tpl.triggerConfig,
                    actionsConfig: tpl.actionsConfig,
                    variables: tpl.variables,
                },
            });
        } else {
            await prisma.automationTemplate.create({ data: tpl as any });
        }
    }
}
