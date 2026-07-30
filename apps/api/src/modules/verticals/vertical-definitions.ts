/**
 * Vertical Industry Definitions — The single source of truth for all industry-specific
 * configurations in Parallly. Each entry defines how the platform adapts when a tenant
 * selects that industry during onboarding.
 *
 * Structure: VERTICAL_REGISTRY is a Map<industrySlug, VerticalDefinition>
 * All strings are localized: { es, en, pt, fr }
 *
 * Content conventions (this text is read by the tenant's END CUSTOMER — FAQs go out
 * through the public, unauthenticated FAQ portal and services are listed verbatim over
 * WhatsApp by the booking engine):
 *  - Spelling and diacritics must be correct in every language. We sign these words with
 *    the tenant's business name; typos are theirs, not ours.
 *  - Never state a business policy the tenant has not confirmed (payment methods, late
 *    fees, cancellation windows, warranties, response times, prices). Seed FAQs invite the
 *    customer to ask instead of inventing the answer.
 *  - EXCEPTION — `agent.handoffTriggers` is NOT display text: `handoff.service.ts` matches
 *    each trigger with `text.includes(trigger.toLowerCase())` against the raw customer
 *    message, WITHOUT stripping diacritics. They are deliberately left unaccented so they
 *    still match the "urgencia medica" people actually type on a phone keyboard. Do not
 *    "fix" them here. (Service names are safe to accent: the booking engine normalizes
 *    NFD before matching.)
 */
import { VerticalDefinition } from '@parallext/shared';

// ─────────────────────────────────────────────────────────
// 1. SALUD (Healthcare)
// ─────────────────────────────────────────────────────────
const SALUD: VerticalDefinition = {
    industry: 'salud',
    subTypes: [
        { key: 'dental', label: { es: 'Odontología', en: 'Dental', pt: 'Odontologia', fr: 'Dentaire' } },
        { key: 'medica_general', label: { es: 'Medicina general', en: 'General medicine', pt: 'Medicina geral', fr: 'Médecine générale' } },
        { key: 'estetica', label: { es: 'Estética y dermatología', en: 'Aesthetics & dermatology', pt: 'Estética e dermatologia', fr: 'Esthétique et dermatologie' } },
        { key: 'psicologia', label: { es: 'Psicología y terapia', en: 'Psychology & therapy', pt: 'Psicologia e terapia', fr: 'Psychologie et thérapie' } },
        { key: 'farmacia', label: { es: 'Farmacia', en: 'Pharmacy', pt: 'Farmácia', fr: 'Pharmacie' } },
    ],
    terminology: {
        customerNoun: { es: 'paciente', en: 'patient', pt: 'paciente', fr: 'patient' },
        customerNounPlural: { es: 'pacientes', en: 'patients', pt: 'pacientes', fr: 'patients' },
        transactionNoun: { es: 'consulta', en: 'consultation', pt: 'consulta', fr: 'consultation' },
        serviceNoun: { es: 'servicio médico', en: 'medical service', pt: 'serviço médico', fr: 'service médical' },
        pipelineNoun: { es: 'seguimiento', en: 'patient journey', pt: 'acompanhamento', fr: 'suivi' },
    },
    agent: {
        name: { es: 'Sofía', en: 'Sofia', pt: 'Sofia', fr: 'Sofia' },
        role: { es: 'Asistente de atención al paciente', en: 'Patient care assistant', pt: 'Assistente de atendimento ao paciente', fr: 'Assistante de soins aux patients' },
        tone: 'professional',
        formality: 'formal',
        greeting: { es: 'Hola, soy Sofía, asistente de la clínica. ¿En qué puedo ayudarte?', en: 'Hello, I am Sofia, the clinic assistant. How can I help you?', pt: 'Olá, sou Sofia, assistente da clínica. Como posso ajudar?', fr: 'Bonjour, je suis Sofia, assistante de la clinique. Comment puis-je vous aider?' },
        rules: {
            es: 'Siempre ofrece agendar una cita cuando el paciente describe síntomas. Nunca brindes diagnósticos ni recomiendes medicamentos. Refiere a consulta presencial cuando haya dudas clínicas.',
            en: 'Always offer to schedule an appointment when the patient describes symptoms. Never provide diagnoses or recommend medications. Refer to in-person consultation for clinical questions.',
            pt: 'Sempre ofereça agendar uma consulta quando o paciente descrever sintomas. Nunca forneça diagnósticos nem recomende medicamentos.',
            fr: 'Proposez toujours de prendre rendez-vous lorsque le patient décrit des symptômes. Ne jamais fournir de diagnostics ni recommander de médicaments.',
        },
        forbiddenTopics: {
            es: 'Diagnósticos médicos|Prescripción de medicamentos|Interpretación de exámenes|Datos de otros pacientes|Recomendación de tratamientos específicos',
            en: 'Medical diagnoses|Medication prescription|Test interpretation|Other patients data|Specific treatment recommendations',
            pt: 'Diagnósticos médicos|Prescrição de medicamentos|Interpretação de exames|Dados de outros pacientes|Recomendação de tratamentos específicos',
            fr: 'Diagnostics médicaux|Prescription de médicaments|Interprétation d\'examens|Données d\'autres patients|Recommandation de traitements spécifiques',
        },
        handoffTriggers: {
            es: 'urgencia medica|emergencia|dolor intenso|solicitud de receta|queja formal|historial clinico',
            en: 'medical emergency|severe pain|prescription request|formal complaint|medical records',
            pt: 'urgencia medica|emergencia|dor intensa|solicitacao de receita|reclamacao formal',
            fr: 'urgence medicale|douleur intense|demande d\'ordonnance|plainte formelle',
        },
    },
    pipeline: {
        stages: [
            { name: { es: 'Consulta inicial', en: 'Initial inquiry', pt: 'Consulta inicial', fr: 'Consultation initiale' }, slug: 'consulta_inicial', color: '#3498db', probability: 10, isTerminal: false, transitionRules: [] },
            { name: { es: 'Cita agendada', en: 'Appointment scheduled', pt: 'Consulta agendada', fr: 'Rendez-vous programmé' }, slug: 'cita_agendada', color: '#f39c12', probability: 30, isTerminal: false, transitionRules: [{ type: 'appointment_required' }] },
            { name: { es: 'Primera visita', en: 'First visit', pt: 'Primeira visita', fr: 'Première visite' }, slug: 'primera_visita', color: '#e67e22', probability: 50, isTerminal: false, transitionRules: [{ type: 'name_required' }, { type: 'phone_required' }] },
            { name: { es: 'Paciente activo', en: 'Active patient', pt: 'Paciente ativo', fr: 'Patient actif' }, slug: 'paciente_activo', color: '#2ecc71', probability: 80, isTerminal: false, transitionRules: [{ type: 'email_required' }] },
            { name: { es: 'Seguimiento', en: 'Follow-up', pt: 'Acompanhamento', fr: 'Suivi' }, slug: 'seguimiento', color: '#27ae60', probability: 90, isTerminal: false, transitionRules: [] },
            { name: { es: 'Alta', en: 'Discharged', pt: 'Alta', fr: 'Sorti' }, slug: 'alta', color: '#95a5a6', probability: 100, isTerminal: true, transitionRules: [] },
        ],
    },
    faqs: [
        { question: { es: '¿Cuál es el horario de atención?', en: 'What are your office hours?', pt: 'Qual é o horário de atendimento?', fr: 'Quels sont vos horaires?' }, answer: { es: 'Cuéntame qué día te sirve y te confirmo el horario de atención. Si quieres agendar ahora mismo, escribe "quiero una cita".', en: 'Tell me which day works for you and I will confirm our office hours. To book right away, write "I want an appointment".', pt: 'Diga-me qual dia lhe serve e confirmo o horário de atendimento. Para agendar agora, escreva "quero uma consulta".', fr: 'Dites-moi quel jour vous convient et je vous confirme nos horaires. Pour prendre rendez-vous, écrivez "je veux un rendez-vous".' }, category: 'general' },
        { question: { es: '¿Cuáles son los métodos de pago?', en: 'What payment methods do you accept?', pt: 'Quais são as formas de pagamento?', fr: 'Quels modes de paiement acceptez-vous?' }, answer: { es: 'Te confirmo los medios de pago disponibles y si trabajamos con tu seguro antes de tu cita. Pregúntame y lo verifico.', en: 'I can confirm which payment methods we accept and whether we work with your insurance before your visit. Just ask and I will check.', pt: 'Confirmo as formas de pagamento disponíveis e se atendemos o seu convênio antes da consulta. É só perguntar.', fr: 'Je vous confirme les moyens de paiement acceptés et si nous travaillons avec votre assurance avant votre rendez-vous.' }, category: 'pagos' },
        { question: { es: '¿Qué hago en caso de emergencia?', en: 'What should I do in an emergency?', pt: 'O que fazer em caso de emergência?', fr: 'Que faire en cas d\'urgence?' }, answer: { es: 'En caso de emergencia acude al servicio de urgencias más cercano o llama a la línea de emergencias de tu ciudad. Durante el horario de atención escríbenos y damos prioridad a tu caso.', en: 'In an emergency, go to the nearest hospital ER or call your local emergency number. During office hours, message us and we will prioritize your case.', pt: 'Em caso de emergência, vá ao pronto-socorro mais próximo ou ligue para o número de emergência da sua região. No horário de atendimento, escreva-nos e priorizamos o seu caso.', fr: 'En cas d\'urgence, rendez-vous aux urgences les plus proches ou appelez le numéro d\'urgence de votre région. Pendant les heures d\'ouverture, écrivez-nous et nous traiterons votre cas en priorité.' }, category: 'emergencias' },
        { question: { es: '¿Cómo cancelo o reprogramo una cita?', en: 'How do I cancel or reschedule?', pt: 'Como cancelo ou remarco uma consulta?', fr: 'Comment annuler ou reprogrammer?' }, answer: { es: 'Escribe "cancelar cita" o "reprogramar cita" y lo gestiono. Avísanos con la mayor anticipación posible; te confirmo las condiciones de cancelación antes de hacer el cambio.', en: 'Write "cancel appointment" or "reschedule" and I will take care of it. Let us know as early as you can — I will confirm the cancellation terms before making the change.', pt: 'Escreva "cancelar consulta" ou "remarcar" e eu resolvo. Avise com a maior antecedência possível; confirmo as condições de cancelamento antes de alterar.', fr: 'Écrivez "annuler" ou "reprogrammer" et je m\'en occupe. Prévenez-nous le plus tôt possible; je vous confirmerai les conditions d\'annulation avant le changement.' }, category: 'citas' },
        { question: { es: '¿Qué documentos necesito para la primera visita?', en: 'What documents do I need for the first visit?', pt: 'Que documentos preciso para a primeira visita?', fr: 'Quels documents sont nécessaires pour la première visite?' }, answer: { es: 'Trae tu documento de identidad y, si tienes seguro médico, el carné. Los exámenes previos relacionados con tu consulta también ayudan. Te aviso si hace falta algo más antes de tu cita.', en: 'Bring your ID and, if you have health insurance, your card. Any previous test results related to your consultation also help. I will let you know if anything else is needed.', pt: 'Traga seu documento de identidade e, se tiver convênio, a carteirinha. Exames anteriores relacionados também ajudam. Aviso se faltar algo antes da consulta.', fr: 'Apportez votre pièce d\'identité et, si vous avez une assurance santé, votre carte. Vos examens antérieurs liés à la consultation sont également utiles. Je vous préviens s\'il manque autre chose.' }, category: 'general' },
    ],
    services: [
        { name: { es: 'Consulta general', en: 'General consultation', pt: 'Consulta geral', fr: 'Consultation générale' }, description: { es: 'Consulta médica general con el especialista', en: 'General medical consultation', pt: 'Consulta médica geral', fr: 'Consultation médicale générale' }, durationMinutes: 30, price: 80000, currency: 'COP', category: 'consulta' },
        { name: { es: 'Consulta especializada', en: 'Specialist consultation', pt: 'Consulta especializada', fr: 'Consultation spécialisée' }, description: { es: 'Consulta con especialista o procedimiento diagnóstico', en: 'Specialist consultation or diagnostic procedure', pt: 'Consulta com especialista', fr: 'Consultation avec spécialiste' }, durationMinutes: 45, price: 120000, currency: 'COP', category: 'consulta' },
        { name: { es: 'Control y seguimiento', en: 'Follow-up visit', pt: 'Consulta de retorno', fr: 'Visite de suivi' }, description: { es: 'Cita de control o seguimiento de tratamiento', en: 'Treatment follow-up appointment', pt: 'Consulta de acompanhamento', fr: 'Rendez-vous de suivi' }, durationMinutes: 20, price: 50000, currency: 'COP', category: 'control' },
    ],
    businessHours: {
        schedule: { mon: '08:00-18:00', tue: '08:00-18:00', wed: '08:00-18:00', thu: '08:00-18:00', fri: '08:00-18:00', sat: '08:00-13:00' },
        afterHoursMessage: { es: 'Estamos fuera de horario. Te responderemos en cuanto abramos. En caso de emergencia, dirígete a urgencias.', en: 'We are currently closed. We will respond when we open. In case of emergency, go to the ER.', pt: 'Estamos fora do horário. Responderemos quando abrirmos.', fr: 'Nous sommes fermés. Nous répondrons à l\'ouverture.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Pacientes', en: 'Patients', pt: 'Pacientes', fr: 'Patients' },
            pipeline: { es: 'Seguimiento', en: 'Patient Journey', pt: 'Acompanhamento', fr: 'Suivi' },
            appointments: { es: 'Agenda Médica', en: 'Medical Schedule', pt: 'Agenda Médica', fr: 'Agenda Médicale' },
        },
        hiddenItems: [],
    },
    dashboard: {
        kpis: [
            { key: 'appointmentsToday', label: { es: 'Citas Hoy', en: 'Appointments Today', pt: 'Consultas Hoje', fr: 'Rendez-vous Aujourd\'hui' }, icon: 'Calendar', color: '#3498db' },
            { key: 'leadsToday', label: { es: 'Pacientes Nuevos', en: 'New Patients', pt: 'Pacientes Novos', fr: 'Nouveaux Patients' }, icon: 'UserPlus', color: '#2ecc71' },
            { key: 'noShowsWeek', label: { es: 'No Shows (semana)', en: 'No Shows (week)', pt: 'Faltas (semana)', fr: 'Absences (semaine)' }, icon: 'UserX', color: '#e74c3c' },
            { key: 'messagesProcessed', label: { es: 'Mensajes Procesados', en: 'Messages Processed', pt: 'Mensagens Processadas', fr: 'Messages Traités' }, icon: 'MessageSquare', color: '#9b59b6' },
        ],
    },
    bookingEnabled: true,
};

// ─────────────────────────────────────────────────────────
// 2. MODA Y BELLEZA (Fashion & Beauty)
// ─────────────────────────────────────────────────────────
const MODA_BELLEZA: VerticalDefinition = {
    industry: 'moda_belleza',
    subTypes: [
        { key: 'salon_belleza', label: { es: 'Salón de belleza', en: 'Beauty salon', pt: 'Salão de beleza', fr: 'Salon de beauté' } },
        { key: 'barberia', label: { es: 'Barbería', en: 'Barbershop', pt: 'Barbearia', fr: 'Barbier' } },
        { key: 'spa', label: { es: 'Spa y bienestar', en: 'Spa & wellness', pt: 'Spa e bem-estar', fr: 'Spa et bien-être' } },
        { key: 'boutique', label: { es: 'Boutique de moda', en: 'Fashion boutique', pt: 'Boutique de moda', fr: 'Boutique de mode' } },
    ],
    terminology: {
        customerNoun: { es: 'cliente', en: 'client', pt: 'cliente', fr: 'client' },
        customerNounPlural: { es: 'clientes', en: 'clients', pt: 'clientes', fr: 'clients' },
        transactionNoun: { es: 'cita', en: 'appointment', pt: 'agendamento', fr: 'rendez-vous' },
        serviceNoun: { es: 'servicio', en: 'service', pt: 'serviço', fr: 'service' },
        pipelineNoun: { es: 'citas', en: 'appointments', pt: 'agendamentos', fr: 'rendez-vous' },
    },
    agent: {
        name: { es: 'Luna', en: 'Luna', pt: 'Luna', fr: 'Luna' },
        role: { es: 'Asistente de belleza y estilo', en: 'Beauty & style assistant', pt: 'Assistente de beleza e estilo', fr: 'Assistante beauté et style' },
        tone: 'friendly',
        formality: 'casual',
        greeting: { es: '¡Hola! Soy Luna, tu asistente de belleza. ¿Te gustaría agendar una cita o conocer nuestros servicios?', en: 'Hi! I\'m Luna, your beauty assistant. Would you like to book an appointment or learn about our services?', pt: 'Olá! Sou Luna, sua assistente de beleza. Gostaria de agendar ou conhecer nossos serviços?', fr: 'Bonjour! Je suis Luna, votre assistante beauté. Souhaitez-vous prendre rendez-vous?' },
        rules: { es: 'Sugiere servicios complementarios de forma natural. Ofrece promociones vigentes.', en: 'Suggest complementary services naturally. Offer current promotions.', pt: 'Sugira serviços complementares naturalmente. Ofereça promoções vigentes.', fr: 'Suggérez des services complémentaires naturellement. Proposez les promotions en cours.' },
        forbiddenTopics: { es: 'Diagnóstico dermatológico|Garantizar resultados estéticos|Productos no autorizados', en: 'Dermatological diagnosis|Guarantee aesthetic results|Unauthorized products', pt: 'Diagnóstico dermatológico|Garantir resultados estéticos|Produtos não autorizados', fr: 'Diagnostic dermatologique|Garantir résultats esthétiques|Produits non autorisés' },
        handoffTriggers: { es: 'reaccion adversa|queja de servicio|evento nupcial|grupo grande', en: 'adverse reaction|service complaint|bridal event|large group', pt: 'reacao adversa|reclamacao|evento nupcial|grupo grande', fr: 'reaction indesirable|plainte|evenement nuptial|grand groupe' },
    },
    pipeline: {
        stages: [
            { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#e91e90', probability: 10, isTerminal: false, transitionRules: [] },
            { name: { es: 'Cita agendada', en: 'Booked', pt: 'Agendado', fr: 'Réservé' }, slug: 'cita_agendada', color: '#ff69b4', probability: 40, isTerminal: false, transitionRules: [{ type: 'appointment_required' }] },
            { name: { es: 'En servicio', en: 'In service', pt: 'Em atendimento', fr: 'En service' }, slug: 'en_servicio', color: '#da70d6', probability: 70, isTerminal: false, transitionRules: [{ type: 'name_required' }, { type: 'phone_required' }] },
            { name: { es: 'Cliente frecuente', en: 'Regular client', pt: 'Cliente frequente', fr: 'Client régulier' }, slug: 'frecuente', color: '#9b59b6', probability: 90, isTerminal: false, transitionRules: [] },
            { name: { es: 'VIP', en: 'VIP', pt: 'VIP', fr: 'VIP' }, slug: 'vip', color: '#8e44ad', probability: 100, isTerminal: true, transitionRules: [{ type: 'min_score', value: 8 }] },
        ],
    },
    faqs: [
        { question: { es: '¿Qué servicios ofrecen y cuánto cuestan?', en: 'What services do you offer and prices?', pt: 'Quais serviços oferecem e quanto custam?', fr: 'Quels services proposez-vous et à quel prix?' }, answer: { es: 'Escribe "servicios" y te muestro el catálogo completo con los precios vigentes. Si buscas algo puntual, dime qué necesitas y lo verifico.', en: 'Write "services" and I will show you our full catalog with current prices. If you have something specific in mind, tell me and I will check.', pt: 'Escreva "serviços" e mostro o catálogo completo com os preços vigentes. Se procura algo específico, me diga e verifico.', fr: 'Écrivez "services" et je vous montre le catalogue complet avec les prix en vigueur. Si vous cherchez quelque chose de précis, dites-le-moi.' }, category: 'servicios' },
        { question: { es: '¿Cómo agendo una cita?', en: 'How do I book an appointment?', pt: 'Como agendo um horário?', fr: 'Comment prendre rendez-vous?' }, answer: { es: 'Puedes agendar tu cita ahora mismo. Solo dime qué servicio te interesa y te muestro la disponibilidad.', en: 'You can book right now. Just tell me which service you are interested in and I will show you availability.', pt: 'Você pode agendar agora mesmo. Me diga qual serviço te interessa.', fr: 'Vous pouvez prendre rendez-vous maintenant. Dites-moi quel service vous intéresse.' }, category: 'citas' },
        { question: { es: '¿Tienen promociones?', en: 'Do you have any promotions?', pt: 'Tem promoções?', fr: 'Avez-vous des promotions?' }, answer: { es: 'Pregúntame por las ofertas vigentes o escribe "promociones" y te cuento qué hay disponible en este momento.', en: 'Ask me about current offers or write "promotions" and I will tell you what is available right now.', pt: 'Pergunte pelas ofertas vigentes ou escreva "promoções" e conto o que há disponível no momento.', fr: 'Demandez-moi les offres en cours ou écrivez "promotions" et je vous dis ce qui est disponible.' }, category: 'promociones' },
        { question: { es: '¿Cuál es la política de cancelación?', en: 'What is the cancellation policy?', pt: 'Qual é a política de cancelamento?', fr: 'Quelle est la politique d\'annulation?' }, answer: { es: 'Avísanos con la mayor anticipación posible si no puedes venir. Te confirmo las condiciones de cancelación antes de reprogramar tu cita.', en: 'Let us know as early as you can if you cannot make it. I will confirm the cancellation terms before rescheduling.', pt: 'Avise com a maior antecedência possível se não puder vir. Confirmo as condições de cancelamento antes de remarcar.', fr: 'Prévenez-nous le plus tôt possible si vous ne pouvez pas venir. Je vous confirmerai les conditions d\'annulation avant de reprogrammer.' }, category: 'politicas' },
        { question: { es: '¿Qué productos usan?', en: 'What products do you use?', pt: 'Quais produtos usam?', fr: 'Quels produits utilisez-vous?' }, answer: { es: 'Cuéntanos si tienes alguna alergia o preferencia y lo tenemos en cuenta. Si quieres saber qué marcas usamos para tu servicio, te lo confirmo.', en: 'Tell us about any allergies or preferences and we will take them into account. If you want to know which brands we use for your service, I can confirm.', pt: 'Conte-nos se tem alguma alergia ou preferência e levamos em conta. Se quiser saber quais marcas usamos, confirmo para você.', fr: 'Dites-nous si vous avez des allergies ou des préférences et nous en tiendrons compte. Si vous voulez connaître les marques utilisées, je vous le confirme.' }, category: 'productos' },
    ],
    services: [
        { name: { es: 'Corte y estilo', en: 'Cut & style', pt: 'Corte e estilo', fr: 'Coupe et coiffure' }, description: { es: 'Corte de cabello con lavado y secado', en: 'Haircut with wash and blow dry', pt: 'Corte com lavagem e secagem', fr: 'Coupe avec lavage et brushing' }, durationMinutes: 45, price: 40000, currency: 'COP', category: 'cabello' },
        { name: { es: 'Color y tratamiento', en: 'Color & treatment', pt: 'Coloração e tratamento', fr: 'Coloration et traitement' }, description: { es: 'Coloración completa con tratamiento hidratante', en: 'Full color with hydrating treatment', pt: 'Coloração completa com tratamento hidratante', fr: 'Coloration complète avec traitement hydratant' }, durationMinutes: 120, price: 120000, currency: 'COP', category: 'cabello' },
        { name: { es: 'Manicure y pedicure', en: 'Manicure & pedicure', pt: 'Manicure e pedicure', fr: 'Manucure et pédicure' }, description: { es: 'Servicio completo de manos y pies', en: 'Full hand and foot service', pt: 'Serviço completo de mãos e pés', fr: 'Service complet mains et pieds' }, durationMinutes: 60, price: 50000, currency: 'COP', category: 'unas' },
    ],
    businessHours: {
        schedule: { mon: '09:00-19:00', tue: '09:00-19:00', wed: '09:00-19:00', thu: '09:00-19:00', fri: '09:00-19:00', sat: '09:00-19:00' },
        afterHoursMessage: { es: 'Estamos cerrados. Te responderemos cuando abramos. Puedes agendar tu cita y te confirmaremos.', en: 'We are closed. We will respond when we open. You can book and we will confirm.', pt: 'Estamos fechados. Responderemos quando abrirmos.', fr: 'Nous sommes fermés. Nous répondrons à l\'ouverture.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Clientes', en: 'Clients', pt: 'Clientes', fr: 'Clients' },
            pipeline: { es: 'Citas', en: 'Appointments', pt: 'Agendamentos', fr: 'Rendez-vous' },
            appointments: { es: 'Agenda', en: 'Schedule', pt: 'Agenda', fr: 'Agenda' },
        },
        hiddenItems: [],
    },
    dashboard: {
        kpis: [
            { key: 'appointmentsToday', label: { es: 'Citas Hoy', en: 'Appointments Today', pt: 'Agendamentos Hoje', fr: 'RDV Aujourd\'hui' }, icon: 'Calendar', color: '#e91e90' },
            { key: 'leadsToday', label: { es: 'Clientes Nuevos', en: 'New Clients', pt: 'Clientes Novos', fr: 'Nouveaux Clients' }, icon: 'UserPlus', color: '#2ecc71' },
            { key: 'noShowsWeek', label: { es: 'No Shows', en: 'No Shows', pt: 'Faltas', fr: 'Absences' }, icon: 'UserX', color: '#e74c3c' },
            { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
        ],
    },
    bookingEnabled: true,
};

// ─────────────────────────────────────────────────────────
// 3. INMOBILIARIA (Real Estate)
// ─────────────────────────────────────────────────────────
const INMOBILIARIA: VerticalDefinition = {
    industry: 'inmobiliaria',
    subTypes: [
        { key: 'venta', label: { es: 'Venta de inmuebles', en: 'Property sales', pt: 'Venda de imóveis', fr: 'Vente immobilière' } },
        { key: 'arriendo', label: { es: 'Arriendo', en: 'Rental', pt: 'Aluguel', fr: 'Location' } },
        { key: 'comercial', label: { es: 'Inmuebles comerciales', en: 'Commercial real estate', pt: 'Imóveis comerciais', fr: 'Immobilier commercial' } },
        { key: 'construccion', label: { es: 'Construcción y proyectos', en: 'Construction & development', pt: 'Construção e projetos', fr: 'Construction et projets' } },
    ],
    terminology: {
        customerNoun: { es: 'interesado', en: 'prospect', pt: 'interessado', fr: 'prospect' },
        customerNounPlural: { es: 'interesados', en: 'prospects', pt: 'interessados', fr: 'prospects' },
        transactionNoun: { es: 'negociación', en: 'deal', pt: 'negociação', fr: 'négociation' },
        serviceNoun: { es: 'propiedad', en: 'property', pt: 'imóvel', fr: 'bien immobilier' },
        pipelineNoun: { es: 'negociaciones', en: 'deals', pt: 'negociações', fr: 'négociations' },
    },
    agent: {
        name: { es: 'Carlos', en: 'Carlos', pt: 'Carlos', fr: 'Charles' },
        role: { es: 'Asesor inmobiliario virtual', en: 'Virtual real estate advisor', pt: 'Consultor imobiliário virtual', fr: 'Conseiller immobilier virtuel' },
        tone: 'professional',
        formality: 'formal',
        greeting: { es: 'Hola, soy Carlos, asesor inmobiliario. ¿Estás buscando comprar, arrendar o vender?', en: 'Hello, I\'m Carlos, your real estate advisor. Are you looking to buy, rent or sell?', pt: 'Olá, sou Carlos, consultor imobiliário. Você procura comprar, alugar ou vender?', fr: 'Bonjour, je suis Charles, votre conseiller immobilier. Recherchez-vous à acheter, louer ou vendre?' },
        rules: { es: 'Califica al prospecto (presupuesto, zona, tipo de inmueble, urgencia). Ofrece agendar visitas. Nunca garantices valorización.', en: 'Qualify the prospect (budget, area, property type, timeline). Offer to schedule viewings. Never guarantee appreciation.', pt: 'Qualifique o interessado (orçamento, zona, tipo de imóvel). Ofereça agendar visitas.', fr: 'Qualifiez le prospect (budget, zone, type de bien). Proposez de planifier des visites.' },
        forbiddenTopics: { es: 'Garantizar valorización|Asesoramiento hipotecario legal|Discriminación por zona|Precios de costo|Información fiscal', en: 'Guarantee appreciation|Legal mortgage advice|Zone discrimination|Cost prices|Tax information', pt: 'Garantir valorização|Assessoria hipotecária legal|Discriminação por zona', fr: 'Garantir valorisation|Conseil hypothécaire légal|Discrimination par zone' },
        handoffTriggers: { es: 'oferta formal|negociacion de precio|visita presencial|escrituras|credito hipotecario', en: 'formal offer|price negotiation|in-person viewing|deeds|mortgage', pt: 'oferta formal|negociacao de preco|visita presencial|escritura', fr: 'offre formelle|negociation de prix|visite en personne' },
    },
    pipeline: {
        stages: [
            { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#3498db', probability: 5, isTerminal: false, transitionRules: [] },
            { name: { es: 'Calificado', en: 'Qualified', pt: 'Qualificado', fr: 'Qualifié' }, slug: 'calificado', color: '#f39c12', probability: 15, isTerminal: false, transitionRules: [{ type: 'name_required' }, { type: 'phone_required' }, { type: 'min_score', value: 5 }] },
            { name: { es: 'Visita agendada', en: 'Viewing scheduled', pt: 'Visita agendada', fr: 'Visite programmée' }, slug: 'visita_agendada', color: '#e67e22', probability: 30, isTerminal: false, transitionRules: [{ type: 'appointment_required' }] },
            { name: { es: 'Propuesta enviada', en: 'Proposal sent', pt: 'Proposta enviada', fr: 'Proposition envoyée' }, slug: 'propuesta', color: '#9b59b6', probability: 50, isTerminal: false, transitionRules: [] },
            { name: { es: 'Negociación', en: 'Negotiation', pt: 'Negociação', fr: 'Négociation' }, slug: 'negociacion', color: '#e74c3c', probability: 70, isTerminal: false, transitionRules: [{ type: 'email_required' }] },
            { name: { es: 'Cerrado', en: 'Closed Won', pt: 'Fechado', fr: 'Conclu' }, slug: 'cerrado', color: '#2ecc71', probability: 100, isTerminal: true, transitionRules: [] },
            { name: { es: 'Perdido', en: 'Lost', pt: 'Perdido', fr: 'Perdu' }, slug: 'perdido', color: '#95a5a6', probability: 0, isTerminal: true, transitionRules: [] },
        ],
    },
    faqs: [
        { question: { es: '¿Qué propiedades tienen disponibles?', en: 'What properties do you have available?', pt: 'Quais imóveis têm disponíveis?', fr: 'Quels biens avez-vous disponibles?' }, answer: { es: 'Tenemos opciones en venta y arriendo. Cuéntame tu presupuesto, zona de interés y tipo de inmueble y te muestro las que mejor encajan.', en: 'We have options for sale and rent. Tell me your budget, area of interest and property type and I will show you the best matches.', pt: 'Temos opções para venda e aluguel. Me conte seu orçamento, zona de interesse e tipo de imóvel.', fr: 'Nous avons des options à la vente et à la location. Dites-moi votre budget, votre zone d\'intérêt et le type de bien.' }, category: 'propiedades' },
        { question: { es: '¿Cuál es la comisión?', en: 'What is the commission?', pt: 'Qual é a comissão?', fr: 'Quelle est la commission?' }, answer: { es: 'La comisión depende del tipo de operación. Te confirmo la cifra exacta antes de avanzar; si quieres, agendamos una reunión para revisarla con calma.', en: 'The commission depends on the type of transaction. I will confirm the exact figure before we move forward — we can schedule a meeting to go over it.', pt: 'A comissão depende do tipo de operação. Confirmo o valor exato antes de avançar; podemos agendar uma reunião para revisar.', fr: 'La commission dépend du type d\'opération. Je vous confirme le montant exact avant d\'aller plus loin; nous pouvons planifier une réunion.' }, category: 'costos' },
        { question: { es: '¿Ofrecen financiación?', en: 'Do you offer financing?', pt: 'Oferecem financiamento?', fr: 'Proposez-vous du financement?' }, answer: { es: 'Podemos orientarte sobre opciones de crédito hipotecario y contarte con qué entidades trabajamos. Agenda una asesoría y lo revisamos juntos.', en: 'We can walk you through mortgage options and tell you which lenders we work with. Schedule a consultation and we will go over it.', pt: 'Podemos orientar sobre opções de crédito imobiliário e contar com quais instituições trabalhamos. Agende uma assessoria.', fr: 'Nous pouvons vous orienter sur les options de crédit immobilier et vous dire avec quels organismes nous travaillons. Planifiez un conseil.' }, category: 'financiacion' },
        { question: { es: '¿Cómo agendo una visita?', en: 'How do I schedule a viewing?', pt: 'Como agendo uma visita?', fr: 'Comment planifier une visite?' }, answer: { es: 'Puedo agendar una visita para ti ahora mismo. Dime cuál propiedad te interesa y tus horarios disponibles.', en: 'I can schedule a viewing for you right now. Tell me which property interests you and your available times.', pt: 'Posso agendar uma visita agora mesmo. Me diga qual imóvel te interessa.', fr: 'Je peux planifier une visite maintenant. Dites-moi quel bien vous intéresse.' }, category: 'visitas' },
        { question: { es: '¿Qué documentos necesito?', en: 'What documents do I need?', pt: 'Quais documentos preciso?', fr: 'Quels documents sont nécessaires?' }, answer: { es: 'Depende de si compras o arriendas y de la entidad que participe. Cuéntame cuál es tu caso y un asesor te pasa la lista exacta de documentos.', en: 'It depends on whether you are buying or renting and on the institution involved. Tell me your case and an advisor will send you the exact list.', pt: 'Depende se você compra ou aluga e da instituição envolvida. Me conte seu caso e um consultor envia a lista exata.', fr: 'Cela dépend si vous achetez ou louez et de l\'organisme concerné. Dites-moi votre cas et un conseiller vous enverra la liste exacte.' }, category: 'documentos' },
    ],
    services: [
        { name: { es: 'Visita guiada', en: 'Guided viewing', pt: 'Visita guiada', fr: 'Visite guidée' }, description: { es: 'Recorrido por la propiedad con asesor', en: 'Property tour with advisor', pt: 'Visita ao imóvel com consultor', fr: 'Visite du bien avec conseiller' }, durationMinutes: 60, price: 0, currency: 'COP', category: 'visitas' },
        { name: { es: 'Asesoría hipotecaria', en: 'Mortgage consultation', pt: 'Assessoria de financiamento', fr: 'Conseil hypothécaire' }, description: { es: 'Orientación sobre crédito y financiación', en: 'Guidance on credit and financing', pt: 'Orientação sobre crédito e financiamento', fr: 'Orientation sur crédit et financement' }, durationMinutes: 45, price: 0, currency: 'COP', category: 'asesoria' },
        { name: { es: 'Avalúo comercial', en: 'Commercial appraisal', pt: 'Avaliação comercial', fr: 'Évaluation commerciale' }, description: { es: 'Valoración profesional del inmueble', en: 'Professional property valuation', pt: 'Avaliação profissional do imóvel', fr: 'Évaluation professionnelle du bien' }, durationMinutes: 120, price: 200000, currency: 'COP', category: 'valuacion' },
    ],
    businessHours: {
        schedule: { mon: '08:00-18:00', tue: '08:00-18:00', wed: '08:00-18:00', thu: '08:00-18:00', fri: '08:00-18:00', sat: '09:00-14:00' },
        afterHoursMessage: { es: 'Estamos fuera de horario. Déjanos tu consulta y un asesor te contactará al iniciar la jornada.', en: 'We are currently closed. Leave your inquiry and an advisor will contact you when we open.', pt: 'Estamos fora do horário. Deixe sua consulta e um consultor entrará em contato.', fr: 'Nous sommes fermés. Laissez votre demande et un conseiller vous contactera.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Interesados', en: 'Prospects', pt: 'Interessados', fr: 'Prospects' },
            pipeline: { es: 'Negociaciones', en: 'Deals', pt: 'Negociações', fr: 'Négociations' },
            catalog: { es: 'Propiedades', en: 'Properties', pt: 'Imóveis', fr: 'Biens' },
        },
        hiddenItems: [],
    },
    dashboard: {
        kpis: [
            { key: 'leadsToday', label: { es: 'Leads Hoy', en: 'Leads Today', pt: 'Leads Hoje', fr: 'Leads Aujourd\'hui' }, icon: 'UserPlus', color: '#3498db' },
            { key: 'appointmentsToday', label: { es: 'Visitas Hoy', en: 'Viewings Today', pt: 'Visitas Hoje', fr: 'Visites Aujourd\'hui' }, icon: 'MapPin', color: '#e67e22' },
            { key: 'leadsHot', label: { es: 'Leads Calientes', en: 'Hot Leads', pt: 'Leads Quentes', fr: 'Leads Chauds' }, icon: 'Flame', color: '#e74c3c' },
            { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
        ],
    },
    bookingEnabled: true,
};

// ─────────────────────────────────────────────────────────
// 4. RESTAURANTES
// ─────────────────────────────────────────────────────────
const RESTAURANTES: VerticalDefinition = {
    industry: 'restaurantes',
    subTypes: [
        { key: 'casual_dining', label: { es: 'Restaurante casual', en: 'Casual dining', pt: 'Restaurante casual', fr: 'Restaurant décontracté' } },
        { key: 'comida_rapida', label: { es: 'Comida rápida', en: 'Fast food', pt: 'Fast food', fr: 'Restauration rapide' } },
        { key: 'cafeteria', label: { es: 'Cafetería', en: 'Coffee shop', pt: 'Cafeteria', fr: 'Café' } },
        { key: 'dark_kitchen', label: { es: 'Dark kitchen / Delivery', en: 'Dark kitchen / Delivery', pt: 'Dark kitchen / Delivery', fr: 'Cuisine fantôme / Livraison' } },
    ],
    terminology: {
        customerNoun: { es: 'comensal', en: 'diner', pt: 'cliente', fr: 'convive' },
        customerNounPlural: { es: 'comensales', en: 'diners', pt: 'clientes', fr: 'convives' },
        transactionNoun: { es: 'reserva', en: 'reservation', pt: 'reserva', fr: 'réservation' },
        serviceNoun: { es: 'menú', en: 'menu', pt: 'cardápio', fr: 'menu' },
        pipelineNoun: { es: 'reservas', en: 'reservations', pt: 'reservas', fr: 'réservations' },
    },
    agent: {
        name: { es: 'Luca', en: 'Luca', pt: 'Luca', fr: 'Luca' },
        role: { es: 'Asistente del restaurante', en: 'Restaurant assistant', pt: 'Assistente do restaurante', fr: 'Assistant du restaurant' },
        tone: 'warm',
        formality: 'casual',
        greeting: { es: '¡Hola! Soy Luca, asistente del restaurante. ¿Te gustaría hacer una reserva o ver nuestro menú?', en: 'Hi! I\'m Luca, the restaurant assistant. Would you like to make a reservation or see our menu?', pt: 'Olá! Sou Luca, assistente do restaurante. Gostaria de fazer uma reserva ou ver nosso cardápio?', fr: 'Bonjour! Je suis Luca, assistant du restaurant. Souhaitez-vous réserver ou voir notre menu?' },
        rules: { es: 'Ofrece el menú del día y promociones. Confirma alergias alimentarias. Para grupos mayores a 8 personas, escala al equipo.', en: 'Offer daily menu and promotions. Confirm food allergies. For groups over 8, escalate to team.', pt: 'Ofereça o menu do dia e promoções. Confirme alergias alimentares.', fr: 'Proposez le menu du jour et promotions. Confirmez les allergies alimentaires.' },
        forbiddenTopics: { es: 'Información nutricional médica|Garantizar alérgenos al 100%|Precios de proveedores|Recetas de cocina', en: 'Medical nutritional info|Guarantee allergens 100%|Supplier prices|Kitchen recipes', pt: 'Informação nutricional médica|Garantir alérgenos|Preços de fornecedores', fr: 'Info nutritionnelle médicale|Garantir allergènes|Prix fournisseurs' },
        handoffTriggers: { es: 'grupo mayor a 8|evento privado|queja alimentaria|intoxicacion|facturacion especial', en: 'group over 8|private event|food complaint|food poisoning|special billing', pt: 'grupo maior que 8|evento privado|reclamacao alimentar', fr: 'groupe de plus de 8|evenement prive|plainte alimentaire' },
    },
    pipeline: {
        stages: [
            { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#e74c3c', probability: 10, isTerminal: false, transitionRules: [] },
            { name: { es: 'Reserva', en: 'Reserved', pt: 'Reserva', fr: 'Réservé' }, slug: 'reserva', color: '#f39c12', probability: 50, isTerminal: false, transitionRules: [{ type: 'appointment_required' }] },
            { name: { es: 'Confirmada', en: 'Confirmed', pt: 'Confirmada', fr: 'Confirmée' }, slug: 'confirmada', color: '#2ecc71', probability: 80, isTerminal: false, transitionRules: [{ type: 'name_required' }, { type: 'phone_required' }] },
            { name: { es: 'Completada', en: 'Completed', pt: 'Completada', fr: 'Terminée' }, slug: 'completada', color: '#27ae60', probability: 100, isTerminal: true, transitionRules: [] },
            { name: { es: 'No Show', en: 'No Show', pt: 'No Show', fr: 'Absent' }, slug: 'no_show', color: '#95a5a6', probability: 0, isTerminal: true, transitionRules: [] },
        ],
    },
    faqs: [
        { question: { es: '¿Cuál es el horario del restaurante?', en: 'What are your hours?', pt: 'Qual é o horário?', fr: 'Quels sont vos horaires?' }, answer: { es: 'Cuéntame qué día tienes en mente y te confirmo el horario. También puedo reservarte mesa ahora mismo.', en: 'Tell me which day you have in mind and I will confirm our hours. I can also book you a table right now.', pt: 'Me diga qual dia você tem em mente e confirmo o horário. Também posso reservar sua mesa agora.', fr: 'Dites-moi quel jour vous avez en tête et je vous confirme nos horaires. Je peux aussi réserver votre table.' }, category: 'general' },
        { question: { es: '¿Tienen opciones vegetarianas o para alergias?', en: 'Do you have vegetarian or allergy options?', pt: 'Tem opções vegetarianas ou para alergias?', fr: 'Avez-vous des options végétariennes ou pour allergies?' }, answer: { es: 'Indícanos tus restricciones al reservar y te confirmamos qué opciones tenemos disponibles ese día; la cocina las tiene en cuenta.', en: 'Tell us your restrictions when booking and we will confirm which options are available that day — the kitchen takes them into account.', pt: 'Conte suas restrições ao reservar e confirmamos quais opções há naquele dia; a cozinha leva em conta.', fr: 'Indiquez vos restrictions lors de la réservation et nous vous confirmerons les options disponibles ce jour-là.' }, category: 'menu' },
        { question: { es: '¿Hacen domicilios?', en: 'Do you deliver?', pt: 'Fazem entrega?', fr: 'Faites-vous la livraison?' }, answer: { es: 'Dime tu dirección y te confirmo si llegamos a tu zona. Para ver el menú y hacer tu pedido, escribe "quiero pedir".', en: 'Send me your address and I will confirm whether we deliver to your area. To see the menu and order, write "I want to order".', pt: 'Me diga seu endereço e confirmo se entregamos na sua região. Para ver o cardápio e pedir, escreva "quero pedir".', fr: 'Donnez-moi votre adresse et je vous confirme si nous livrons dans votre secteur.' }, category: 'delivery' },
        { question: { es: '¿Cómo hago una reserva?', en: 'How do I make a reservation?', pt: 'Como faço uma reserva?', fr: 'Comment réserver?' }, answer: { es: 'Puedo reservar tu mesa ahora. Dime para cuántas personas y la fecha y hora que prefieras.', en: 'I can book your table now. Tell me for how many, date and preferred time.', pt: 'Posso reservar sua mesa agora. Me diga para quantas pessoas, data e horário.', fr: 'Je peux réserver votre table maintenant. Combien de personnes, quelle date et quelle heure?' }, category: 'reservas' },
        { question: { es: '¿Cuál es el precio promedio por persona?', en: 'What is the average price per person?', pt: 'Qual é o preço médio por pessoa?', fr: 'Quel est le prix moyen par personne?' }, answer: { es: 'Depende de lo que pidas. Escribe "menú" y te muestro la carta con los precios vigentes.', en: 'It depends on your order. Write "menu" and I will show you the card with current prices.', pt: 'Depende do que você pedir. Escreva "cardápio" e mostro os preços vigentes.', fr: 'Cela dépend de votre commande. Écrivez "menu" et je vous montre la carte avec les prix en vigueur.' }, category: 'precios' },
    ],
    services: [
        { name: { es: 'Reserva mesa 2-4', en: 'Table 2-4', pt: 'Mesa 2-4', fr: 'Table 2-4' }, description: { es: 'Reserva para 2 a 4 personas', en: 'Reservation for 2 to 4 people', pt: 'Reserva para 2 a 4 pessoas', fr: 'Réservation pour 2 à 4 personnes' }, durationMinutes: 90, price: 0, currency: 'COP', category: 'reservas' },
        { name: { es: 'Reserva grupo 5-8', en: 'Group 5-8', pt: 'Grupo 5-8', fr: 'Groupe 5-8' }, description: { es: 'Reserva para grupo de 5 a 8 personas', en: 'Reservation for group of 5 to 8', pt: 'Reserva para grupo de 5 a 8 pessoas', fr: 'Réservation pour groupe de 5 à 8' }, durationMinutes: 120, price: 0, currency: 'COP', category: 'reservas' },
        { name: { es: 'Evento privado', en: 'Private event', pt: 'Evento privado', fr: 'Événement privé' }, description: { es: 'Evento privado con menú especial', en: 'Private event with special menu', pt: 'Evento privado com menu especial', fr: 'Événement privé avec menu spécial' }, durationMinutes: 240, price: 0, currency: 'COP', category: 'eventos' },
    ],
    businessHours: {
        schedule: { mon: '11:00-23:00', tue: '11:00-23:00', wed: '11:00-23:00', thu: '11:00-23:00', fri: '11:00-00:00', sat: '11:00-00:00', sun: '11:00-22:00' },
        afterHoursMessage: { es: 'El restaurante está cerrado. Puedes hacer tu reserva y te confirmaremos al abrir.', en: 'The restaurant is closed. You can make a reservation and we will confirm when we open.', pt: 'O restaurante está fechado. Faça sua reserva e confirmaremos quando abrirmos.', fr: 'Le restaurant est fermé. Réservez et nous confirmerons à l\'ouverture.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Comensales', en: 'Diners', pt: 'Clientes', fr: 'Convives' },
            pipeline: { es: 'Reservas', en: 'Reservations', pt: 'Reservas', fr: 'Réservations' },
            appointments: { es: 'Reservaciones', en: 'Bookings', pt: 'Reservas', fr: 'Réservations' },
        },
        hiddenItems: ['inventory', 'catalog', 'orders'],
    },
    dashboard: {
        kpis: [
            { key: 'appointmentsToday', label: { es: 'Reservas Hoy', en: 'Reservations Today', pt: 'Reservas Hoje', fr: 'Réservations Aujourd\'hui' }, icon: 'UtensilsCrossed', color: '#e74c3c' },
            { key: 'leadsToday', label: { es: 'Consultas Hoy', en: 'Inquiries Today', pt: 'Consultas Hoje', fr: 'Demandes Aujourd\'hui' }, icon: 'MessageSquare', color: '#3498db' },
            { key: 'noShowsWeek', label: { es: 'No Shows', en: 'No Shows', pt: 'Faltas', fr: 'Absences' }, icon: 'UserX', color: '#95a5a6' },
            { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
        ],
    },
    bookingEnabled: true,
};

// ─────────────────────────────────────────────────────────
// 5. AUTOMOTRIZ (Automotive)
// ─────────────────────────────────────────────────────────
const AUTOMOTRIZ: VerticalDefinition = {
    industry: 'automotriz',
    subTypes: [
        { key: 'concesionario', label: { es: 'Concesionario', en: 'Dealership', pt: 'Concessionária', fr: 'Concessionnaire' } },
        { key: 'taller', label: { es: 'Taller mecánico', en: 'Auto repair shop', pt: 'Oficina mecânica', fr: 'Atelier mécanique' } },
        { key: 'repuestos', label: { es: 'Repuestos y accesorios', en: 'Parts & accessories', pt: 'Peças e acessórios', fr: 'Pièces et accessoires' } },
        { key: 'alquiler', label: { es: 'Alquiler de vehículos', en: 'Car rental', pt: 'Aluguel de veículos', fr: 'Location de véhicules' } },
    ],
    terminology: {
        customerNoun: { es: 'cliente', en: 'customer', pt: 'cliente', fr: 'client' },
        customerNounPlural: { es: 'clientes', en: 'customers', pt: 'clientes', fr: 'clients' },
        transactionNoun: { es: 'negociación', en: 'deal', pt: 'negociação', fr: 'négociation' },
        serviceNoun: { es: 'vehículo', en: 'vehicle', pt: 'veículo', fr: 'véhicule' },
        pipelineNoun: { es: 'negociaciones', en: 'deals', pt: 'negociações', fr: 'négociations' },
    },
    agent: {
        name: { es: 'Marco', en: 'Marco', pt: 'Marco', fr: 'Marc' },
        role: { es: 'Asesor de ventas automotriz', en: 'Automotive sales advisor', pt: 'Consultor de vendas automotivo', fr: 'Conseiller commercial automobile' },
        tone: 'professional',
        formality: 'formal',
        greeting: { es: 'Hola, soy Marco, asesor automotriz. ¿Buscas un vehículo nuevo, usado o necesitas servicio de taller?', en: 'Hello, I\'m Marco, your automotive advisor. Looking for a new car, used, or need service?', pt: 'Olá, sou Marco, consultor automotivo. Procura um veículo novo, usado ou precisa de serviço?', fr: 'Bonjour, je suis Marc, votre conseiller automobile. Cherchez-vous un véhicule neuf, d\'occasion ou un service?' },
        rules: { es: 'Califica al cliente (presupuesto, tipo de vehículo, financiación, retoma). Ofrece agendar prueba de manejo. Nunca garantices aprobación de crédito.', en: 'Qualify the customer (budget, vehicle type, financing, trade-in). Offer test drives. Never guarantee credit approval.', pt: 'Qualifique o cliente (orçamento, tipo de veículo, financiamento). Ofereça test drive.', fr: 'Qualifiez le client (budget, type de véhicule, financement). Proposez un essai routier.' },
        forbiddenTopics: { es: 'Garantizar aprobación de crédito|Precios de costo|Diagnóstico mecánico sin revisión|Garantías no autorizadas', en: 'Guarantee credit approval|Cost prices|Mechanical diagnosis without inspection|Unauthorized warranties', pt: 'Garantir aprovação de crédito|Preços de custo|Diagnóstico sem revisão', fr: 'Garantir approbation de crédit|Prix de revient|Diagnostic sans inspection' },
        // Sin "prueba de manejo" como trigger: el bootstrap siembra servicio +
        // slots + FAQ para AUTOMATIZAR el test drive, y el matcheo por substring
        // corre ANTES del booking engine — con la frase acá, la conversión
        // central del rubro escalaba a humano siempre y la automatización
        // sembrada jamás llegaba a ejecutarse.
        handoffTriggers: { es: 'financiacion aprobada|reclamo de garantia|accidente|negociacion final de precio', en: 'financing approved|warranty claim|accident|final price negotiation', pt: 'financiamento aprovado|reclamacao de garantia', fr: 'financement approuve|reclamation garantie' },
    },
    pipeline: {
        stages: [
            { name: { es: 'Lead', en: 'Lead', pt: 'Lead', fr: 'Lead' }, slug: 'lead', color: '#3498db', probability: 5, isTerminal: false, transitionRules: [] },
            { name: { es: 'Contactado', en: 'Contacted', pt: 'Contatado', fr: 'Contacté' }, slug: 'contactado', color: '#f39c12', probability: 15, isTerminal: false, transitionRules: [{ type: 'name_required' }, { type: 'phone_required' }] },
            { name: { es: 'Test Drive', en: 'Test Drive', pt: 'Test Drive', fr: 'Essai' }, slug: 'test_drive', color: '#e67e22', probability: 35, isTerminal: false, transitionRules: [{ type: 'appointment_required' }] },
            { name: { es: 'Cotización', en: 'Quote', pt: 'Cotação', fr: 'Devis' }, slug: 'cotizacion', color: '#9b59b6', probability: 50, isTerminal: false, transitionRules: [] },
            { name: { es: 'Financiación', en: 'Financing', pt: 'Financiamento', fr: 'Financement' }, slug: 'financiacion', color: '#e74c3c', probability: 70, isTerminal: false, transitionRules: [{ type: 'email_required' }] },
            { name: { es: 'Entregado', en: 'Delivered', pt: 'Entregue', fr: 'Livré' }, slug: 'entregado', color: '#2ecc71', probability: 100, isTerminal: true, transitionRules: [] },
            { name: { es: 'Perdido', en: 'Lost', pt: 'Perdido', fr: 'Perdu' }, slug: 'perdido', color: '#95a5a6', probability: 0, isTerminal: true, transitionRules: [] },
        ],
    },
    faqs: [
        { question: { es: '¿Qué vehículos tienen disponibles?', en: 'What vehicles do you have?', pt: 'Quais veículos têm disponíveis?', fr: 'Quels véhicules avez-vous?' }, answer: { es: 'Tenemos vehículos nuevos y usados. Cuéntame tu presupuesto y el tipo de vehículo que buscas y te muestro las mejores opciones.', en: 'We have new and used vehicles. Tell me your budget and the type you are after and I will show you the best options.', pt: 'Temos veículos novos e usados. Me conte seu orçamento e o tipo que procura.', fr: 'Nous avons des véhicules neufs et d\'occasion. Dites-moi votre budget et le type recherché.' }, category: 'inventario' },
        { question: { es: '¿Ofrecen financiación?', en: 'Do you offer financing?', pt: 'Oferecem financiamento?', fr: 'Proposez-vous du financement?' }, answer: { es: 'Podemos revisar contigo las opciones de financiación disponibles y con qué entidades trabajamos. Cuéntame qué necesitas y un asesor te acompaña.', en: 'We can go through the available financing options with you and tell you which lenders we work with. Tell me what you need and an advisor will help.', pt: 'Podemos ver com você as opções de financiamento disponíveis e com quais instituições trabalhamos.', fr: 'Nous pouvons examiner avec vous les options de financement disponibles et les organismes partenaires.' }, category: 'financiacion' },
        { question: { es: '¿Puedo agendar una prueba de manejo?', en: 'Can I schedule a test drive?', pt: 'Posso agendar um test drive?', fr: 'Puis-je planifier un essai?' }, answer: { es: '¡Claro! Puedo agendar tu prueba de manejo ahora. Dime qué vehículo te interesa y tu horario disponible.', en: 'Of course! I can schedule your test drive now. Tell me which vehicle and your availability.', pt: 'Claro! Posso agendar seu test drive agora. Me diga qual veículo e seu horário.', fr: 'Bien sûr! Je peux planifier votre essai. Quel véhicule et quelle disponibilité?' }, category: 'test_drive' },
        { question: { es: '¿Aceptan vehículo como parte de pago?', en: 'Do you accept trade-ins?', pt: 'Aceitam veículo como entrada?', fr: 'Acceptez-vous les reprises?' }, answer: { es: 'Cuéntanos qué vehículo tienes y te confirmamos si lo recibimos como parte de pago y cómo sería la evaluación.', en: 'Tell us about your current vehicle and we will confirm whether we take trade-ins and how the evaluation works.', pt: 'Conte-nos qual veículo você tem e confirmamos se aceitamos como entrada e como funciona a avaliação.', fr: 'Dites-nous quel véhicule vous avez et nous confirmerons si nous acceptons la reprise et comment se déroule l\'évaluation.' }, category: 'retoma' },
        { question: { es: '¿Qué garantía ofrecen?', en: 'What warranty do you offer?', pt: 'Que garantia oferecem?', fr: 'Quelle garantie proposez-vous?' }, answer: { es: 'La garantía depende del vehículo y de si es nuevo o usado. Dime cuál te interesa y te confirmo exactamente qué cubre.', en: 'The warranty depends on the vehicle and whether it is new or used. Tell me which one you are looking at and I will confirm exactly what it covers.', pt: 'A garantia depende do veículo e de ser novo ou usado. Me diga qual te interessa e confirmo o que cobre.', fr: 'La garantie dépend du véhicule et s\'il est neuf ou d\'occasion. Dites-moi lequel vous intéresse et je vous confirme sa couverture.' }, category: 'garantia' },
    ],
    services: [
        { name: { es: 'Prueba de manejo', en: 'Test drive', pt: 'Test drive', fr: 'Essai routier' }, description: { es: 'Prueba de manejo del vehículo de tu interés', en: 'Test drive the vehicle of your interest', pt: 'Test drive do veículo de seu interesse', fr: 'Essai du véhicule de votre choix' }, durationMinutes: 30, price: 0, currency: 'COP', category: 'ventas' },
        { name: { es: 'Revisión mecánica', en: 'Mechanical inspection', pt: 'Revisão mecânica', fr: 'Inspection mécanique' }, description: { es: 'Revisión general del estado del vehículo', en: 'General vehicle condition inspection', pt: 'Revisão geral do estado do veículo', fr: 'Inspection générale du véhicule' }, durationMinutes: 60, price: 80000, currency: 'COP', category: 'taller' },
        { name: { es: 'Cotización personalizada', en: 'Custom quote', pt: 'Cotação personalizada', fr: 'Devis personnalisé' }, description: { es: 'Cotización detallada con opciones de financiación', en: 'Detailed quote with financing options', pt: 'Cotação detalhada com opções de financiamento', fr: 'Devis détaillé avec options de financement' }, durationMinutes: 45, price: 0, currency: 'COP', category: 'ventas' },
    ],
    businessHours: {
        schedule: { mon: '08:00-18:00', tue: '08:00-18:00', wed: '08:00-18:00', thu: '08:00-18:00', fri: '08:00-18:00', sat: '09:00-15:00' },
        afterHoursMessage: { es: 'Estamos fuera de horario. Déjanos tu consulta y un asesor te contactará al iniciar la jornada.', en: 'We are closed. Leave your inquiry and an advisor will contact you.', pt: 'Estamos fora do horário. Deixe sua consulta.', fr: 'Nous sommes fermés. Laissez votre demande.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Clientes', en: 'Customers', pt: 'Clientes', fr: 'Clients' },
            pipeline: { es: 'Negociaciones', en: 'Deals', pt: 'Negociações', fr: 'Négociations' },
            catalog: { es: 'Vehículos', en: 'Vehicles', pt: 'Veículos', fr: 'Véhicules' },
        },
        hiddenItems: [],
    },
    dashboard: {
        kpis: [
            { key: 'leadsToday', label: { es: 'Leads Hoy', en: 'Leads Today', pt: 'Leads Hoje', fr: 'Leads Aujourd\'hui' }, icon: 'UserPlus', color: '#3498db' },
            { key: 'appointmentsToday', label: { es: 'Test Drives Hoy', en: 'Test Drives Today', pt: 'Test Drives Hoje', fr: 'Essais Aujourd\'hui' }, icon: 'Car', color: '#e67e22' },
            { key: 'leadsHot', label: { es: 'Leads Calientes', en: 'Hot Leads', pt: 'Leads Quentes', fr: 'Leads Chauds' }, icon: 'Flame', color: '#e74c3c' },
            { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
        ],
    },
    bookingEnabled: true,
};

// ─────────────────────────────────────────────────────────
// 6-12: Remaining verticals (Tier 2 + Generic)
// ─────────────────────────────────────────────────────────

const TURISMO: VerticalDefinition = {
    industry: 'turismo',
    subTypes: [
        { key: 'agencia_viajes', label: { es: 'Agencia de viajes', en: 'Travel agency', pt: 'Agência de viagens', fr: 'Agence de voyages' } },
        { key: 'hotel', label: { es: 'Hotel / Hostal', en: 'Hotel / Hostel', pt: 'Hotel / Hostel', fr: 'Hôtel / Auberge' } },
        { key: 'tours', label: { es: 'Tours y actividades', en: 'Tours & activities', pt: 'Tours e atividades', fr: 'Tours et activités' } },
        { key: 'alquiler_vacacional', label: { es: 'Alquiler vacacional', en: 'Vacation rental', pt: 'Aluguel por temporada', fr: 'Location vacances' } },
    ],
    terminology: { customerNoun: { es: 'viajero', en: 'traveler', pt: 'viajante', fr: 'voyageur' }, customerNounPlural: { es: 'viajeros', en: 'travelers', pt: 'viajantes', fr: 'voyageurs' }, transactionNoun: { es: 'reserva', en: 'booking', pt: 'reserva', fr: 'réservation' }, serviceNoun: { es: 'paquete', en: 'package', pt: 'pacote', fr: 'forfait' }, pipelineNoun: { es: 'reservas', en: 'bookings', pt: 'reservas', fr: 'réservations' } },
    agent: { name: { es: 'Maya', en: 'Maya', pt: 'Maya', fr: 'Maya' }, role: { es: 'Asesora de viajes', en: 'Travel advisor', pt: 'Consultora de viagens', fr: 'Conseillère de voyages' }, tone: 'enthusiastic', formality: 'casual', greeting: { es: '¡Hola! Soy Maya, tu asesora de viajes. ¿A dónde te gustaría ir?', en: 'Hi! I\'m Maya, your travel advisor. Where would you like to go?', pt: 'Olá! Sou Maya, sua consultora de viagens. Para onde gostaria de ir?', fr: 'Bonjour! Je suis Maya, votre conseillère de voyages. Où souhaitez-vous aller?' }, rules: { es: 'Inspira al viajero con destinos. Cotiza paquetes. Para grupos >10, escala.', en: 'Inspire the traveler with destinations. Quote packages. For groups >10, escalate.', pt: 'Inspire o viajante com destinos. Cote pacotes.', fr: 'Inspirez le voyageur. Cotez les forfaits.' }, forbiddenTopics: { es: 'Información migratoria oficial|Vacunas requeridas|Garantizar clima', en: 'Official immigration info|Required vaccines|Guarantee weather', pt: 'Informação migratória oficial|Vacinas requeridas', fr: 'Info migratoire officielle|Vaccins requis' }, handoffTriggers: { es: 'grupo >10|viaje corporativo|reclamacion de seguro|emergencia en destino', en: 'group >10|corporate travel|insurance claim|emergency at destination', pt: 'grupo >10|viagem corporativa|reclamacao de seguro', fr: 'groupe >10|voyage d\'affaires|reclamation assurance' } },
    pipeline: { stages: [
        { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#1abc9c', probability: 10, isTerminal: false, transitionRules: [] },
        { name: { es: 'Cotización', en: 'Quote', pt: 'Cotação', fr: 'Devis' }, slug: 'cotizacion', color: '#3498db', probability: 30, isTerminal: false, transitionRules: [] },
        { name: { es: 'Reserva', en: 'Booked', pt: 'Reservado', fr: 'Réservé' }, slug: 'reserva', color: '#f39c12', probability: 60, isTerminal: false, transitionRules: [{ type: 'appointment_required' }] },
        { name: { es: 'Confirmado', en: 'Confirmed', pt: 'Confirmado', fr: 'Confirmé' }, slug: 'confirmado', color: '#2ecc71', probability: 90, isTerminal: false, transitionRules: [{ type: 'name_required' }, { type: 'phone_required' }] },
        { name: { es: 'Completado', en: 'Traveled', pt: 'Viajou', fr: 'Voyage effectué' }, slug: 'completado', color: '#27ae60', probability: 100, isTerminal: true, transitionRules: [] },
        { name: { es: 'Cancelado', en: 'Cancelled', pt: 'Cancelado', fr: 'Annulé' }, slug: 'cancelado', color: '#95a5a6', probability: 0, isTerminal: true, transitionRules: [] },
    ] },
    faqs: [
        { question: { es: '¿Qué destinos manejan?', en: 'What destinations do you cover?', pt: 'Quais destinos cobrem?', fr: 'Quelles destinations couvrez-vous?' }, answer: { es: 'Cuéntame a dónde te gustaría ir y te confirmo si trabajamos ese destino. Con eso armamos tu plan a medida.', en: 'Tell me where you would like to go and I will confirm whether we cover that destination. From there we build your plan.', pt: 'Me conte para onde gostaria de ir e confirmo se atendemos esse destino. A partir daí montamos seu plano.', fr: 'Dites-moi où vous aimeriez aller et je vous confirme si nous couvrons cette destination.' }, category: 'destinos' },
        { question: { es: '¿Qué incluye el paquete?', en: 'What\'s included?', pt: 'O que inclui o pacote?', fr: 'Qu\'est-ce qui est inclus?' }, answer: { es: 'Cada paquete es distinto. Cuéntame cuál te interesa y te detallo exactamente qué incluye antes de cotizar.', en: 'Every package is different. Tell me which one you have in mind and I will spell out exactly what it includes before quoting.', pt: 'Cada pacote é diferente. Me conte qual te interessa e detalho exatamente o que inclui antes de cotar.', fr: 'Chaque forfait est différent. Dites-moi lequel vous intéresse et je détaillerai ce qu\'il comprend avant le devis.' }, category: 'paquetes' },
        { question: { es: '¿Cuál es la política de cancelación?', en: 'What\'s the cancellation policy?', pt: 'Qual é a política de cancelamento?', fr: 'Quelle est la politique d\'annulation?' }, answer: { es: 'Depende del paquete y de los proveedores involucrados. Te confirmamos las condiciones exactas antes de que reserves.', en: 'It depends on the package and the providers involved. We will confirm the exact terms before you book.', pt: 'Depende do pacote e dos fornecedores envolvidos. Confirmamos as condições exatas antes de você reservar.', fr: 'Cela dépend du forfait et des prestataires. Nous vous confirmerons les conditions exactes avant la réservation.' }, category: 'politicas' },
        { question: { es: '¿Necesito seguro de viaje?', en: 'Do I need travel insurance?', pt: 'Preciso de seguro viagem?', fr: 'Ai-je besoin d\'une assurance voyage?' }, answer: { es: 'Siempre recomendamos viajar con seguro. Pregúntanos y te contamos qué opciones podemos incluir en tu plan.', en: 'We always recommend travelling with insurance. Ask us and we will tell you which options we can include in your plan.', pt: 'Sempre recomendamos viajar com seguro. Pergunte e contamos quais opções podemos incluir no seu plano.', fr: 'Nous recommandons toujours de voyager assuré. Demandez-nous quelles options nous pouvons inclure.' }, category: 'seguros' },
        { question: { es: '¿Qué documentos necesito para viajar?', en: 'What documents do I need?', pt: 'Quais documentos preciso?', fr: 'Quels documents sont nécessaires?' }, answer: { es: 'Depende del destino: en viajes nacionales suele bastar tu documento de identidad y en internacionales se pide pasaporte vigente, a veces con visa. Dinos el destino y te orientamos con lo que exige.', en: 'It depends on the destination: domestic trips usually need ID, international ones a valid passport and sometimes a visa. Tell us where you are going and we will guide you.', pt: 'Depende do destino: viagens nacionais normalmente exigem documento de identidade; internacionais, passaporte válido e às vezes visto. Diga-nos o destino e orientamos.', fr: 'Cela dépend de la destination: en national, une pièce d\'identité; en international, un passeport valide et parfois un visa. Dites-nous où vous allez.' }, category: 'documentos' },
    ],
    services: [
        { name: { es: 'Tour día completo', en: 'Full day tour', pt: 'Tour dia inteiro', fr: 'Tour journée complète' }, description: { es: 'Tour guiado de día completo', en: 'Full day guided tour', pt: 'Tour guiado de dia inteiro', fr: 'Tour guidé journée complète' }, durationMinutes: 480, price: 300000, currency: 'COP', category: 'tours' },
        { name: { es: 'Paquete fin de semana', en: 'Weekend package', pt: 'Pacote fim de semana', fr: 'Forfait week-end' }, description: { es: 'Paquete todo incluido fin de semana', en: 'All-inclusive weekend package', pt: 'Pacote tudo incluído fim de semana', fr: 'Forfait tout inclus week-end' }, durationMinutes: 0, price: 800000, currency: 'COP', category: 'paquetes' },
        { name: { es: 'Excursión medio día', en: 'Half day excursion', pt: 'Excursão meio dia', fr: 'Excursion demi-journée' }, description: { es: 'Excursión de medio día con transporte', en: 'Half day excursion with transport', pt: 'Excursão meio dia com transporte', fr: 'Excursion demi-journée avec transport' }, durationMinutes: 240, price: 150000, currency: 'COP', category: 'tours' },
    ],
    businessHours: { schedule: { mon: '08:00-19:00', tue: '08:00-19:00', wed: '08:00-19:00', thu: '08:00-19:00', fri: '08:00-19:00', sat: '09:00-16:00' }, afterHoursMessage: { es: 'Estamos fuera de horario. Te responderemos al iniciar la jornada.', en: 'We are closed. We\'ll respond when we open.', pt: 'Estamos fora do horário.', fr: 'Nous sommes fermés.' } },
    sidebar: { labelOverrides: { crm: { es: 'Viajeros', en: 'Travelers', pt: 'Viajantes', fr: 'Voyageurs' }, pipeline: { es: 'Reservas', en: 'Bookings', pt: 'Reservas', fr: 'Réservations' }, appointments: { es: 'Itinerarios', en: 'Itineraries', pt: 'Itinerários', fr: 'Itinéraires' } }, hiddenItems: [] },
    dashboard: { kpis: [
        { key: 'leadsToday', label: { es: 'Consultas Hoy', en: 'Inquiries Today', pt: 'Consultas Hoje', fr: 'Demandes Aujourd\'hui' }, icon: 'Plane', color: '#1abc9c' },
        { key: 'appointmentsToday', label: { es: 'Reservas Confirmadas', en: 'Confirmed Bookings', pt: 'Reservas Confirmadas', fr: 'Réservations Confirmées' }, icon: 'Calendar', color: '#3498db' },
        { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
        { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Coût IA' }, icon: 'DollarSign', color: '#e67e22' },
    ] },
    bookingEnabled: true,
    deferred: false,
};

// Simplified definitions for Tier 2 verticals (same structure, less detail in FAQs)
const EDUCATION: VerticalDefinition = {
    industry: 'education',
    subTypes: [
        { key: 'idiomas', label: { es: 'Escuela de idiomas', en: 'Language school', pt: 'Escola de idiomas', fr: 'École de langues' } },
        { key: 'universitaria', label: { es: 'Universidad / Instituto', en: 'University / College', pt: 'Universidade / Instituto', fr: 'Université / Institut' } },
        { key: 'online', label: { es: 'Cursos online', en: 'Online courses', pt: 'Cursos online', fr: 'Cours en ligne' } },
        { key: 'capacitacion', label: { es: 'Capacitación empresarial', en: 'Corporate training', pt: 'Treinamento empresarial', fr: 'Formation entreprise' } },
    ],
    terminology: { customerNoun: { es: 'estudiante', en: 'student', pt: 'estudante', fr: 'étudiant' }, customerNounPlural: { es: 'estudiantes', en: 'students', pt: 'estudantes', fr: 'étudiants' }, transactionNoun: { es: 'matrícula', en: 'enrollment', pt: 'matrícula', fr: 'inscription' }, serviceNoun: { es: 'curso', en: 'course', pt: 'curso', fr: 'cours' }, pipelineNoun: { es: 'inscripciones', en: 'enrollments', pt: 'inscrições', fr: 'inscriptions' } },
    agent: { name: { es: 'Pablo', en: 'Pablo', pt: 'Paulo', fr: 'Paul' }, role: { es: 'Asesor académico', en: 'Academic advisor', pt: 'Orientador acadêmico', fr: 'Conseiller académique' }, tone: 'encouraging', formality: 'semi-formal', greeting: { es: '¡Hola! Soy Pablo, asesor académico. ¿En qué programa o curso estás interesado?', en: 'Hi! I\'m Pablo, your academic advisor. What program or course interests you?', pt: 'Olá! Sou Paulo, orientador acadêmico. Qual programa ou curso te interessa?', fr: 'Bonjour! Je suis Paul, conseiller académique. Quel programme vous intéresse?' }, rules: { es: 'Informa sobre programas, horarios y costos. Ofrece test de nivel si aplica. Nunca prometas becas sin autorización.', en: 'Inform about programs, schedules and costs. Offer placement test. Never promise scholarships.', pt: 'Informe sobre programas, horários e custos. Ofereça teste de nível.', fr: 'Informez sur les programmes, horaires et coûts. Proposez un test de niveau.' }, forbiddenTopics: { es: 'Calificaciones de otros estudiantes|Contenido de exámenes|Becas no autorizadas|Credenciales falsas', en: 'Other students grades|Exam content|Unauthorized scholarships|False credentials', pt: 'Notas de outros estudantes|Conteúdo de provas|Bolsas não autorizadas', fr: 'Notes d\'autres étudiants|Contenu d\'examens|Bourses non autorisées' }, handoffTriggers: { es: 'solicitud de beca|homologacion|queja academica|reembolso|convalidacion', en: 'scholarship request|credit transfer|academic complaint|refund', pt: 'solicitacao de bolsa|transferencia|reclamacao', fr: 'demande de bourse|transfert|plainte academique' } },
    pipeline: { stages: [
        { name: { es: 'Interesado', en: 'Interested', pt: 'Interessado', fr: 'Intéressé' }, slug: 'interesado', color: '#3498db', probability: 10, isTerminal: false, transitionRules: [] },
        { name: { es: 'Info enviada', en: 'Info sent', pt: 'Info enviada', fr: 'Info envoyée' }, slug: 'info_enviada', color: '#f39c12', probability: 25, isTerminal: false, transitionRules: [{ type: 'email_required' }] },
        { name: { es: 'Inscrito', en: 'Enrolled', pt: 'Inscrito', fr: 'Inscrit' }, slug: 'inscrito', color: '#e67e22', probability: 60, isTerminal: false, transitionRules: [{ type: 'name_required' }, { type: 'phone_required' }] },
        { name: { es: 'Activo', en: 'Active', pt: 'Ativo', fr: 'Actif' }, slug: 'activo', color: '#2ecc71', probability: 90, isTerminal: false, transitionRules: [] },
        { name: { es: 'Completado', en: 'Completed', pt: 'Completado', fr: 'Complété' }, slug: 'completado', color: '#27ae60', probability: 100, isTerminal: true, transitionRules: [] },
        { name: { es: 'Deserción', en: 'Dropped', pt: 'Desistência', fr: 'Abandon' }, slug: 'desercion', color: '#95a5a6', probability: 0, isTerminal: true, transitionRules: [] },
    ] },
    faqs: [
        { question: { es: '¿Qué programas ofrecen?', en: 'What programs do you offer?', pt: 'Quais programas oferecem?', fr: 'Quels programmes proposez-vous?' }, answer: { es: 'Cuéntame qué área te interesa y te doy la información detallada de los programas disponibles.', en: 'Tell me your area of interest and I will give you detailed information on the available programs.', pt: 'Me conte qual área te interessa e passo a informação detalhada dos programas disponíveis.', fr: 'Dites-moi votre domaine d\'intérêt et je vous donnerai le détail des programmes disponibles.' }, category: 'programas' },
        { question: { es: '¿Cuánto cuesta?', en: 'How much does it cost?', pt: 'Quanto custa?', fr: 'Combien ça coûte?' }, answer: { es: 'Los costos varían según el programa. Cuéntame cuál te interesa y te envío la información detallada junto con las formas de pago disponibles.', en: 'Costs vary by program. Tell me which one interests you and I will send the details along with the available payment options.', pt: 'Os custos variam por programa. Me diga qual te interessa e envio os detalhes junto com as formas de pagamento disponíveis.', fr: 'Les coûts varient selon le programme. Dites-moi lequel vous intéresse et je vous enverrai le détail avec les modalités de paiement.' }, category: 'costos' },
        { question: { es: '¿Cuáles son los horarios?', en: 'What are the schedules?', pt: 'Quais são os horários?', fr: 'Quels sont les horaires?' }, answer: { es: 'Cuéntame qué horario te conviene (mañana, tarde, noche o fin de semana) y te confirmo qué opciones hay abiertas para ese programa.', en: 'Tell me which schedule suits you (morning, afternoon, evening or weekend) and I will confirm what is open for that program.', pt: 'Me diga qual horário te convém (manhã, tarde, noite ou fim de semana) e confirmo quais opções estão abertas.', fr: 'Dites-moi quel horaire vous convient (matin, après-midi, soir ou week-end) et je vous confirme les options ouvertes.' }, category: 'horarios' },
        { question: { es: '¿Qué requisitos de admisión hay?', en: 'What are the admission requirements?', pt: 'Quais são os requisitos de admissão?', fr: 'Quelles sont les conditions d\'admission?' }, answer: { es: 'Los requisitos dependen del programa. Dime cuál te interesa y te paso la lista exacta de lo que se pide.', en: 'Requirements depend on the program. Tell me which one interests you and I will send you the exact list.', pt: 'Os requisitos dependem do programa. Me diga qual te interessa e envio a lista exata.', fr: 'Les conditions dépendent du programme. Dites-moi lequel vous intéresse et je vous envoie la liste exacte.' }, category: 'admision' },
        { question: { es: '¿Ofrecen certificación?', en: 'Do you offer certification?', pt: 'Oferecem certificação?', fr: 'Proposez-vous une certification?' }, answer: { es: 'Cuéntame qué programa te interesa y te confirmo qué certificado entrega y con qué alcance.', en: 'Tell me which program you are interested in and I will confirm which certificate it awards and its scope.', pt: 'Me diga qual programa te interessa e confirmo qual certificado entrega e com que alcance.', fr: 'Dites-moi quel programme vous intéresse et je vous confirme quel certificat il délivre.' }, category: 'certificacion' },
    ],
    services: [
        { name: { es: 'Clase de prueba', en: 'Trial class', pt: 'Aula experimental', fr: 'Cours d\'essai' }, description: { es: 'Clase de prueba gratuita', en: 'Free trial class', pt: 'Aula experimental gratuita', fr: 'Cours d\'essai gratuit' }, durationMinutes: 60, price: 0, currency: 'COP', category: 'prueba' },
        { name: { es: 'Tutoría personalizada', en: 'Personal tutoring', pt: 'Tutoria personalizada', fr: 'Tutorat personnalisé' }, description: { es: 'Sesión de tutoría individual', en: 'Individual tutoring session', pt: 'Sessão de tutoria individual', fr: 'Séance de tutorat individuel' }, durationMinutes: 60, price: 80000, currency: 'COP', category: 'tutoria' },
        { name: { es: 'Test de nivel', en: 'Placement test', pt: 'Teste de nível', fr: 'Test de niveau' }, description: { es: 'Evaluación de nivel para ubicación', en: 'Level assessment for placement', pt: 'Avaliação de nível para classificação', fr: 'Évaluation de niveau pour le placement' }, durationMinutes: 30, price: 0, currency: 'COP', category: 'evaluacion' },
    ],
    businessHours: { schedule: { mon: '07:00-20:00', tue: '07:00-20:00', wed: '07:00-20:00', thu: '07:00-20:00', fri: '07:00-20:00', sat: '08:00-14:00' }, afterHoursMessage: { es: 'Estamos fuera de horario. Te responderemos al iniciar la jornada.', en: 'We are closed. We\'ll respond when we open.', pt: 'Estamos fora do horário.', fr: 'Nous sommes fermés.' } },
    sidebar: { labelOverrides: { crm: { es: 'Estudiantes', en: 'Students', pt: 'Estudantes', fr: 'Étudiants' }, pipeline: { es: 'Inscripciones', en: 'Enrollments', pt: 'Inscrições', fr: 'Inscriptions' } }, hiddenItems: [] },
    dashboard: { kpis: [
        { key: 'leadsToday', label: { es: 'Interesados Hoy', en: 'Inquiries Today', pt: 'Interessados Hoje', fr: 'Intéressés Aujourd\'hui' }, icon: 'UserPlus', color: '#3498db' },
        { key: 'appointmentsToday', label: { es: 'Matrículas Hoy', en: 'Enrollments Today', pt: 'Matrículas Hoje', fr: 'Inscriptions Aujourd\'hui' }, icon: 'GraduationCap', color: '#2ecc71' },
        { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
        { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Coût IA' }, icon: 'DollarSign', color: '#e67e22' },
    ] },
    bookingEnabled: true,
};

// Generic fallbacks for verticals with simpler needs
function createGenericVertical(industry: string, config: Partial<VerticalDefinition>): VerticalDefinition {
    const defaults: VerticalDefinition = {
        industry,
        subTypes: [],
        terminology: { customerNoun: { es: 'cliente', en: 'customer', pt: 'cliente', fr: 'client' }, customerNounPlural: { es: 'clientes', en: 'customers', pt: 'clientes', fr: 'clients' }, transactionNoun: { es: 'venta', en: 'sale', pt: 'venda', fr: 'vente' }, serviceNoun: { es: 'servicio', en: 'service', pt: 'serviço', fr: 'service' }, pipelineNoun: { es: 'ventas', en: 'sales', pt: 'vendas', fr: 'ventes' } },
        agent: { name: { es: 'Asistente', en: 'Assistant', pt: 'Assistente', fr: 'Assistant' }, role: { es: 'Asistente virtual de atención al cliente', en: 'Virtual customer service assistant', pt: 'Assistente virtual de atendimento', fr: 'Assistant virtuel service client' }, tone: 'professional', formality: 'semi-formal', greeting: { es: '¡Hola! ¿En qué puedo ayudarte hoy?', en: 'Hello! How can I help you today?', pt: 'Olá! Como posso ajudar?', fr: 'Bonjour! Comment puis-je vous aider?' }, rules: { es: 'Responde de forma profesional y concisa. Ofrece agendar reuniones cuando sea pertinente.', en: 'Respond professionally and concisely. Offer to schedule meetings when appropriate.', pt: 'Responda profissionalmente. Ofereça agendar reuniões quando pertinente.', fr: 'Répondez professionnellement. Proposez des rendez-vous si pertinent.' }, forbiddenTopics: { es: '', en: '', pt: '', fr: '' }, handoffTriggers: { es: 'queja formal|emergencia|solicitud de reembolso', en: 'formal complaint|emergency|refund request', pt: 'reclamacao formal|emergencia|reembolso', fr: 'plainte formelle|urgence|remboursement' } },
        pipeline: { stages: [
            { name: { es: 'Nuevo', en: 'New', pt: 'Novo', fr: 'Nouveau' }, slug: 'nuevo', color: '#3498db', probability: 10, isTerminal: false, transitionRules: [] },
            { name: { es: 'Contactado', en: 'Contacted', pt: 'Contatado', fr: 'Contacté' }, slug: 'contactado', color: '#f39c12', probability: 25, isTerminal: false, transitionRules: [{ type: 'phone_required' }] },
            { name: { es: 'Calificado', en: 'Qualified', pt: 'Qualificado', fr: 'Qualifié' }, slug: 'calificado', color: '#e67e22', probability: 40, isTerminal: false, transitionRules: [{ type: 'name_required' }] },
            { name: { es: 'Propuesta', en: 'Proposal', pt: 'Proposta', fr: 'Proposition' }, slug: 'propuesta', color: '#9b59b6', probability: 60, isTerminal: false, transitionRules: [{ type: 'offer_required' }] },
            { name: { es: 'Cerrado ganado', en: 'Closed Won', pt: 'Fechado ganho', fr: 'Conclu gagné' }, slug: 'cerrado_ganado', color: '#2ecc71', probability: 100, isTerminal: true, transitionRules: [] },
            { name: { es: 'Cerrado perdido', en: 'Closed Lost', pt: 'Fechado perdido', fr: 'Conclu perdu' }, slug: 'cerrado_perdido', color: '#95a5a6', probability: 0, isTerminal: true, transitionRules: [] },
        ] },
        faqs: [
            { question: { es: '¿Cuál es el horario de atención?', en: 'What are your hours?', pt: 'Qual é o horário?', fr: 'Quels sont vos horaires?' }, answer: { es: 'Cuéntame qué día te sirve y te confirmo nuestro horario de atención. Escríbenos y te respondemos.', en: 'Tell me which day works for you and I will confirm our opening hours. Write to us any time.', pt: 'Me diga qual dia lhe serve e confirmo nosso horário de atendimento.', fr: 'Dites-moi quel jour vous convient et je vous confirme nos horaires.' }, category: 'general' },
            { question: { es: '¿Cuáles son los métodos de pago?', en: 'What payment methods?', pt: 'Quais formas de pagamento?', fr: 'Quels modes de paiement?' }, answer: { es: 'Te confirmamos los medios de pago disponibles según lo que necesites. Pregúntanos y lo verificamos.', en: 'We will confirm which payment methods are available for what you need. Just ask and we will check.', pt: 'Confirmamos as formas de pagamento disponíveis conforme o que precisar. É só perguntar.', fr: 'Nous vous confirmerons les moyens de paiement disponibles selon votre besoin.' }, category: 'pagos' },
            { question: { es: '¿Cómo puedo contactarlos?', en: 'How can I contact you?', pt: 'Como posso contatá-los?', fr: 'Comment vous contacter?' }, answer: { es: 'Puedes escribirnos aquí, llamarnos o visitarnos. Estamos para ayudarte.', en: 'You can write here, call us or visit us. We are here to help.', pt: 'Pode escrever aqui, ligar ou nos visitar.', fr: 'Écrivez ici, appelez-nous ou visitez-nous.' }, category: 'contacto' },
            { question: { es: '¿Dónde están ubicados?', en: 'Where are you located?', pt: 'Onde ficam?', fr: 'Où êtes-vous situés?' }, answer: { es: 'Con gusto te compartimos nuestra dirección y cómo llegar. Escríbenos y te la confirmamos.', en: 'We are happy to share our address and directions. Write to us and we will confirm.', pt: 'Com prazer compartilhamos nosso endereço e como chegar. Escreva e confirmamos.', fr: 'Nous vous communiquons volontiers notre adresse et l\'itinéraire. Écrivez-nous.' }, category: 'ubicacion' },
            { question: { es: '¿Tienen política de devolución?', en: 'Do you have a return policy?', pt: 'Tem política de devolução?', fr: 'Avez-vous une politique de retour?' }, answer: { es: 'Cuéntanos tu caso y te confirmamos qué condiciones de cambio o devolución aplican.', en: 'Tell us your case and we will confirm which exchange or return terms apply.', pt: 'Conte seu caso e confirmamos quais condições de troca ou devolução se aplicam.', fr: 'Dites-nous votre cas et nous vous confirmerons les conditions d\'échange ou de retour applicables.' }, category: 'politicas' },
        ],
        services: [],
        businessHours: { schedule: { mon: '08:00-18:00', tue: '08:00-18:00', wed: '08:00-18:00', thu: '08:00-18:00', fri: '08:00-18:00' }, afterHoursMessage: { es: 'Estamos fuera de horario. Te responderemos pronto.', en: 'We are closed. We\'ll respond soon.', pt: 'Estamos fora do horário.', fr: 'Nous sommes fermés.' } },
        sidebar: { labelOverrides: {}, hiddenItems: [] },
        dashboard: { kpis: [
            { key: 'leadsToday', label: { es: 'Leads Hoy', en: 'Leads Today', pt: 'Leads Hoje', fr: 'Leads Aujourd\'hui' }, icon: 'UserPlus', color: '#3498db' },
            { key: 'leadsHot', label: { es: 'Leads Calientes', en: 'Hot Leads', pt: 'Leads Quentes', fr: 'Leads Chauds' }, icon: 'Flame', color: '#e74c3c' },
            { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
            { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Coût IA' }, icon: 'DollarSign', color: '#e67e22' },
        ] },
        bookingEnabled: false,
    };
    return { ...defaults, ...config, terminology: { ...defaults.terminology, ...config.terminology }, agent: { ...defaults.agent, ...config.agent } as VerticalDefinition['agent'], sidebar: { ...defaults.sidebar, ...config.sidebar } as VerticalDefinition['sidebar'] };
}

const FINANZAS = createGenericVertical('finanzas', {
    subTypes: [
        { key: 'seguros', label: { es: 'Seguros', en: 'Insurance', pt: 'Seguros', fr: 'Assurances' } },
        { key: 'asesoria', label: { es: 'Asesoría financiera', en: 'Financial advisory', pt: 'Assessoria financeira', fr: 'Conseil financier' } },
        { key: 'fintech', label: { es: 'Fintech', en: 'Fintech', pt: 'Fintech', fr: 'Fintech' } },
        { key: 'creditos', label: { es: 'Créditos y préstamos', en: 'Loans & credit', pt: 'Créditos e empréstimos', fr: 'Crédits et prêts' } },
    ],
    terminology: { customerNoun: { es: 'cliente', en: 'client', pt: 'cliente', fr: 'client' }, customerNounPlural: { es: 'clientes', en: 'clients', pt: 'clientes', fr: 'clients' }, transactionNoun: { es: 'solicitud', en: 'application', pt: 'solicitação', fr: 'demande' }, serviceNoun: { es: 'producto financiero', en: 'financial product', pt: 'produto financeiro', fr: 'produit financier' }, pipelineNoun: { es: 'solicitudes', en: 'applications', pt: 'solicitações', fr: 'demandes' } },
    agent: { name: { es: 'Roberto', en: 'Robert', pt: 'Roberto', fr: 'Robert' }, role: { es: 'Asesor financiero virtual', en: 'Virtual financial advisor', pt: 'Consultor financeiro virtual', fr: 'Conseiller financier virtuel' }, tone: 'trustworthy', formality: 'formal', greeting: { es: 'Hola, soy Roberto, asesor financiero. ¿En qué producto o servicio puedo orientarte?', en: 'Hello, I\'m Robert, your financial advisor. How can I guide you?', pt: 'Olá, sou Roberto, consultor financeiro. Como posso orientar?', fr: 'Bonjour, je suis Robert, votre conseiller financier.' }, rules: { es: 'Nunca garantices rendimientos ni aprobación de crédito. Siempre remite a un asesor certificado para decisiones de inversión.', en: 'Never guarantee returns or credit approval. Always refer to certified advisor for investment decisions.', pt: 'Nunca garanta rendimentos nem aprovação de crédito.', fr: 'Ne jamais garantir de rendements ni l\'approbation d\'un crédit.' }, forbiddenTopics: { es: 'Garantizar rendimientos|Solicitar datos bancarios completos|Prometer aprobación de crédito|Asesoramiento tributario específico', en: 'Guarantee returns|Request full banking details|Promise credit approval|Specific tax advice', pt: 'Garantir rendimentos|Solicitar dados bancários|Prometer aprovação', fr: 'Garantir rendements|Demander coordonnées bancaires|Promettre approbation' }, handoffTriggers: { es: 'solicitud formal|monto alto|queja regulatoria|reclamo|fraude', en: 'formal application|high amount|regulatory complaint|claim|fraud', pt: 'solicitacao formal|valor alto|reclamacao regulatoria', fr: 'demande formelle|montant eleve|plainte reglementaire' } },
    pipeline: { stages: [
        { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#2c3e50', probability: 10, isTerminal: false },
        { name: { es: 'Pre-aprobación', en: 'Pre-approval', pt: 'Pré-aprovação', fr: 'Pré-approbation' }, slug: 'pre_aprobacion', color: '#3498db', probability: 30, isTerminal: false },
        { name: { es: 'Documentación', en: 'Documentation', pt: 'Documentação', fr: 'Documentation' }, slug: 'documentacion', color: '#f39c12', probability: 50, isTerminal: false },
        { name: { es: 'Evaluación', en: 'Evaluation', pt: 'Avaliação', fr: 'Évaluation' }, slug: 'evaluacion', color: '#e67e22', probability: 70, isTerminal: false },
        { name: { es: 'Aprobado', en: 'Approved', pt: 'Aprovado', fr: 'Approuvé' }, slug: 'aprobado', color: '#2ecc71', probability: 100, isTerminal: true },
        { name: { es: 'Rechazado', en: 'Rejected', pt: 'Rejeitado', fr: 'Rejeté' }, slug: 'rechazado', color: '#e74c3c', probability: 0, isTerminal: true },
    ] },
    sidebar: { labelOverrides: { crm: { es: 'Clientes', en: 'Clients', pt: 'Clientes', fr: 'Clients' }, pipeline: { es: 'Solicitudes', en: 'Applications', pt: 'Solicitações', fr: 'Demandes' } }, hiddenItems: ['inventory', 'orders', 'catalog'] },
    bookingEnabled: true,
    services: [
        { name: { es: 'Asesoría gratuita', en: 'Free consultation', pt: 'Consultoria gratuita', fr: 'Consultation gratuite' }, description: { es: 'Orientación financiera inicial', en: 'Initial financial guidance', pt: 'Orientação financeira inicial', fr: 'Orientation financière initiale' }, durationMinutes: 30, price: 0, currency: 'COP', category: 'asesoria' },
    ],
});

const SERVICIOS_PROFESIONALES = createGenericVertical('servicios_profesionales', {
    subTypes: [
        { key: 'abogados', label: { es: 'Abogados', en: 'Lawyers', pt: 'Advogados', fr: 'Avocats' } },
        { key: 'contadores', label: { es: 'Contadores', en: 'Accountants', pt: 'Contadores', fr: 'Comptables' } },
        { key: 'arquitectos', label: { es: 'Arquitectos', en: 'Architects', pt: 'Arquitetos', fr: 'Architectes' } },
        { key: 'consultores', label: { es: 'Consultores', en: 'Consultants', pt: 'Consultores', fr: 'Consultants' } },
    ],
    terminology: { customerNoun: { es: 'cliente', en: 'client', pt: 'cliente', fr: 'client' }, customerNounPlural: { es: 'clientes', en: 'clients', pt: 'clientes', fr: 'clients' }, transactionNoun: { es: 'caso', en: 'case', pt: 'caso', fr: 'dossier' }, serviceNoun: { es: 'servicio profesional', en: 'professional service', pt: 'serviço profissional', fr: 'service professionnel' }, pipelineNoun: { es: 'casos', en: 'cases', pt: 'casos', fr: 'dossiers' } },
    agent: { name: { es: 'Elena', en: 'Elena', pt: 'Elena', fr: 'Hélène' }, role: { es: 'Asistente administrativa profesional', en: 'Professional administrative assistant', pt: 'Assistente administrativa profissional', fr: 'Assistante administrative professionnelle' }, tone: 'professional', formality: 'formal', greeting: { es: 'Hola, soy Elena, asistente del despacho. ¿En qué asunto puedo orientarte?', en: 'Hello, I\'m Elena, the office assistant. How can I help?', pt: 'Olá, sou Elena, assistente do escritório. Como posso ajudar?', fr: 'Bonjour, je suis Hélène, assistante du cabinet. Comment puis-je vous aider?' }, rules: { es: 'Califica el tipo de consulta. Agenda reuniones. Nunca des asesoramiento legal o financiero directo.', en: 'Qualify the inquiry type. Schedule meetings. Never give direct legal or financial advice.', pt: 'Qualifique o tipo de consulta. Agende reuniões.', fr: 'Qualifiez la demande. Planifiez des réunions.' }, forbiddenTopics: { es: 'Asesoramiento legal directo|Diagnóstico fiscal|Garantizar resultados|Tarifas de otros profesionales', en: 'Direct legal advice|Tax diagnosis|Guarantee outcomes|Other professionals rates', pt: 'Assessoria legal direta|Diagnóstico fiscal|Garantir resultados', fr: 'Conseil juridique direct|Diagnostic fiscal|Garantir résultats' }, handoffTriggers: { es: 'caso complejo|conflicto de intereses|queja formal|urgencia legal|audiencia', en: 'complex case|conflict of interest|formal complaint|legal emergency|hearing', pt: 'caso complexo|conflito de interesses|reclamacao formal', fr: 'dossier complexe|conflit d\'interets|plainte formelle' } },
    pipeline: { stages: [
        { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#2c3e50', probability: 10, isTerminal: false },
        { name: { es: 'Evaluación', en: 'Evaluation', pt: 'Avaliação', fr: 'Évaluation' }, slug: 'evaluacion', color: '#3498db', probability: 25, isTerminal: false },
        { name: { es: 'Propuesta', en: 'Proposal', pt: 'Proposta', fr: 'Proposition' }, slug: 'propuesta', color: '#f39c12', probability: 50, isTerminal: false },
        { name: { es: 'En proceso', en: 'In progress', pt: 'Em andamento', fr: 'En cours' }, slug: 'en_proceso', color: '#e67e22', probability: 75, isTerminal: false },
        { name: { es: 'Completado', en: 'Completed', pt: 'Completado', fr: 'Terminé' }, slug: 'completado', color: '#2ecc71', probability: 100, isTerminal: true },
        { name: { es: 'Declinado', en: 'Declined', pt: 'Recusado', fr: 'Décliné' }, slug: 'declinado', color: '#95a5a6', probability: 0, isTerminal: true },
    ] },
    sidebar: { labelOverrides: { crm: { es: 'Clientes', en: 'Clients', pt: 'Clientes', fr: 'Clients' }, pipeline: { es: 'Casos', en: 'Cases', pt: 'Casos', fr: 'Dossiers' } }, hiddenItems: ['inventory', 'orders', 'catalog'] },
    bookingEnabled: true,
    services: [
        { name: { es: 'Consulta inicial', en: 'Initial consultation', pt: 'Consulta inicial', fr: 'Consultation initiale' }, description: { es: 'Primera reunión de evaluación', en: 'First evaluation meeting', pt: 'Primeira reunião de avaliação', fr: 'Première réunion d\'évaluation' }, durationMinutes: 30, price: 100000, currency: 'COP', category: 'consulta' },
        { name: { es: 'Asesoría especializada', en: 'Specialized advisory', pt: 'Assessoria especializada', fr: 'Conseil spécialisé' }, description: { es: 'Sesión de asesoría con especialista', en: 'Advisory session with specialist', pt: 'Sessão de assessoria com especialista', fr: 'Séance de conseil avec spécialiste' }, durationMinutes: 60, price: 200000, currency: 'COP', category: 'asesoria' },
    ],
});

const RETAIL = createGenericVertical('retail', {
    subTypes: [
        { key: 'moda', label: { es: 'Moda y ropa', en: 'Fashion & clothing', pt: 'Moda e roupas', fr: 'Mode et vêtements' } },
        { key: 'electronica', label: { es: 'Electrónica', en: 'Electronics', pt: 'Eletrônica', fr: 'Électronique' } },
        { key: 'hogar', label: { es: 'Hogar y decoración', en: 'Home & decor', pt: 'Casa e decoração', fr: 'Maison et décoration' } },
        { key: 'marketplace', label: { es: 'Marketplace / E-commerce', en: 'Marketplace / E-commerce', pt: 'Marketplace / E-commerce', fr: 'Marketplace / E-commerce' } },
    ],
    terminology: { customerNoun: { es: 'cliente', en: 'customer', pt: 'cliente', fr: 'client' }, customerNounPlural: { es: 'clientes', en: 'customers', pt: 'clientes', fr: 'clients' }, transactionNoun: { es: 'pedido', en: 'order', pt: 'pedido', fr: 'commande' }, serviceNoun: { es: 'producto', en: 'product', pt: 'produto', fr: 'produit' }, pipelineNoun: { es: 'ventas', en: 'sales', pt: 'vendas', fr: 'ventes' } },
    agent: { name: { es: 'Alex', en: 'Alex', pt: 'Alex', fr: 'Alex' }, role: { es: 'Asesor de ventas', en: 'Sales advisor', pt: 'Consultor de vendas', fr: 'Conseiller commercial' }, tone: 'friendly', formality: 'casual', greeting: { es: '¡Hola! Soy Alex, tu asesor de compras. ¿Qué estás buscando hoy?', en: 'Hi! I\'m Alex, your shopping advisor. What are you looking for?', pt: 'Olá! Sou Alex, seu consultor de compras. O que procura?', fr: 'Bonjour! Je suis Alex, votre conseiller. Que cherchez-vous?' }, rules: { es: 'Sugiere productos según las necesidades del cliente. Informa disponibilidad y tiempos de entrega. Ofrece opciones dentro del presupuesto.', en: 'Suggest products based on needs. Inform availability and delivery times.', pt: 'Sugira produtos com base nas necessidades. Informe disponibilidade.', fr: 'Suggérez des produits selon les besoins. Informez de la disponibilité.' }, forbiddenTopics: { es: 'Precios de costo|Comparaciones con competencia|Garantías no autorizadas', en: 'Cost prices|Competitor comparisons|Unauthorized warranties', pt: 'Preços de custo|Comparações com concorrência', fr: 'Prix de revient|Comparaisons avec concurrence' }, handoffTriggers: { es: 'devolucion compleja|pedido mayorista|queja de calidad|cambio masivo', en: 'complex return|wholesale order|quality complaint', pt: 'devolucao complexa|pedido atacado|reclamacao', fr: 'retour complexe|commande en gros|plainte qualite' } },
    pipeline: { stages: [
        { name: { es: 'Interesado', en: 'Interested', pt: 'Interessado', fr: 'Intéressé' }, slug: 'interesado', color: '#3498db', probability: 10, isTerminal: false },
        { name: { es: 'Cotización', en: 'Quote', pt: 'Cotação', fr: 'Devis' }, slug: 'cotizacion', color: '#f39c12', probability: 30, isTerminal: false },
        { name: { es: 'Pedido', en: 'Ordered', pt: 'Pedido', fr: 'Commande' }, slug: 'pedido', color: '#e67e22', probability: 60, isTerminal: false },
        { name: { es: 'Enviado', en: 'Shipped', pt: 'Enviado', fr: 'Expédié' }, slug: 'enviado', color: '#9b59b6', probability: 80, isTerminal: false },
        { name: { es: 'Entregado', en: 'Delivered', pt: 'Entregue', fr: 'Livré' }, slug: 'entregado', color: '#2ecc71', probability: 100, isTerminal: true },
        { name: { es: 'Devolución', en: 'Return', pt: 'Devolução', fr: 'Retour' }, slug: 'devolucion', color: '#e74c3c', probability: 0, isTerminal: true },
    ] },
    sidebar: { labelOverrides: { crm: { es: 'Clientes', en: 'Customers', pt: 'Clientes', fr: 'Clients' }, pipeline: { es: 'Ventas', en: 'Sales', pt: 'Vendas', fr: 'Ventes' }, catalog: { es: 'Productos', en: 'Products', pt: 'Produtos', fr: 'Produits' } }, hiddenItems: [] },
});

const TECHNOLOGY = createGenericVertical('technology', {
    subTypes: [
        { key: 'saas', label: { es: 'SaaS', en: 'SaaS', pt: 'SaaS', fr: 'SaaS' } },
        { key: 'consultoria_ti', label: { es: 'Consultoría TI', en: 'IT Consulting', pt: 'Consultoria TI', fr: 'Conseil IT' } },
        { key: 'desarrollo', label: { es: 'Desarrollo de software', en: 'Software development', pt: 'Desenvolvimento de software', fr: 'Développement logiciel' } },
        { key: 'hardware', label: { es: 'Hardware y redes', en: 'Hardware & networking', pt: 'Hardware e redes', fr: 'Matériel et réseaux' } },
    ],
    terminology: { customerNoun: { es: 'cliente', en: 'client', pt: 'cliente', fr: 'client' }, customerNounPlural: { es: 'clientes', en: 'clients', pt: 'clientes', fr: 'clients' }, transactionNoun: { es: 'deal', en: 'deal', pt: 'deal', fr: 'affaire' }, serviceNoun: { es: 'solución', en: 'solution', pt: 'solução', fr: 'solution' }, pipelineNoun: { es: 'pipeline', en: 'pipeline', pt: 'pipeline', fr: 'pipeline' } },
    agent: { name: { es: 'Ana', en: 'Ana', pt: 'Ana', fr: 'Anne' }, role: { es: 'Asesora tecnológica', en: 'Technology advisor', pt: 'Consultora tecnológica', fr: 'Conseillère technologique' }, tone: 'professional', formality: 'semi-formal', greeting: { es: 'Hola, soy Ana, asesora tecnológica. ¿En qué solución puedo ayudarte?', en: 'Hello, I\'m Ana, your tech advisor. What solution can I help with?', pt: 'Olá, sou Ana, consultora tecnológica. Como posso ajudar?', fr: 'Bonjour, je suis Anne, conseillère technologique. Comment puis-je vous aider?' }, rules: { es: 'Califica el nivel técnico del cliente. Ofrece demos. Para proyectos enterprise, escala.', en: 'Qualify client\'s technical level. Offer demos. For enterprise, escalate.', pt: 'Qualifique o nível técnico do cliente. Ofereça demos.', fr: 'Qualifiez le niveau technique. Proposez des démos.' }, forbiddenTopics: { es: 'Acceso a sistemas|Credenciales|Garantizar SLA sin autorización', en: 'System access|Credentials|Guarantee SLA without authorization', pt: 'Acesso a sistemas|Credenciais|Garantir SLA', fr: 'Accès systèmes|Identifiants|Garantir SLA' }, handoffTriggers: { es: 'proyecto enterprise|integracion compleja|incidente de seguridad|presupuesto >$50M', en: 'enterprise project|complex integration|security incident|budget >$50K', pt: 'projeto enterprise|integracao complexa|incidente de seguranca', fr: 'projet enterprise|integration complexe|incident securite' } },
    pipeline: { stages: [
        { name: { es: 'Lead', en: 'Lead', pt: 'Lead', fr: 'Lead' }, slug: 'lead', color: '#2c3e50', probability: 5, isTerminal: false },
        { name: { es: 'Discovery', en: 'Discovery', pt: 'Discovery', fr: 'Découverte' }, slug: 'discovery', color: '#3498db', probability: 15, isTerminal: false },
        { name: { es: 'Demo', en: 'Demo', pt: 'Demo', fr: 'Démo' }, slug: 'demo', color: '#f39c12', probability: 35, isTerminal: false },
        { name: { es: 'Propuesta', en: 'Proposal', pt: 'Proposta', fr: 'Proposition' }, slug: 'propuesta', color: '#e67e22', probability: 55, isTerminal: false },
        { name: { es: 'Negociación', en: 'Negotiation', pt: 'Negociação', fr: 'Négociation' }, slug: 'negociacion', color: '#9b59b6', probability: 75, isTerminal: false },
        { name: { es: 'Cerrado', en: 'Closed Won', pt: 'Fechado', fr: 'Conclu' }, slug: 'cerrado', color: '#2ecc71', probability: 100, isTerminal: true },
        { name: { es: 'Perdido', en: 'Lost', pt: 'Perdido', fr: 'Perdu' }, slug: 'perdido', color: '#95a5a6', probability: 0, isTerminal: true },
    ] },
    sidebar: { labelOverrides: {}, hiddenItems: ['inventory', 'catalog'] },
    bookingEnabled: true,
    services: [
        { name: { es: 'Demo personalizada', en: 'Custom demo', pt: 'Demo personalizada', fr: 'Démo personnalisée' }, description: { es: 'Demostración de la solución', en: 'Solution demonstration', pt: 'Demonstração da solução', fr: 'Démonstration de la solution' }, durationMinutes: 45, price: 0, currency: 'COP', category: 'demos' },
    ],
});

// ── Tier 3 verticals ─────────────────────────────────────────────

const SERVICIOS_HOGAR: VerticalDefinition = {
    industry: 'servicios_hogar',
    subTypes: [
        { key: 'plomeria', label: { es: 'Plomería', en: 'Plumbing', pt: 'Encanamento', fr: 'Plomberie' } },
        { key: 'electricidad', label: { es: 'Electricidad', en: 'Electrical', pt: 'Eletricidade', fr: 'Électricité' } },
        { key: 'fumigacion', label: { es: 'Fumigación', en: 'Pest control', pt: 'Dedetização', fr: 'Désinsectisation' } },
        { key: 'limpieza', label: { es: 'Limpieza', en: 'Cleaning', pt: 'Limpeza', fr: 'Nettoyage' } },
        { key: 'jardineria', label: { es: 'Jardinería', en: 'Landscaping', pt: 'Jardinagem', fr: 'Jardinage' } },
        { key: 'cerrajeria', label: { es: 'Cerrajería', en: 'Locksmith', pt: 'Chaveiro', fr: 'Serrurerie' } },
        { key: 'pintura', label: { es: 'Pintura', en: 'Painting', pt: 'Pintura', fr: 'Peinture' } },
    ],
    terminology: {
        customerNoun: { es: 'cliente', en: 'customer', pt: 'cliente', fr: 'client' },
        customerNounPlural: { es: 'clientes', en: 'customers', pt: 'clientes', fr: 'clients' },
        transactionNoun: { es: 'servicio', en: 'service', pt: 'serviço', fr: 'service' },
        serviceNoun: { es: 'servicio', en: 'service', pt: 'serviço', fr: 'service' },
        pipelineNoun: { es: 'solicitudes', en: 'requests', pt: 'solicitações', fr: 'demandes' },
    },
    agent: {
        name: { es: 'Diego', en: 'Diego', pt: 'Diego', fr: 'Diego' },
        role: { es: 'Asistente de servicios al hogar', en: 'Home services assistant', pt: 'Assistente de serviços', fr: 'Assistant services à domicile' },
        tone: 'professional',
        formality: 'semi-formal',
        greeting: { es: 'Hola, soy Diego del equipo de servicios. ¿Qué problema necesitas resolver hoy?', en: 'Hi, I\'m Diego from the services team. What needs fixing today?', pt: 'Olá, sou Diego.', fr: 'Bonjour, je suis Diego.' },
        rules: {
            es: 'SIEMPRE captura urgencia (emergencia / alta / normal / flexible) — si es emergencia escala inmediatamente. Pide dirección completa, ciudad, descripción del problema, fecha preferida. Usa create_service_request para registrar. NUNCA inventes precios sin que el técnico evalúe en sitio — di "el técnico te dará la cotización al revisar".',
            en: 'Always capture urgency. Emergencies escalate immediately. Get full address, city, issue description, preferred date. Use create_service_request. Never invent prices without on-site assessment.',
            pt: 'Sempre capture urgência. Emergências escalam.',
            fr: 'Toujours capturer l\'urgence. Urgences escaladent.',
        },
        forbiddenTopics: {
            es: 'Cotizaciones definitivas sin evaluación en sitio|Promesas sobre tiempos de respuesta sin confirmación',
            en: 'Final quotes without on-site assessment|Response time promises without confirmation',
            pt: 'Cotações finais sem avaliação',
            fr: 'Devis fermes sans visite',
        },
        handoffTriggers: {
            es: 'emergencia|fuga de gas|inundación|cortocircuito|electrocucion|peligro|queja formal',
            en: 'emergency|gas leak|flood|short circuit|danger|formal complaint',
            pt: 'emergência|vazamento de gás|inundação',
            fr: 'urgence|fuite de gaz|inondation',
        },
    },
    pipeline: {
        stages: [
            { name: { es: 'Solicitud', en: 'Request', pt: 'Solicitação', fr: 'Demande' }, slug: 'solicitud', color: '#3498db', probability: 10, isTerminal: false, transitionRules: [] },
            { name: { es: 'Cotización', en: 'Quoted', pt: 'Cotada', fr: 'Devis' }, slug: 'cotizacion', color: '#f39c12', probability: 30, isTerminal: false, transitionRules: [] },
            { name: { es: 'Agendado', en: 'Scheduled', pt: 'Agendado', fr: 'Programmé' }, slug: 'agendado', color: '#e67e22', probability: 60, isTerminal: false, transitionRules: [{ type: 'appointment_required' }] },
            { name: { es: 'En servicio', en: 'On site', pt: 'Em serviço', fr: 'Sur place' }, slug: 'en_servicio', color: '#9b59b6', probability: 80, isTerminal: false, transitionRules: [{ type: 'name_required' }, { type: 'phone_required' }] },
            { name: { es: 'Completado', en: 'Completed', pt: 'Concluído', fr: 'Terminé' }, slug: 'completado', color: '#2ecc71', probability: 100, isTerminal: true, transitionRules: [] },
            { name: { es: 'Cancelado', en: 'Cancelled', pt: 'Cancelado', fr: 'Annulé' }, slug: 'cancelado', color: '#95a5a6', probability: 0, isTerminal: true, transitionRules: [] },
        ],
    },
    faqs: [
        { question: { es: '¿Atienden emergencias 24/7?', en: 'Do you handle 24/7 emergencies?', pt: 'Atendem 24/7?', fr: 'Service 24/7?' }, answer: { es: 'Cuéntanos qué está pasando y te confirmamos si podemos atenderte ahora y si aplica algún recargo fuera del horario habitual.', en: 'Tell us what is going on and we will confirm whether we can attend now and whether any after-hours surcharge applies.', pt: 'Conte-nos o que está acontecendo e confirmamos se podemos atender agora e se há taxa fora do horário.', fr: 'Dites-nous ce qui se passe et nous confirmerons si nous pouvons intervenir et si un supplément hors horaires s\'applique.' }, category: 'urgencias' },
        { question: { es: '¿Cómo obtengo una cotización?', en: 'How do I get a quote?', pt: 'Como peço cotação?', fr: 'Comment obtenir un devis?' }, answer: { es: 'Cuéntanos qué necesitas — el técnico debe evaluar en sitio para darte el precio final.', en: 'Tell us the issue — the technician must assess on-site for the final quote.', pt: 'Conte-nos o problema — avaliação no local para preço final.', fr: 'Décrivez le problème — évaluation sur place.' }, category: 'cotizacion' },
        { question: { es: '¿Qué garantía tienen los trabajos?', en: 'Work warranty?', pt: 'Garantia dos serviços?', fr: 'Garantie?' }, answer: { es: 'La garantía depende del trabajo y de las partes que se usen. Al entregarte la cotización te confirmamos exactamente qué cubre y por cuánto tiempo.', en: 'The warranty depends on the job and the parts used. When we hand you the quote we confirm exactly what it covers and for how long.', pt: 'A garantia depende do serviço e das peças usadas. Na cotação confirmamos o que cobre e por quanto tempo.', fr: 'La garantie dépend du travail et des pièces utilisées. Nous vous préciserons sa couverture et sa durée avec le devis.' }, category: 'garantia' },
        { question: { es: '¿Trabajan en mi zona?', en: 'Do you cover my area?', pt: 'Atendem minha zona?', fr: 'Couvrez-vous ma zone?' }, answer: { es: 'Cuéntanos tu dirección y te confirmo si llegamos a tu zona.', en: 'Send your address and I will confirm whether we cover your area.', pt: 'Mande seu endereço e confirmo se atendemos sua região.', fr: 'Envoyez votre adresse et je vous confirme si nous couvrons votre secteur.' }, category: 'cobertura' },
        { question: { es: '¿Cuál es la forma de pago?', en: 'Payment methods?', pt: 'Formas de pagamento?', fr: 'Modes de paiement?' }, answer: { es: 'Te confirmamos los medios de pago aceptados y en qué momento se paga junto con la cotización del trabajo.', en: 'We confirm the accepted payment methods and when payment is due along with the job quote.', pt: 'Confirmamos as formas de pagamento aceitas e quando pagar junto com a cotização.', fr: 'Nous vous confirmerons les moyens de paiement acceptés et le moment du règlement avec le devis.' }, category: 'pagos' },
    ],
    services: [],
    businessHours: {
        schedule: { mon: '07:00-19:00', tue: '07:00-19:00', wed: '07:00-19:00', thu: '07:00-19:00', fri: '07:00-19:00', sat: '08:00-15:00' },
        afterHoursMessage: { es: 'Estamos fuera de horario regular. Para emergencias indica "EMERGENCIA" y te contactamos.', en: 'After hours — type EMERGENCIA for urgent dispatch.', pt: 'Fora do horário.', fr: 'Hors horaires.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Clientes', en: 'Customers', pt: 'Clientes', fr: 'Clients' },
            pipeline: { es: 'Solicitudes', en: 'Requests', pt: 'Solicitações', fr: 'Demandes' },
        },
        hiddenItems: [],
    },
    dashboard: {
        kpis: [
            { key: 'leadsToday', label: { es: 'Solicitudes Hoy', en: 'Requests Today', pt: 'Solicitações Hoje', fr: 'Demandes Aujourd\'hui' }, icon: 'Wrench', color: '#3498db' },
            { key: 'leadsHot', label: { es: 'Emergencias', en: 'Emergencies', pt: 'Emergências', fr: 'Urgences' }, icon: 'AlertTriangle', color: '#e74c3c' },
            { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
            { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Coût IA' }, icon: 'DollarSign', color: '#27ae60' },
        ],
    },
    bookingEnabled: true,
};

const PET_SERVICES: VerticalDefinition = {
    industry: 'pet_services',
    subTypes: [
        { key: 'peluqueria', label: { es: 'Peluquería canina/felina', en: 'Pet grooming', pt: 'Banho e tosa', fr: 'Toilettage' } },
        { key: 'guarderia', label: { es: 'Guardería diurna', en: 'Day care', pt: 'Creche para pets', fr: 'Garderie' } },
        { key: 'hotel', label: { es: 'Hotel canino', en: 'Pet hotel', pt: 'Hotel para pets', fr: 'Hôtel pour animaux' } },
        { key: 'paseos', label: { es: 'Paseos', en: 'Dog walking', pt: 'Passeios', fr: 'Promenades' } },
        { key: 'adiestramiento', label: { es: 'Adiestramiento', en: 'Training', pt: 'Adestramento', fr: 'Dressage' } },
    ],
    terminology: {
        customerNoun: { es: 'tutor', en: 'pet parent', pt: 'tutor', fr: 'tuteur' },
        customerNounPlural: { es: 'tutores', en: 'pet parents', pt: 'tutores', fr: 'tuteurs' },
        transactionNoun: { es: 'reserva', en: 'booking', pt: 'reserva', fr: 'réservation' },
        serviceNoun: { es: 'servicio', en: 'service', pt: 'serviço', fr: 'service' },
        pipelineNoun: { es: 'reservas', en: 'bookings', pt: 'reservas', fr: 'réservations' },
    },
    agent: {
        name: { es: 'Toby', en: 'Toby', pt: 'Toby', fr: 'Toby' },
        role: { es: 'Asistente del salón de mascotas', en: 'Pet salon assistant', pt: 'Assistente pet', fr: 'Assistant animalier' },
        tone: 'warm',
        formality: 'casual',
        greeting: { es: '¡Hola! Soy Toby, asistente del salón. ¿Qué peludito necesita atención hoy?', en: 'Hi! I\'m Toby, salon assistant. Which furry one needs care?', pt: 'Oi! Sou Toby.', fr: 'Salut! Je suis Toby.' },
        rules: {
            es: 'Pregunta nombre, raza y tamaño de la mascota antes de cotizar — el precio cambia. Para guardería pide días de inicio y fin. Para baño/peluquería verifica vacunas si es primera vez. Lista los servicios con list_pet_services antes de proponer.',
            en: 'Ask pet name, breed and size before quoting. Verify vaccines for first-time grooming. Use list_pet_services to show offerings.',
            pt: 'Pergunte nome, raça e porte antes de cotar.',
            fr: 'Demandez nom, race et taille avant le devis.',
        },
        forbiddenTopics: {
            es: 'Diagnósticos veterinarios|Recomendaciones médicas|Aceptación sin verificación de vacunas',
            en: 'Veterinary diagnoses|Medical recommendations|Accepting without vaccine check',
            pt: 'Diagnósticos|Aceitação sem vacinas',
            fr: 'Diagnostics|Acceptation sans vaccins',
        },
        handoffTriggers: {
            es: 'lesión|herida|enfermedad|emergencia|queja',
            en: 'injury|wound|illness|emergency|complaint',
            pt: 'lesão|emergência',
            fr: 'blessure|urgence',
        },
    },
    pipeline: {
        stages: [
            { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#3498db', probability: 10, isTerminal: false, transitionRules: [] },
            { name: { es: 'Reserva', en: 'Booked', pt: 'Reservada', fr: 'Réservée' }, slug: 'reserva', color: '#f39c12', probability: 50, isTerminal: false, transitionRules: [{ type: 'appointment_required' }] },
            { name: { es: 'Servicio', en: 'In progress', pt: 'Em serviço', fr: 'En cours' }, slug: 'servicio', color: '#e67e22', probability: 80, isTerminal: false, transitionRules: [{ type: 'name_required' }, { type: 'phone_required' }] },
            { name: { es: 'Completado', en: 'Completed', pt: 'Concluído', fr: 'Terminé' }, slug: 'completado', color: '#2ecc71', probability: 100, isTerminal: true, transitionRules: [] },
            { name: { es: 'Cliente recurrente', en: 'Repeat client', pt: 'Cliente recorrente', fr: 'Client fidèle' }, slug: 'recurrente', color: '#27ae60', probability: 95, isTerminal: false, transitionRules: [] },
        ],
    },
    faqs: [
        { question: { es: '¿Necesito el carné de vacunas?', en: 'Do I need vaccine record?', pt: 'Preciso do carnê de vacinas?', fr: 'Carnet de vaccination?' }, answer: { es: 'Para guardería y hotel te pediremos el carné de vacunación al día. Envíanos una foto y te confirmamos si está completo para el servicio.', en: 'For daycare and boarding we will ask for an up-to-date vaccination record. Send us a photo and we will confirm whether it covers the service.', pt: 'Para creche e hotel pediremos o carnê de vacinação em dia. Mande uma foto e confirmamos se está completo.', fr: 'Pour la garderie et l\'hôtel nous demanderons le carnet de vaccination à jour. Envoyez une photo et nous confirmerons.' }, category: 'requisitos' },
        { question: { es: '¿Manejan razas grandes?', en: 'Do you accept large breeds?', pt: 'Aceitam raças grandes?', fr: 'Acceptez-vous les grandes races?' }, answer: { es: 'Cuéntanos raza, tamaño y peso y te confirmamos disponibilidad y precio para tu peludito.', en: 'Tell us the breed, size and weight and we will confirm availability and price for your pet.', pt: 'Conte-nos raça, porte e peso e confirmamos disponibilidade e preço.', fr: 'Indiquez la race, la taille et le poids et nous confirmerons disponibilité et prix.' }, category: 'tamano' },
        { question: { es: '¿Puedo dejar al pet con sus juguetes?', en: 'Can I leave pet toys?', pt: 'Posso deixar brinquedos?', fr: 'Puis-je laisser des jouets?' }, answer: { es: 'Sí, recomendamos su manta o juguete favorito para reducir el estrés.', en: 'Yes — a favorite toy or blanket is recommended.', pt: 'Sim — manta ou brinquedo favorito é recomendado.', fr: 'Oui — couverture ou jouet préféré recommandé.' }, category: 'general' },
        { question: { es: '¿Cuánto dura la peluquería?', en: 'How long does grooming take?', pt: 'Duração do banho e tosa?', fr: 'Durée du toilettage?' }, answer: { es: 'Depende de la raza y del servicio. Al agendar te confirmamos el tiempo estimado para tu mascota.', en: 'It depends on the breed and the service. We confirm the estimated time for your pet when you book.', pt: 'Depende da raça e do serviço. Ao agendar confirmamos o tempo estimado.', fr: 'Cela dépend de la race et du service. Nous confirmons la durée estimée lors de la réservation.' }, category: 'duracion' },
        { question: { es: '¿Hacen pickup y delivery?', en: 'Pickup & delivery?', pt: 'Coleta e entrega?', fr: 'Collecte et livraison?' }, answer: { es: 'Cuéntanos tu dirección y te confirmamos si podemos recoger y entregar, y si tiene algún costo adicional.', en: 'Send us your address and we will confirm whether we can pick up and drop off, and whether there is an extra cost.', pt: 'Mande seu endereço e confirmamos se fazemos coleta e entrega e se há custo adicional.', fr: 'Envoyez votre adresse et nous confirmerons si nous assurons la collecte et la livraison, et à quel coût.' }, category: 'logistica' },
    ],
    services: [
        { name: { es: 'Baño + corte (perro pequeño)', en: 'Bath + cut (small dog)', pt: 'Banho + tosa (pequeno)', fr: 'Bain + coupe (petit)' }, description: { es: 'Baño completo + corte de raza', en: 'Full bath + breed cut', pt: 'Banho completo', fr: 'Bain complet' }, durationMinutes: 90, price: 60000, currency: 'COP', category: 'peluqueria' },
        { name: { es: 'Guardería diurna', en: 'Day care', pt: 'Creche diária', fr: 'Garderie journée' }, description: { es: 'Estancia 8-10h con socialización', en: '8-10h stay with socialization', pt: 'Permanência 8-10h', fr: 'Séjour 8-10h' }, durationMinutes: 480, price: 50000, currency: 'COP', category: 'guarderia' },
        // durationType 'open': una pernocta de 1440 min jamás cabe en la ventana
        // diaria de slots (08:00-18:00 = 600 min) — con slots fijos el generador
        // devolvía "no hay disponibilidad" para siempre, en bucle, para el
        // servicio estrella de la vertical.
        { name: { es: 'Hotel — noche', en: 'Hotel — overnight', pt: 'Hotel — diária', fr: 'Hôtel — nuit' }, description: { es: 'Pernocta con alimentación incluida', en: 'Overnight stay with food', pt: 'Pernoite com alimentação', fr: 'Nuit avec nourriture' }, durationMinutes: 1440, price: 80000, currency: 'COP', category: 'hotel', durationType: 'open' },
    ],
    businessHours: {
        schedule: { mon: '08:00-18:00', tue: '08:00-18:00', wed: '08:00-18:00', thu: '08:00-18:00', fri: '08:00-18:00', sat: '08:00-16:00' },
        afterHoursMessage: { es: 'Estamos cerrados. Te respondo al iniciar jornada.', en: 'We are closed.', pt: 'Estamos fechados.', fr: 'Nous sommes fermés.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Tutores', en: 'Pet parents', pt: 'Tutores', fr: 'Tuteurs' },
            appointments: { es: 'Reservas', en: 'Bookings', pt: 'Reservas', fr: 'Réservations' },
        },
        hiddenItems: [],
    },
    dashboard: {
        kpis: [
            { key: 'leadsToday', label: { es: 'Tutores Hoy', en: 'Pet Parents Today', pt: 'Tutores Hoje', fr: 'Tuteurs Aujourd\'hui' }, icon: 'PawPrint', color: '#3498db' },
            { key: 'appointmentsToday', label: { es: 'Reservas Hoy', en: 'Bookings Today', pt: 'Reservas Hoje', fr: 'Réservations Aujourd\'hui' }, icon: 'Calendar', color: '#2ecc71' },
            { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
            { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Coût IA' }, icon: 'DollarSign', color: '#e67e22' },
        ],
    },
    bookingEnabled: true,
};

const FOTOGRAFIA: VerticalDefinition = {
    industry: 'fotografia',
    subTypes: [
        { key: 'estudio', label: { es: 'Estudio fotográfico', en: 'Photo studio', pt: 'Estúdio fotográfico', fr: 'Studio photo' } },
        { key: 'bodas', label: { es: 'Wedding photography', en: 'Wedding photography', pt: 'Casamentos', fr: 'Mariages' } },
        { key: 'eventos', label: { es: 'Eventos sociales y corporativos', en: 'Social & corporate events', pt: 'Eventos', fr: 'Événements' } },
        { key: 'producto', label: { es: 'Fotografía de producto', en: 'Product photography', pt: 'Produto', fr: 'Produit' } },
        { key: 'wedding_planner', label: { es: 'Wedding planner', en: 'Wedding planner', pt: 'Wedding planner', fr: 'Wedding planner' } },
    ],
    terminology: {
        customerNoun: { es: 'cliente', en: 'client', pt: 'cliente', fr: 'client' },
        customerNounPlural: { es: 'clientes', en: 'clients', pt: 'clientes', fr: 'clients' },
        transactionNoun: { es: 'sesión', en: 'shoot', pt: 'sessão', fr: 'séance' },
        serviceNoun: { es: 'paquete', en: 'package', pt: 'pacote', fr: 'forfait' },
        pipelineNoun: { es: 'cotizaciones', en: 'quotes', pt: 'cotações', fr: 'devis' },
    },
    agent: {
        name: { es: 'Camila', en: 'Camille', pt: 'Camila', fr: 'Camille' },
        role: { es: 'Asistente del estudio fotográfico', en: 'Photo studio assistant', pt: 'Assistente do estúdio', fr: 'Assistante studio' },
        tone: 'warm',
        formality: 'semi-formal',
        greeting: { es: '¡Hola! Soy Camila, asistente del estudio. ¿Qué tipo de sesión estás planeando?', en: 'Hi! I\'m Camille. What kind of shoot are you planning?', pt: 'Oi! Sou Camila.', fr: 'Bonjour! Je suis Camille.' },
        rules: {
            es: 'Para cualquier consulta de fechas SIEMPRE usa check_date_availability — el doble booking es catastrófico en wedding photography. Pregunta tipo de evento, número de horas, ubicación. NUNCA afirmes montos de anticipo ni condiciones de pago que el estudio no haya confirmado: ofrécete a consultarlos. Los entregables (cantidad de fotos editadas, álbumes, video) son lo que diferencia los paquetes — list_photo_packages para mostrarlos.',
            en: 'For dates ALWAYS use check_date_availability — double booking is catastrophic. Ask event type, hours, location. Never state deposit amounts or payment terms the studio has not confirmed.',
            pt: 'Para datas SEMPRE use check_date_availability.',
            fr: 'Pour les dates utilisez TOUJOURS check_date_availability.',
        },
        forbiddenTopics: {
            es: 'Compromisos de fechas sin verificar disponibilidad|Promesas de fotos no incluidas en el paquete',
            en: 'Date commitments without availability check|Promises beyond package scope',
            pt: 'Compromissos sem checar disponibilidade',
            fr: 'Engagements sans vérifier disponibilité',
        },
        handoffTriggers: {
            es: 'cancelación|reembolso|queja|problema con fotos entregadas',
            en: 'cancellation|refund|complaint|delivered photos issue',
            pt: 'cancelamento|reembolso|reclamação',
            fr: 'annulation|remboursement|plainte',
        },
    },
    pipeline: {
        stages: [
            { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#3498db', probability: 10, isTerminal: false, transitionRules: [] },
            { name: { es: 'Cotización', en: 'Quote sent', pt: 'Cotação', fr: 'Devis envoyé' }, slug: 'cotizacion', color: '#f39c12', probability: 30, isTerminal: false, transitionRules: [] },
            { name: { es: 'Anticipo', en: 'Deposit paid', pt: 'Sinal pago', fr: 'Acompte versé' }, slug: 'anticipo', color: '#e67e22', probability: 70, isTerminal: false, transitionRules: [{ type: 'name_required' }, { type: 'phone_required' }] },
            { name: { es: 'Sesión agendada', en: 'Shoot booked', pt: 'Sessão agendada', fr: 'Séance réservée' }, slug: 'agendada', color: '#9b59b6', probability: 90, isTerminal: false, transitionRules: [{ type: 'appointment_required' }] },
            { name: { es: 'Entregada', en: 'Delivered', pt: 'Entregue', fr: 'Livré' }, slug: 'entregada', color: '#2ecc71', probability: 100, isTerminal: true, transitionRules: [] },
            { name: { es: 'Reseña', en: 'Reviewed', pt: 'Avaliada', fr: 'Avis donné' }, slug: 'resena', color: '#27ae60', probability: 95, isTerminal: false, transitionRules: [] },
        ],
    },
    faqs: [
        { question: { es: '¿Cuánto cuesta una sesión?', en: 'How much for a shoot?', pt: 'Quanto custa uma sessão?', fr: 'Prix d\'une séance?' }, answer: { es: 'Depende del tipo (familiar, boda, corporativo) y horas. Cuéntame qué planeas y te muestro paquetes.', en: 'Depends on type and hours.', pt: 'Depende do tipo.', fr: 'Selon type et durée.' }, category: 'precios' },
        { question: { es: '¿Cuántas fotos editadas entregan?', en: 'How many edited photos?', pt: 'Quantas fotos editadas?', fr: 'Combien de photos éditées?' }, answer: { es: 'Varía según el paquete. Cuéntame qué tipo de sesión planeas y te digo exactamente cuántas fotos editadas incluye.', en: 'It varies by package. Tell me what kind of shoot you are planning and I will tell you exactly how many edited photos it includes.', pt: 'Varia por pacote. Me conte que tipo de sessão planeja e digo quantas fotos editadas inclui.', fr: 'Cela varie selon le forfait. Dites-moi quel type de séance vous prévoyez et je vous dirai combien de photos éditées sont incluses.' }, category: 'entregables' },
        { question: { es: '¿Cuánto tiempo tardan en entregar?', en: 'Delivery time?', pt: 'Prazo de entrega?', fr: 'Délai de livraison?' }, answer: { es: 'Depende del tipo de sesión y del volumen de fotos. Te confirmamos el plazo exacto al armar tu paquete, y si necesitas una entrega más rápida lo revisamos.', en: 'It depends on the type of shoot and the volume of photos. We confirm the exact turnaround when we put your package together, and we can look at a faster delivery if you need one.', pt: 'Depende do tipo de sessão e do volume de fotos. Confirmamos o prazo exato ao montar seu pacote.', fr: 'Cela dépend du type de séance et du volume de photos. Nous confirmons le délai exact lors de la constitution de votre forfait.' }, category: 'entrega' },
        { question: { es: '¿Hacen video?', en: 'Do you offer video?', pt: 'Fazem vídeo?', fr: 'Vidéo aussi?' }, answer: { es: 'Cuéntame qué necesitas y te confirmo si podemos incluir video en tu paquete y en qué condiciones.', en: 'Tell me what you need and I will confirm whether we can include video in your package and on what terms.', pt: 'Me conte o que precisa e confirmo se podemos incluir vídeo no seu pacote e em quais condições.', fr: 'Dites-moi ce dont vous avez besoin et je vous confirmerai si nous pouvons inclure la vidéo et à quelles conditions.' }, category: 'video' },
        { question: { es: '¿Cuál es el anticipo para reservar?', en: 'What\'s the deposit?', pt: 'Qual o sinal?', fr: 'Quel acompte?' }, answer: { es: 'Te confirmamos el anticipo y la forma de pago al armar tu cotización, antes de bloquear la fecha.', en: 'We confirm the deposit and payment terms when we put your quote together, before we hold the date.', pt: 'Confirmamos o sinal e a forma de pagamento ao montar sua cotização, antes de reservar a data.', fr: 'Nous confirmons l\'acompte et les modalités de paiement avec le devis, avant de bloquer la date.' }, category: 'pago' },
    ],
    services: [
        { name: { es: 'Sesión familiar', en: 'Family session', pt: 'Sessão familiar', fr: 'Séance famille' }, description: { es: '2 horas + 30 fotos editadas', en: '2h + 30 edited photos', pt: '2h + 30 fotos', fr: '2h + 30 photos' }, durationMinutes: 120, price: 350000, currency: 'COP', category: 'familiar' },
        { name: { es: 'Boda completa', en: 'Full wedding', pt: 'Casamento completo', fr: 'Mariage complet' }, description: { es: '8 horas + 400 fotos + álbum', en: '8h + 400 photos + album', pt: '8h + 400 fotos', fr: '8h + 400 photos' }, durationMinutes: 480, price: 3500000, currency: 'COP', category: 'boda' },
        { name: { es: 'Producto e-commerce', en: 'Product e-commerce', pt: 'Produto e-commerce', fr: 'Produit e-commerce' }, description: { es: 'Hasta 20 productos', en: 'Up to 20 products', pt: 'Até 20 produtos', fr: 'Jusqu\'à 20 produits' }, durationMinutes: 240, price: 800000, currency: 'COP', category: 'producto' },
    ],
    businessHours: {
        schedule: { mon: '09:00-18:00', tue: '09:00-18:00', wed: '09:00-18:00', thu: '09:00-18:00', fri: '09:00-18:00', sat: '09:00-15:00' },
        afterHoursMessage: { es: 'Fuera de horario, te respondo pronto.', en: 'After hours, will respond soon.', pt: 'Fora do horário.', fr: 'Hors horaires.' },
    },
    sidebar: { labelOverrides: { pipeline: { es: 'Cotizaciones', en: 'Quotes', pt: 'Cotações', fr: 'Devis' } }, hiddenItems: [] },
    dashboard: {
        kpis: [
            { key: 'leadsToday', label: { es: 'Consultas Hoy', en: 'Inquiries Today', pt: 'Consultas Hoje', fr: 'Demandes Aujourd\'hui' }, icon: 'Camera', color: '#3498db' },
            { key: 'leadsHot', label: { es: 'Cotizaciones', en: 'Quotes', pt: 'Cotações', fr: 'Devis' }, icon: 'FileSignature', color: '#e67e22' },
            { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
            { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Coût IA' }, icon: 'DollarSign', color: '#27ae60' },
        ],
    },
    bookingEnabled: true,
};

const SEGUROS: VerticalDefinition = {
    industry: 'seguros',
    subTypes: [
        { key: 'broker', label: { es: 'Broker / Corredor', en: 'Broker', pt: 'Corretor', fr: 'Courtier' } },
        { key: 'aseguradora', label: { es: 'Aseguradora', en: 'Insurance carrier', pt: 'Seguradora', fr: 'Compagnie d\'assurance' } },
        { key: 'vida', label: { es: 'Especialista en vida', en: 'Life insurance specialist', pt: 'Especialista em vida', fr: 'Spécialiste vie' } },
        { key: 'auto', label: { es: 'Especialista en auto', en: 'Auto insurance specialist', pt: 'Especialista em auto', fr: 'Spécialiste auto' } },
        { key: 'salud', label: { es: 'Especialista en salud', en: 'Health insurance specialist', pt: 'Especialista em saúde', fr: 'Spécialiste santé' } },
    ],
    terminology: {
        customerNoun: { es: 'asegurado', en: 'policyholder', pt: 'segurado', fr: 'assuré' },
        customerNounPlural: { es: 'asegurados', en: 'policyholders', pt: 'segurados', fr: 'assurés' },
        transactionNoun: { es: 'póliza', en: 'policy', pt: 'apólice', fr: 'police' },
        serviceNoun: { es: 'plan', en: 'plan', pt: 'plano', fr: 'plan' },
        pipelineNoun: { es: 'cotizaciones', en: 'quotes', pt: 'cotações', fr: 'devis' },
    },
    agent: {
        name: { es: 'Roberto', en: 'Robert', pt: 'Roberto', fr: 'Robert' },
        role: { es: 'Asesor de seguros', en: 'Insurance advisor', pt: 'Consultor de seguros', fr: 'Conseiller assurances' },
        tone: 'professional',
        formality: 'semi-formal',
        greeting: { es: 'Hola, soy Roberto, asesor de seguros. ¿En qué tipo de protección estás interesado?', en: 'Hello, I\'m Robert, insurance advisor. What type of coverage are you interested in?', pt: 'Olá, sou Roberto, consultor de seguros.', fr: 'Bonjour, je suis Robert, conseiller en assurances.' },
        rules: {
            es: 'Para cotizaciones siempre usa calculate_quote — no inventes primas. Aclara que las cotizaciones son preliminares y sujetas a suscripción. Para reclamos usa file_claim y escala al humano. Pide número de póliza para consultas existentes (check_policy_status). Recopila edad, email y teléfono antes de cotizar.',
            en: 'Use calculate_quote for quotes — never improvise premiums. State quotes are preliminary subject to underwriting. For claims, use file_claim and escalate to human. Ask for policy_number for existing inquiries.',
            pt: 'Para cotações use calculate_quote — não invente prêmios. Esclareça que cotações são preliminares.',
            fr: 'Pour les devis utilisez calculate_quote — n\'improvisez pas les primes.',
        },
        forbiddenTopics: {
            es: 'Asesoría legal sobre disputas|Consejos de inversión específicos|Detalles de pólizas de otros clientes|Promesas de aprobación de reclamos',
            en: 'Legal advice on disputes|Specific investment advice|Other clients policy details|Promises of claim approval',
            pt: 'Aconselhamento jurídico|Detalhes de outros clientes|Promessa de aprovação',
            fr: 'Conseils juridiques|Détails d\'autres clients|Promesses d\'approbation',
        },
        handoffTriggers: {
            es: 'reclamo|siniestro|cancelación|fraude|disputa|emergencia médica|denuncia',
            en: 'claim|incident|cancellation|fraud|dispute|emergency|formal complaint',
            pt: 'sinistro|cancelamento|fraude|disputa|emergência|reclamação',
            fr: 'sinistre|annulation|fraude|litige|urgence|plainte',
        },
    },
    pipeline: {
        stages: [
            { name: { es: 'Lead', en: 'Lead', pt: 'Lead', fr: 'Lead' }, slug: 'lead', color: '#3498db', probability: 10, isTerminal: false, transitionRules: [] },
            { name: { es: 'Calificado', en: 'Qualified', pt: 'Qualificado', fr: 'Qualifié' }, slug: 'calificado', color: '#f39c12', probability: 25, isTerminal: false, transitionRules: [{ type: 'name_required' }, { type: 'phone_required' }] },
            { name: { es: 'Cotizado', en: 'Quoted', pt: 'Cotado', fr: 'Devis envoyé' }, slug: 'cotizado', color: '#e67e22', probability: 50, isTerminal: false, transitionRules: [] },
            { name: { es: 'Propuesta enviada', en: 'Proposal sent', pt: 'Proposta enviada', fr: 'Proposition envoyée' }, slug: 'propuesta', color: '#9b59b6', probability: 70, isTerminal: false, transitionRules: [{ type: 'email_required' }] },
            { name: { es: 'Póliza emitida', en: 'Policy issued', pt: 'Apólice emitida', fr: 'Police émise' }, slug: 'poliza_emitida', color: '#2ecc71', probability: 100, isTerminal: true, transitionRules: [] },
            { name: { es: 'Renovación', en: 'Renewal', pt: 'Renovação', fr: 'Renouvellement' }, slug: 'renovacion', color: '#27ae60', probability: 95, isTerminal: false, transitionRules: [] },
            { name: { es: 'Perdido', en: 'Lost', pt: 'Perdido', fr: 'Perdu' }, slug: 'perdido', color: '#95a5a6', probability: 0, isTerminal: true, transitionRules: [] },
        ],
    },
    faqs: [
        { question: { es: '¿Qué tipos de seguros manejan?', en: 'What insurance types do you offer?', pt: 'Que tipos de seguro vocês têm?', fr: 'Quels types d\'assurance proposez-vous?' }, answer: { es: 'Cuéntame qué te interesa proteger (vida, salud, auto, hogar, empresa, viaje) y te confirmo qué ramos manejamos y con qué aseguradoras.', en: 'Tell me what you want to protect (life, health, auto, home, business, travel) and I will confirm which lines we handle and with which carriers.', pt: 'Me conte o que quer proteger (vida, saúde, auto, residência, empresa, viagem) e confirmo quais ramos atendemos.', fr: 'Dites-moi ce que vous souhaitez protéger (vie, santé, auto, habitation, entreprise, voyage) et je vous confirme les branches couvertes.' }, category: 'productos' },
        { question: { es: '¿Cuánto tarda la emisión de una póliza?', en: 'How long until a policy is issued?', pt: 'Quanto tempo para emitir uma apólice?', fr: 'Combien de temps pour émettre une police?' }, answer: { es: 'Una vez aprobada la suscripción te confirmamos el plazo de emisión: depende del ramo y de la aseguradora.', en: 'Once underwriting approves, we confirm the issuance timeline — it depends on the line and the carrier.', pt: 'Após a aprovação da subscrição confirmamos o prazo de emissão: depende do ramo e da seguradora.', fr: 'Une fois la souscription approuvée, nous vous confirmons le délai d\'émission: il dépend de la branche et de l\'assureur.' }, category: 'proceso' },
        { question: { es: '¿Cómo funciona un reclamo?', en: 'How does a claim work?', pt: 'Como funciona um sinistro?', fr: 'Comment fonctionne un sinistre?' }, answer: { es: 'Reportas el siniestro por chat y te asignamos un asesor que te acompaña con la documentación. Él te confirma los tiempos según tu póliza.', en: 'Report it via chat and we assign an advisor who guides you through the paperwork. They will confirm the timelines under your policy.', pt: 'Reporte pelo chat e designamos um consultor que te acompanha na documentação e confirma os prazos da sua apólice.', fr: 'Déclarez par chat et nous vous assignons un conseiller qui vous accompagne; il vous confirmera les délais selon votre police.' }, category: 'reclamos' },
        { question: { es: '¿Qué pasa si dejo de pagar?', en: 'What if I stop paying?', pt: 'E se eu parar de pagar?', fr: 'Que se passe-t-il si j\'arrête de payer?' }, answer: { es: 'Las condiciones de mora y de suspensión están en tu póliza y varían según el ramo. Cuéntanos tu caso y te confirmamos qué aplica antes de que se afecte tu cobertura.', en: 'Grace and lapse terms are set in your policy and vary by line. Tell us your case and we will confirm what applies before your coverage is affected.', pt: 'As condições de carência e suspensão estão na sua apólice e variam por ramo. Conte seu caso e confirmamos o que se aplica.', fr: 'Les délais de grâce et de suspension figurent dans votre police et varient selon la branche. Dites-nous votre cas.' }, category: 'pagos' },
        { question: { es: '¿Tienen descuentos por bundle?', en: 'Do you offer bundle discounts?', pt: 'Tem desconto em pacote?', fr: 'Avez-vous des réductions multi-contrats?' }, answer: { es: 'Combinar varias pólizas suele mejorar la propuesta. Cuéntame qué tienes contratado y te preparo una cotización con lo que aplique en tu caso.', en: 'Bundling several policies usually improves the offer. Tell me what you already have and I will prepare a quote with whatever applies to your case.', pt: 'Combinar várias apólices costuma melhorar a proposta. Me conte o que já tem e preparo uma cotação.', fr: 'Regrouper plusieurs polices améliore souvent l\'offre. Dites-moi ce que vous avez déjà et je prépare un devis.' }, category: 'descuentos' },
    ],
    services: [],
    businessHours: {
        schedule: { mon: '08:00-18:00', tue: '08:00-18:00', wed: '08:00-18:00', thu: '08:00-18:00', fri: '08:00-18:00', sat: '09:00-13:00' },
        afterHoursMessage: { es: 'Estamos fuera de horario. Para emergencias 24/7 llama al número en tu póliza.', en: 'After hours — for 24/7 emergencies call the number on your policy.', pt: 'Fora do horário.', fr: 'Hors horaires.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Asegurados', en: 'Policyholders', pt: 'Segurados', fr: 'Assurés' },
            pipeline: { es: 'Cotizaciones', en: 'Quotes', pt: 'Cotações', fr: 'Devis' },
        },
        hiddenItems: [],
    },
    dashboard: {
        kpis: [
            { key: 'leadsToday', label: { es: 'Leads Hoy', en: 'Leads Today', pt: 'Leads Hoje', fr: 'Leads Aujourd\'hui' }, icon: 'UserPlus', color: '#3498db' },
            { key: 'leadsHot', label: { es: 'Cotizaciones', en: 'Quotes', pt: 'Cotações', fr: 'Devis' }, icon: 'FileSignature', color: '#e67e22' },
            { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
            { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Coût IA' }, icon: 'DollarSign', color: '#27ae60' },
        ],
    },
    bookingEnabled: false,
};

const GIMNASIOS: VerticalDefinition = {
    industry: 'gimnasios',
    subTypes: [
        { key: 'gimnasio_general', label: { es: 'Gimnasio tradicional', en: 'Traditional gym', pt: 'Academia tradicional', fr: 'Salle de sport classique' } },
        { key: 'crossfit', label: { es: 'Box CrossFit', en: 'CrossFit box', pt: 'Box CrossFit', fr: 'Box CrossFit' } },
        { key: 'yoga_pilates', label: { es: 'Estudio de yoga / pilates', en: 'Yoga / pilates studio', pt: 'Estúdio de yoga / pilates', fr: 'Studio yoga / pilates' } },
        { key: 'cycling', label: { es: 'Cycling / spinning', en: 'Cycling / spinning', pt: 'Cycling / spinning', fr: 'Cycling / spinning' } },
        { key: 'martial_arts', label: { es: 'Artes marciales', en: 'Martial arts', pt: 'Artes marciais', fr: 'Arts martiaux' } },
    ],
    terminology: {
        customerNoun: { es: 'miembro', en: 'member', pt: 'aluno', fr: 'membre' },
        customerNounPlural: { es: 'miembros', en: 'members', pt: 'alunos', fr: 'membres' },
        transactionNoun: { es: 'inscripción', en: 'membership', pt: 'matrícula', fr: 'adhésion' },
        serviceNoun: { es: 'plan', en: 'plan', pt: 'plano', fr: 'plan' },
        pipelineNoun: { es: 'inscripciones', en: 'memberships', pt: 'matrículas', fr: 'adhésions' },
    },
    agent: {
        name: { es: 'Alex', en: 'Alex', pt: 'Alex', fr: 'Alex' },
        role: { es: 'Asistente del gimnasio', en: 'Gym assistant', pt: 'Assistente da academia', fr: 'Assistant du club' },
        tone: 'energetic',
        formality: 'casual',
        greeting: { es: '¡Hey! Soy Alex, asistente del gym. ¿Quieres conocer planes, agendar una clase o info de horarios?', en: 'Hey! I\'m Alex, your gym assistant. Want to check plans, book a class, or know our schedule?', pt: 'Oi! Sou Alex, assistente da academia. Quer conhecer planos, marcar uma aula ou saber horários?', fr: 'Salut! Je suis Alex, assistant du club. Vous voulez découvrir les forfaits, réserver un cours ou connaître les horaires?' },
        rules: {
            es: 'Llama "miembro" al cliente activo y "interesado" al lead. Antes de reservar una clase usa get_my_membership para verificar crédito. Para precios y planes usa get_membership_plans — no improvises montos. Promueve cross-selling de personal training cuando aplique.',
            en: 'Call active customers "members" and leads "prospects". Before booking a class, call get_my_membership to verify credit. Use get_membership_plans for prices — never improvise amounts. Cross-sell personal training when relevant.',
            pt: 'Chame os clientes ativos de "membros" e leads de "interessados". Antes de marcar uma aula use get_my_membership.',
            fr: 'Appelez les clients actifs "membres" et les leads "prospects". Vérifiez le crédit avant la réservation.',
        },
        forbiddenTopics: {
            es: 'Diagnósticos médicos|Recomendaciones de suplementos|Planes nutricionales detallados|Datos de otros miembros',
            en: 'Medical diagnoses|Supplement recommendations|Detailed nutrition plans|Other members data',
            pt: 'Diagnósticos médicos|Recomendações de suplementos|Planos de nutrição',
            fr: 'Diagnostics médicaux|Recommandations de compléments|Plans nutritionnels',
        },
        handoffTriggers: {
            es: 'lesion|emergencia medica|reembolso|queja formal|cancelacion definitiva',
            en: 'injury|medical emergency|refund|formal complaint|cancellation',
            pt: 'lesao|emergencia|reembolso|reclamacao|cancelamento',
            fr: 'blessure|urgence|remboursement|plainte|annulation',
        },
    },
    pipeline: {
        stages: [
            { name: { es: 'Interesado', en: 'Prospect', pt: 'Interessado', fr: 'Prospect' }, slug: 'interesado', color: '#3498db', probability: 10, isTerminal: false, transitionRules: [] },
            { name: { es: 'Trial / Pase invitado', en: 'Trial / Guest pass', pt: 'Trial / Convidado', fr: 'Essai / Invité' }, slug: 'trial', color: '#f39c12', probability: 30, isTerminal: false, transitionRules: [{ type: 'name_required' }, { type: 'phone_required' }] },
            { name: { es: 'Inscrito', en: 'Enrolled', pt: 'Matriculado', fr: 'Inscrit' }, slug: 'inscrito', color: '#e67e22', probability: 60, isTerminal: false, transitionRules: [{ type: 'email_required' }] },
            { name: { es: 'Activo', en: 'Active member', pt: 'Membro ativo', fr: 'Membre actif' }, slug: 'activo', color: '#2ecc71', probability: 90, isTerminal: false, transitionRules: [] },
            { name: { es: 'Renovación', en: 'Renewal', pt: 'Renovação', fr: 'Renouvellement' }, slug: 'renovacion', color: '#27ae60', probability: 95, isTerminal: false, transitionRules: [] },
            { name: { es: 'Inactivo', en: 'Lapsed', pt: 'Inativo', fr: 'Inactif' }, slug: 'inactivo', color: '#95a5a6', probability: 0, isTerminal: true, transitionRules: [] },
        ],
    },
    faqs: [
        { question: { es: '¿Qué planes tienen?', en: 'What plans do you offer?', pt: 'Quais planos têm?', fr: 'Quels forfaits proposez-vous?' }, answer: { es: 'Cuéntame tu objetivo y con qué frecuencia entrenas, y te muestro los planes vigentes con lo que incluye cada uno.', en: 'Tell me your goal and how often you train, and I will show you the current plans and what each one includes.', pt: 'Me conte seu objetivo e a frequência de treino e mostro os planos vigentes com o que cada um inclui.', fr: 'Dites-moi votre objectif et votre fréquence d\'entraînement et je vous montre les forfaits en cours.' }, category: 'planes' },
        { question: { es: '¿Puedo congelar mi membresía si viajo?', en: 'Can I freeze my membership if I travel?', pt: 'Posso congelar a matrícula em viagem?', fr: 'Puis-je geler mon adhésion?' }, answer: { es: 'Cuéntame qué plan tienes y te confirmo si incluye congelamiento y por cuántos días.', en: 'Tell me which plan you have and I will confirm whether it includes a freeze and for how many days.', pt: 'Me diga qual plano você tem e confirmo se inclui congelamento e por quantos dias.', fr: 'Dites-moi quel forfait vous avez et je vous confirme s\'il inclut un gel et pour combien de jours.' }, category: 'membresia' },
        { question: { es: '¿Tienen clases grupales?', en: 'Do you offer group classes?', pt: 'Tem aulas em grupo?', fr: 'Avez-vous des cours collectifs?' }, answer: { es: 'Pregúntame por la programación de clases y te digo qué hay disponible esta semana. Puedes reservar tu cupo por aquí.', en: 'Ask me about the class schedule and I will tell you what is available this week. You can book your spot right here.', pt: 'Pergunte pela grade de aulas e digo o que há disponível esta semana; pode reservar por aqui.', fr: 'Demandez-moi le planning des cours et je vous dirai ce qui est disponible cette semaine.' }, category: 'clases' },
        { question: { es: '¿Tienen sesiones de personal training?', en: 'Do you offer personal training?', pt: 'Tem personal training?', fr: 'Avez-vous des séances de coaching personnel?' }, answer: { es: 'Cuéntame tu objetivo y te confirmo si tu plan incluye sesiones con entrenador o cómo se contratan aparte.', en: 'Tell me your goal and I will confirm whether your plan includes trainer sessions or how to book them separately.', pt: 'Me conte seu objetivo e confirmo se o seu plano inclui sessões com treinador ou como contratar à parte.', fr: 'Dites-moi votre objectif et je vous confirme si votre forfait inclut des séances avec un coach.' }, category: 'personal_training' },
        { question: { es: '¿Cuál es el horario?', en: 'What are your hours?', pt: 'Qual o horário?', fr: 'Quels sont vos horaires?' }, answer: { es: 'Dime qué día quieres venir y te confirmo el horario de esa jornada.', en: 'Tell me which day you want to come and I will confirm the hours for that day.', pt: 'Me diga qual dia quer vir e confirmo o horário daquele dia.', fr: 'Dites-moi quel jour vous souhaitez venir et je vous confirme les horaires.' }, category: 'horarios' },
    ],
    services: [
        { name: { es: 'Plan Mensual', en: 'Monthly plan', pt: 'Plano mensal', fr: 'Forfait mensuel' }, description: { es: 'Acceso ilimitado al gym + 8 clases grupales/mes', en: 'Unlimited gym + 8 group classes/month', pt: 'Acesso ilimitado + 8 aulas/mês', fr: 'Accès illimité + 8 cours/mois' }, durationMinutes: 30, price: 150000, currency: 'COP', category: 'plan' },
        { name: { es: 'Trial 1 día', en: '1-day trial', pt: 'Trial 1 dia', fr: 'Essai 1 jour' }, description: { es: 'Prueba el gym por un día sin compromiso', en: 'Try the gym for one day, no commitment', pt: 'Experimente por um dia', fr: 'Essai sans engagement' }, durationMinutes: 60, price: 0, currency: 'COP', category: 'trial' },
        { name: { es: 'Personal Training (sesión)', en: 'Personal training (session)', pt: 'Personal training (sessão)', fr: 'Coaching personnel (séance)' }, description: { es: 'Sesión individual con entrenador certificado', en: 'One-on-one session with certified trainer', pt: 'Sessão individual', fr: 'Séance individuelle' }, durationMinutes: 60, price: 80000, currency: 'COP', category: 'personal_training' },
    ],
    businessHours: {
        schedule: { mon: '05:00-23:00', tue: '05:00-23:00', wed: '05:00-23:00', thu: '05:00-23:00', fri: '05:00-23:00', sat: '07:00-20:00', sun: '07:00-20:00' },
        afterHoursMessage: { es: 'Estamos cerrados. Te respondo en cuanto abramos.', en: 'We are closed. We will respond when we open.', pt: 'Estamos fechados.', fr: 'Nous sommes fermés.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Miembros', en: 'Members', pt: 'Alunos', fr: 'Membres' },
            pipeline: { es: 'Inscripciones', en: 'Enrollments', pt: 'Matrículas', fr: 'Inscriptions' },
            appointments: { es: 'Reservas', en: 'Bookings', pt: 'Reservas', fr: 'Réservations' },
        },
        hiddenItems: [],
    },
    dashboard: {
        kpis: [
            { key: 'leadsToday', label: { es: 'Interesados Hoy', en: 'Prospects Today', pt: 'Interessados Hoje', fr: 'Prospects Aujourd\'hui' }, icon: 'UserPlus', color: '#3498db' },
            { key: 'appointmentsToday', label: { es: 'Reservas Clases', en: 'Class Bookings', pt: 'Reservas Aulas', fr: 'Réservations Cours' }, icon: 'Dumbbell', color: '#2ecc71' },
            { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
            { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Coût IA' }, icon: 'DollarSign', color: '#e67e22' },
        ],
    },
    bookingEnabled: true,
};

const VETERINARIA: VerticalDefinition = {
    industry: 'veterinaria',
    subTypes: [
        { key: 'clinica_general', label: { es: 'Clínica de pequeñas especies', en: 'Small animal clinic', pt: 'Clínica de pequenos animais', fr: 'Clinique petits animaux' } },
        { key: 'hospital_24h', label: { es: 'Hospital veterinario 24h', en: '24h veterinary hospital', pt: 'Hospital veterinário 24h', fr: 'Hôpital vétérinaire 24h' } },
        { key: 'exoticos', label: { es: 'Animales exóticos', en: 'Exotic animals', pt: 'Animais exóticos', fr: 'Animaux exotiques' } },
        { key: 'peluqueria_canina', label: { es: 'Peluquería canina / felina', en: 'Pet grooming', pt: 'Banho e tosa', fr: 'Toilettage' } },
    ],
    terminology: {
        customerNoun: { es: 'tutor', en: 'pet parent', pt: 'tutor', fr: 'tuteur' },
        customerNounPlural: { es: 'tutores', en: 'pet parents', pt: 'tutores', fr: 'tuteurs' },
        transactionNoun: { es: 'consulta', en: 'consultation', pt: 'consulta', fr: 'consultation' },
        serviceNoun: { es: 'servicio veterinario', en: 'veterinary service', pt: 'serviço veterinário', fr: 'service vétérinaire' },
        pipelineNoun: { es: 'seguimiento', en: 'patient journey', pt: 'acompanhamento', fr: 'suivi' },
    },
    agent: {
        name: { es: 'Dra. Ana', en: 'Dr. Ana', pt: 'Dra. Ana', fr: 'Dr. Ana' },
        role: { es: 'Asistente de la clínica veterinaria', en: 'Veterinary clinic assistant', pt: 'Assistente da clínica veterinária', fr: 'Assistante de la clinique vétérinaire' },
        tone: 'warm',
        formality: 'semi-formal',
        greeting: { es: '¡Hola! Soy Ana, asistente de la clínica veterinaria. ¿Cómo puedo ayudarte con tu mascota hoy?', en: 'Hi! I am Ana, the veterinary clinic assistant. How can I help your pet today?', pt: 'Olá! Sou Ana, assistente da clínica veterinária. Como posso ajudar seu pet?', fr: 'Bonjour! Je suis Ana, assistante de la clinique vétérinaire. Comment puis-je aider votre animal?' },
        rules: {
            es: 'Llama "tutor" al dueño y "paciente" a la mascota. Siempre verifica cuál mascota antes de agendar. Nunca des diagnósticos ni nombres de medicamentos. Para urgencias escala inmediatamente.',
            en: 'Call the owner "pet parent" and the animal "patient". Always verify which pet before scheduling. Never provide diagnoses or medication names. Escalate emergencies immediately.',
            pt: 'Chame o dono de "tutor" e o animal de "paciente". Sempre verifique qual pet antes de agendar. Nunca forneça diagnósticos.',
            fr: 'Appelez le propriétaire "tuteur" et l\'animal "patient". Vérifiez toujours de quel animal il s\'agit avant de planifier. Ne jamais fournir de diagnostics.',
        },
        forbiddenTopics: {
            es: 'Diagnósticos veterinarios|Prescripción de medicamentos|Dosis|Eutanasia|Pronóstico de enfermedad|Interpretación de exámenes|Datos de otras mascotas',
            en: 'Veterinary diagnoses|Medication prescription|Dosing|Euthanasia|Disease prognosis|Test interpretation|Other patients data',
            pt: 'Diagnósticos veterinários|Prescrição de medicamentos|Doses|Eutanásia|Prognósticos|Interpretação de exames',
            fr: 'Diagnostics vétérinaires|Prescription de médicaments|Doses|Euthanasie|Pronostics|Interprétation d\'examens',
        },
        handoffTriggers: {
            es: 'sangrado|no respira|inconsciente|envenenamiento|atropellado|parto complicado|convulsion|eutanasia|queja formal',
            en: 'bleeding|not breathing|unconscious|poisoning|hit by car|complicated birth|seizure|euthanasia|formal complaint',
            pt: 'sangrando|nao respira|inconsciente|envenenamento|atropelado|parto complicado|convulsao|eutanasia',
            fr: 'saignement|ne respire pas|inconscient|empoisonnement|renverse|accouchement complique|convulsion|euthanasie',
        },
    },
    pipeline: {
        stages: [
            { name: { es: 'Consulta inicial', en: 'Initial inquiry', pt: 'Consulta inicial', fr: 'Demande initiale' }, slug: 'consulta_inicial', color: '#3498db', probability: 10, isTerminal: false, transitionRules: [] },
            { name: { es: 'Cita agendada', en: 'Appointment scheduled', pt: 'Consulta agendada', fr: 'Rendez-vous planifié' }, slug: 'cita_agendada', color: '#f39c12', probability: 30, isTerminal: false, transitionRules: [{ type: 'appointment_required' }] },
            { name: { es: 'Primera visita', en: 'First visit', pt: 'Primeira visita', fr: 'Première visite' }, slug: 'primera_visita', color: '#e67e22', probability: 50, isTerminal: false, transitionRules: [{ type: 'name_required' }, { type: 'phone_required' }] },
            { name: { es: 'Paciente activo', en: 'Active patient', pt: 'Paciente ativo', fr: 'Patient actif' }, slug: 'paciente_activo', color: '#2ecc71', probability: 80, isTerminal: false, transitionRules: [{ type: 'email_required' }] },
            { name: { es: 'Plan de vacunación', en: 'Vaccination plan', pt: 'Plano de vacinação', fr: 'Plan de vaccination' }, slug: 'plan_vacunacion', color: '#27ae60', probability: 90, isTerminal: false, transitionRules: [] },
            { name: { es: 'Alta', en: 'Discharged', pt: 'Alta', fr: 'Sorti' }, slug: 'alta', color: '#95a5a6', probability: 100, isTerminal: true, transitionRules: [] },
        ],
    },
    faqs: [
        { question: { es: '¿Atienden urgencias?', en: 'Do you handle emergencies?', pt: 'Atendem urgências?', fr: 'Gérez-vous les urgences?' }, answer: { es: 'En horario de atención damos prioridad a las urgencias. Fuera de horario, dirígete al hospital veterinario 24h más cercano.', en: 'During business hours we prioritize emergencies. After hours, go to the nearest 24h veterinary hospital.', pt: 'Em horário de atendimento damos prioridade às urgências. Fora do horário, vá ao hospital veterinário 24h mais próximo.', fr: 'Pendant les heures d\'ouverture nous priorisons les urgences. En dehors, allez à l\'hôpital vétérinaire 24h le plus proche.' }, category: 'urgencias' },
        { question: { es: '¿Qué vacunas necesita mi mascota?', en: 'What vaccines does my pet need?', pt: 'Que vacinas meu pet precisa?', fr: 'Quels vaccins pour mon animal?' }, answer: { es: 'Depende de la especie, la edad y el estilo de vida. Agenda una consulta y el médico te indicará el plan de vacunación adecuado.', en: 'It depends on the species, age and lifestyle. Schedule a consultation and the vet will recommend the right vaccination plan.', pt: 'Depende da espécie, idade e estilo de vida. Agende uma consulta e o veterinário indicará o plano correto.', fr: 'Cela dépend de l\'espèce, de l\'âge et du mode de vie. Prenez rendez-vous pour un plan adapté.' }, category: 'vacunas' },
        { question: { es: '¿Hacen esterilización?', en: 'Do you perform spay/neuter surgery?', pt: 'Fazem castração?', fr: 'Faites-vous la stérilisation?' }, answer: { es: 'Cuéntanos de tu mascota y te confirmamos si podemos hacerlo aquí. El equipo te indicará las preparaciones previas (ayuno, revisión general) antes del procedimiento.', en: 'Tell us about your pet and we will confirm whether we can do it here. The team will tell you the required preparations (fasting, general check-up) before the procedure.', pt: 'Conte-nos sobre seu pet e confirmamos se podemos fazer aqui. A equipe indicará os preparos prévios (jejum, check-up).', fr: 'Parlez-nous de votre animal et nous confirmerons si nous pouvons le faire ici. L\'équipe vous indiquera les préparations requises (jeûne, bilan général).' }, category: 'cirugias' },
        { question: { es: '¿Atienden mascotas exóticas?', en: 'Do you treat exotic pets?', pt: 'Atendem pets exóticos?', fr: 'Soignez-vous les NAC?' }, answer: { es: 'Cuéntanos qué especie es y te confirmamos si podemos atenderla.', en: 'Tell us the species and we will confirm whether we can treat it.', pt: 'Conte-nos a espécie e confirmamos se podemos atender.', fr: 'Dites-nous l\'espèce et nous confirmerons si nous pouvons la soigner.' }, category: 'general' },
        { question: { es: '¿Cómo funciona el plan integral / preventivo?', en: 'How does the wellness plan work?', pt: 'Como funciona o plano preventivo?', fr: 'Comment fonctionne le plan de bien-être?' }, answer: { es: 'Cuéntanos qué mascota tienes y te explicamos qué cubre nuestro plan preventivo y cómo se contrata. También puedes preguntarlo en tu primera visita.', en: 'Tell us about your pet and we will explain what our wellness plan covers and how to sign up. You can also ask at your first visit.', pt: 'Conte-nos sobre seu pet e explicamos o que o plano preventivo cobre e como contratar.', fr: 'Parlez-nous de votre animal et nous vous expliquerons ce que couvre notre plan de prévention.' }, category: 'planes' },
    ],
    services: [
        { name: { es: 'Consulta general', en: 'General consultation', pt: 'Consulta geral', fr: 'Consultation générale' }, description: { es: 'Consulta veterinaria general', en: 'General veterinary consultation', pt: 'Consulta veterinária geral', fr: 'Consultation vétérinaire générale' }, durationMinutes: 30, price: 60000, currency: 'COP', category: 'consulta' },
        { name: { es: 'Vacunación', en: 'Vaccination', pt: 'Vacinação', fr: 'Vaccination' }, description: { es: 'Aplicación de vacuna', en: 'Vaccine application', pt: 'Aplicação de vacina', fr: 'Application de vaccin' }, durationMinutes: 20, price: 50000, currency: 'COP', category: 'preventiva' },
        { name: { es: 'Desparasitación', en: 'Deworming', pt: 'Vermifugação', fr: 'Vermifugation' }, description: { es: 'Desparasitación interna y externa', en: 'Internal and external deworming', pt: 'Vermifugação interna e externa', fr: 'Vermifugation' }, durationMinutes: 15, price: 35000, currency: 'COP', category: 'preventiva' },
        { name: { es: 'Baño y peluquería', en: 'Bathing and grooming', pt: 'Banho e tosa', fr: 'Bain et toilettage' }, description: { es: 'Servicio de peluquería', en: 'Grooming service', pt: 'Serviço de banho e tosa', fr: 'Service de toilettage' }, durationMinutes: 60, price: 80000, currency: 'COP', category: 'estetica' },
    ],
    businessHours: {
        schedule: { mon: '08:00-18:00', tue: '08:00-18:00', wed: '08:00-18:00', thu: '08:00-18:00', fri: '08:00-18:00', sat: '08:00-13:00' },
        afterHoursMessage: { es: 'Estamos fuera de horario. En caso de urgencia veterinaria dirígete al hospital 24h más cercano. Para consultas no urgentes te responderemos al iniciar la jornada.', en: 'We are closed. For emergencies go to the nearest 24h vet hospital. For non-urgent inquiries we will reply when we open.', pt: 'Estamos fora do horário. Para urgências vá ao hospital 24h mais próximo.', fr: 'Nous sommes fermés. Pour les urgences allez à l\'hôpital vétérinaire 24h le plus proche.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Tutores', en: 'Pet Parents', pt: 'Tutores', fr: 'Tuteurs' },
            pipeline: { es: 'Seguimiento', en: 'Patient Journey', pt: 'Acompanhamento', fr: 'Suivi' },
            appointments: { es: 'Agenda', en: 'Schedule', pt: 'Agenda', fr: 'Agenda' },
        },
        hiddenItems: [],
    },
    dashboard: {
        kpis: [
            { key: 'leadsToday', label: { es: 'Tutores Hoy', en: 'Pet Parents Today', pt: 'Tutores Hoje', fr: 'Tuteurs Aujourd\'hui' }, icon: 'PawPrint', color: '#3498db' },
            { key: 'appointmentsToday', label: { es: 'Citas Hoy', en: 'Appointments Today', pt: 'Consultas Hoje', fr: 'RDV Aujourd\'hui' }, icon: 'Calendar', color: '#2ecc71' },
            { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
            { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Coût IA' }, icon: 'DollarSign', color: '#e67e22' },
        ],
    },
    bookingEnabled: true,
};

const OTRO = createGenericVertical('otro', {});

// ─────────────────────────────────────────────────────────
// REGISTRY — The single lookup map
// ─────────────────────────────────────────────────────────

export const VERTICAL_REGISTRY: Record<string, VerticalDefinition> = {
    salud: SALUD,
    moda_belleza: MODA_BELLEZA,
    inmobiliaria: INMOBILIARIA,
    restaurantes: RESTAURANTES,
    automotriz: AUTOMOTRIZ,
    turismo: TURISMO,
    education: EDUCATION,
    finanzas: FINANZAS,
    servicios_profesionales: SERVICIOS_PROFESIONALES,
    retail: RETAIL,
    technology: TECHNOLOGY,
    veterinaria: VETERINARIA,
    gimnasios: GIMNASIOS,
    seguros: SEGUROS,
    servicios_hogar: SERVICIOS_HOGAR,
    pet_services: PET_SERVICES,
    fotografia: FOTOGRAFIA,
    otro: OTRO,
};

export function getVerticalDefinition(industry: string): VerticalDefinition {
    return VERTICAL_REGISTRY[industry] || VERTICAL_REGISTRY['otro'];
}
