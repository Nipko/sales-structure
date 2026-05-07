/**
 * Vertical Industry Definitions — The single source of truth for all industry-specific
 * configurations in Parallly. Each entry defines how the platform adapts when a tenant
 * selects that industry during onboarding.
 *
 * Structure: VERTICAL_REGISTRY is a Map<industrySlug, VerticalDefinition>
 * All strings are localized: { es, en, pt, fr }
 */
import { VerticalDefinition } from '@parallext/shared';

// ─────────────────────────────────────────────────────────
// 1. SALUD (Healthcare)
// ─────────────────────────────────────────────────────────
const SALUD: VerticalDefinition = {
    industry: 'salud',
    subTypes: [
        { key: 'dental', label: { es: 'Odontologia', en: 'Dental', pt: 'Odontologia', fr: 'Dentaire' } },
        { key: 'medica_general', label: { es: 'Medicina general', en: 'General medicine', pt: 'Medicina geral', fr: 'Medecine generale' } },
        { key: 'estetica', label: { es: 'Estetica y dermatologia', en: 'Aesthetics & dermatology', pt: 'Estetica e dermatologia', fr: 'Esthetique et dermatologie' } },
        { key: 'psicologia', label: { es: 'Psicologia y terapia', en: 'Psychology & therapy', pt: 'Psicologia e terapia', fr: 'Psychologie et therapie' } },
        { key: 'farmacia', label: { es: 'Farmacia', en: 'Pharmacy', pt: 'Farmacia', fr: 'Pharmacie' } },
    ],
    terminology: {
        customerNoun: { es: 'paciente', en: 'patient', pt: 'paciente', fr: 'patient' },
        customerNounPlural: { es: 'pacientes', en: 'patients', pt: 'pacientes', fr: 'patients' },
        transactionNoun: { es: 'consulta', en: 'consultation', pt: 'consulta', fr: 'consultation' },
        serviceNoun: { es: 'servicio medico', en: 'medical service', pt: 'servico medico', fr: 'service medical' },
        pipelineNoun: { es: 'seguimiento', en: 'patient journey', pt: 'acompanhamento', fr: 'suivi' },
    },
    agent: {
        name: { es: 'Sofia', en: 'Sofia', pt: 'Sofia', fr: 'Sofia' },
        role: { es: 'Asistente de atencion al paciente', en: 'Patient care assistant', pt: 'Assistente de atendimento ao paciente', fr: 'Assistante de soins aux patients' },
        tone: 'professional',
        formality: 'formal',
        greeting: { es: 'Hola, soy Sofia, asistente de la clinica. ¿En que puedo ayudarte?', en: 'Hello, I am Sofia, the clinic assistant. How can I help you?', pt: 'Ola, sou Sofia, assistente da clinica. Como posso ajudar?', fr: 'Bonjour, je suis Sofia, assistante de la clinique. Comment puis-je vous aider?' },
        rules: {
            es: 'Siempre ofrece agendar una cita cuando el paciente describe sintomas. Nunca brindes diagnosticos ni recomiendes medicamentos. Refiere a consulta presencial cuando haya dudas clinicas.',
            en: 'Always offer to schedule an appointment when the patient describes symptoms. Never provide diagnoses or recommend medications. Refer to in-person consultation for clinical questions.',
            pt: 'Sempre ofereça agendar uma consulta quando o paciente descrever sintomas. Nunca forneca diagnosticos nem recomende medicamentos.',
            fr: 'Proposez toujours de prendre rendez-vous lorsque le patient decrit des symptomes. Ne jamais fournir de diagnostics ni recommander de medicaments.',
        },
        forbiddenTopics: {
            es: 'Diagnosticos medicos|Prescripcion de medicamentos|Interpretacion de examenes|Datos de otros pacientes|Recomendacion de tratamientos especificos',
            en: 'Medical diagnoses|Medication prescription|Test interpretation|Other patients data|Specific treatment recommendations',
            pt: 'Diagnosticos medicos|Prescricao de medicamentos|Interpretacao de exames|Dados de outros pacientes|Recomendacao de tratamentos especificos',
            fr: 'Diagnostics medicaux|Prescription de medicaments|Interpretation d\'examens|Donnees d\'autres patients|Recommandation de traitements specifiques',
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
            { name: { es: 'Consulta inicial', en: 'Initial inquiry', pt: 'Consulta inicial', fr: 'Consultation initiale' }, slug: 'consulta_inicial', color: '#3498db', probability: 10, isTerminal: false },
            { name: { es: 'Cita agendada', en: 'Appointment scheduled', pt: 'Consulta agendada', fr: 'Rendez-vous programme' }, slug: 'cita_agendada', color: '#f39c12', probability: 30, isTerminal: false },
            { name: { es: 'Primera visita', en: 'First visit', pt: 'Primeira visita', fr: 'Premiere visite' }, slug: 'primera_visita', color: '#e67e22', probability: 50, isTerminal: false },
            { name: { es: 'Paciente activo', en: 'Active patient', pt: 'Paciente ativo', fr: 'Patient actif' }, slug: 'paciente_activo', color: '#2ecc71', probability: 80, isTerminal: false },
            { name: { es: 'Seguimiento', en: 'Follow-up', pt: 'Acompanhamento', fr: 'Suivi' }, slug: 'seguimiento', color: '#27ae60', probability: 90, isTerminal: false },
            { name: { es: 'Alta', en: 'Discharged', pt: 'Alta', fr: 'Sorti' }, slug: 'alta', color: '#95a5a6', probability: 100, isTerminal: true },
        ],
    },
    faqs: [
        { question: { es: '¿Cual es el horario de atencion?', en: 'What are your office hours?', pt: 'Qual e o horario de atendimento?', fr: 'Quels sont vos horaires?' }, answer: { es: 'Atendemos de lunes a viernes de 8:00 AM a 6:00 PM y sabados de 8:00 AM a 1:00 PM. Para agendar tu cita escribe "quiero una cita".', en: 'We are open Monday to Friday 8:00 AM to 6:00 PM and Saturdays 8:00 AM to 1:00 PM. To schedule an appointment write "I want an appointment".', pt: 'Atendemos de segunda a sexta das 8h as 18h e sabados das 8h as 13h.', fr: 'Nous sommes ouverts du lundi au vendredi de 8h a 18h et le samedi de 8h a 13h.' }, category: 'general' },
        { question: { es: '¿Cuales son los metodos de pago?', en: 'What payment methods do you accept?', pt: 'Quais sao as formas de pagamento?', fr: 'Quels modes de paiement acceptez-vous?' }, answer: { es: 'Aceptamos efectivo, tarjeta debito/credito y transferencia bancaria. Tambien trabajamos con las principales aseguradoras.', en: 'We accept cash, debit/credit card and bank transfer. We also work with major insurance providers.', pt: 'Aceitamos dinheiro, cartao de debito/credito e transferencia bancaria.', fr: 'Nous acceptons les especes, cartes de debit/credit et virement bancaire.' }, category: 'pagos' },
        { question: { es: '¿Que hago en caso de emergencia?', en: 'What should I do in an emergency?', pt: 'O que fazer em caso de emergencia?', fr: 'Que faire en cas d\'urgence?' }, answer: { es: 'En caso de emergencia, dirígete a urgencias del hospital mas cercano o llama al 123. Para urgencias menores durante horario de atencion, escribenos y te atenderemos prioritariamente.', en: 'In case of emergency, go to the nearest hospital ER or call 911. For minor urgencies during office hours, contact us for priority care.', pt: 'Em caso de emergencia, va ao pronto-socorro mais proximo ou ligue 192.', fr: 'En cas d\'urgence, rendez-vous aux urgences les plus proches ou appelez le 15.' }, category: 'emergencias' },
        { question: { es: '¿Como cancelo o reprogramo una cita?', en: 'How do I cancel or reschedule?', pt: 'Como cancelo ou remarco uma consulta?', fr: 'Comment annuler ou reprogrammer?' }, answer: { es: 'Puedes cancelar o reprogramar tu cita con al menos 24 horas de anticipacion escribiendo "cancelar cita" o "reprogramar cita". Cancelaciones tardias pueden generar cargo.', en: 'You can cancel or reschedule at least 24 hours in advance by writing "cancel appointment" or "reschedule". Late cancellations may incur a fee.', pt: 'Voce pode cancelar ou remarcar com pelo menos 24 horas de antecedencia.', fr: 'Vous pouvez annuler ou reprogrammer au moins 24 heures a l\'avance.' }, category: 'citas' },
        { question: { es: '¿Que documentos necesito para la primera visita?', en: 'What documents do I need for the first visit?', pt: 'Que documentos preciso para a primeira visita?', fr: 'Quels documents sont necessaires pour la premiere visite?' }, answer: { es: 'Para tu primera visita necesitas tu documento de identidad, carnet de seguro medico (si aplica) y cualquier examen previo relacionado con tu consulta.', en: 'For your first visit bring your ID, insurance card (if applicable) and any previous test results related to your consultation.', pt: 'Para sua primeira visita traga seu documento de identidade, carteirinha do convenio (se aplicavel) e exames anteriores.', fr: 'Pour votre premiere visite apportez votre piece d\'identite, carte d\'assurance (si applicable) et examens anterieurs.' }, category: 'general' },
    ],
    services: [
        { name: { es: 'Consulta general', en: 'General consultation', pt: 'Consulta geral', fr: 'Consultation generale' }, description: { es: 'Consulta medica general con el especialista', en: 'General medical consultation', pt: 'Consulta medica geral', fr: 'Consultation medicale generale' }, durationMinutes: 30, price: 80000, currency: 'COP', category: 'consulta' },
        { name: { es: 'Consulta especializada', en: 'Specialist consultation', pt: 'Consulta especializada', fr: 'Consultation specialisee' }, description: { es: 'Consulta con especialista o procedimiento diagnostico', en: 'Specialist consultation or diagnostic procedure', pt: 'Consulta com especialista', fr: 'Consultation avec specialiste' }, durationMinutes: 45, price: 120000, currency: 'COP', category: 'consulta' },
        { name: { es: 'Control y seguimiento', en: 'Follow-up visit', pt: 'Consulta de retorno', fr: 'Visite de suivi' }, description: { es: 'Cita de control o seguimiento de tratamiento', en: 'Treatment follow-up appointment', pt: 'Consulta de acompanhamento', fr: 'Rendez-vous de suivi' }, durationMinutes: 20, price: 50000, currency: 'COP', category: 'control' },
    ],
    businessHours: {
        schedule: { mon: '08:00-18:00', tue: '08:00-18:00', wed: '08:00-18:00', thu: '08:00-18:00', fri: '08:00-18:00', sat: '08:00-13:00' },
        afterHoursMessage: { es: 'Estamos fuera de horario. Te responderemos en cuanto abramos. En caso de emergencia, dirígete a urgencias.', en: 'We are currently closed. We will respond when we open. In case of emergency, go to the ER.', pt: 'Estamos fora do horario. Responderemos quando abrirmos.', fr: 'Nous sommes fermes. Nous repondrons a l\'ouverture.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Pacientes', en: 'Patients', pt: 'Pacientes', fr: 'Patients' },
            pipeline: { es: 'Seguimiento', en: 'Patient Journey', pt: 'Acompanhamento', fr: 'Suivi' },
            appointments: { es: 'Agenda Medica', en: 'Medical Schedule', pt: 'Agenda Medica', fr: 'Agenda Medicale' },
        },
        hiddenItems: [],
    },
    dashboard: {
        kpis: [
            { key: 'appointmentsToday', label: { es: 'Citas Hoy', en: 'Appointments Today', pt: 'Consultas Hoje', fr: 'Rendez-vous Aujourd\'hui' }, icon: 'Calendar', color: '#3498db' },
            { key: 'leadsToday', label: { es: 'Pacientes Nuevos', en: 'New Patients', pt: 'Pacientes Novos', fr: 'Nouveaux Patients' }, icon: 'UserPlus', color: '#2ecc71' },
            { key: 'noShowsWeek', label: { es: 'No Shows (semana)', en: 'No Shows (week)', pt: 'Faltas (semana)', fr: 'Absences (semaine)' }, icon: 'UserX', color: '#e74c3c' },
            { key: 'messagesProcessed', label: { es: 'Mensajes Procesados', en: 'Messages Processed', pt: 'Mensagens Processadas', fr: 'Messages Traites' }, icon: 'MessageSquare', color: '#9b59b6' },
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
        { key: 'salon_belleza', label: { es: 'Salon de belleza', en: 'Beauty salon', pt: 'Salao de beleza', fr: 'Salon de beaute' } },
        { key: 'barberia', label: { es: 'Barberia', en: 'Barbershop', pt: 'Barbearia', fr: 'Barbier' } },
        { key: 'spa', label: { es: 'Spa y bienestar', en: 'Spa & wellness', pt: 'Spa e bem-estar', fr: 'Spa et bien-etre' } },
        { key: 'boutique', label: { es: 'Boutique de moda', en: 'Fashion boutique', pt: 'Boutique de moda', fr: 'Boutique de mode' } },
    ],
    terminology: {
        customerNoun: { es: 'cliente', en: 'client', pt: 'cliente', fr: 'client' },
        customerNounPlural: { es: 'clientes', en: 'clients', pt: 'clientes', fr: 'clients' },
        transactionNoun: { es: 'cita', en: 'appointment', pt: 'agendamento', fr: 'rendez-vous' },
        serviceNoun: { es: 'servicio', en: 'service', pt: 'servico', fr: 'service' },
        pipelineNoun: { es: 'citas', en: 'appointments', pt: 'agendamentos', fr: 'rendez-vous' },
    },
    agent: {
        name: { es: 'Luna', en: 'Luna', pt: 'Luna', fr: 'Luna' },
        role: { es: 'Asistente de belleza y estilo', en: 'Beauty & style assistant', pt: 'Assistente de beleza e estilo', fr: 'Assistante beaute et style' },
        tone: 'friendly',
        formality: 'casual',
        greeting: { es: 'Hola! Soy Luna, tu asistente de belleza. ¿Te gustaria agendar una cita o conocer nuestros servicios?', en: 'Hi! I\'m Luna, your beauty assistant. Would you like to book an appointment or learn about our services?', pt: 'Ola! Sou Luna, sua assistente de beleza. Gostaria de agendar ou conhecer nossos servicos?', fr: 'Bonjour! Je suis Luna, votre assistante beaute. Souhaitez-vous prendre rendez-vous?' },
        rules: { es: 'Sugiere servicios complementarios de forma natural. Ofrece promociones vigentes.', en: 'Suggest complementary services naturally. Offer current promotions.', pt: 'Sugira servicos complementares naturalmente. Ofereca promocoes vigentes.', fr: 'Suggerez des services complementaires naturellement. Proposez les promotions en cours.' },
        forbiddenTopics: { es: 'Diagnostico dermatologico|Garantizar resultados esteticos|Productos no autorizados', en: 'Dermatological diagnosis|Guarantee aesthetic results|Unauthorized products', pt: 'Diagnostico dermatologico|Garantir resultados esteticos|Produtos nao autorizados', fr: 'Diagnostic dermatologique|Garantir resultats esthetiques|Produits non autorises' },
        handoffTriggers: { es: 'reaccion adversa|queja de servicio|evento nupcial|grupo grande', en: 'adverse reaction|service complaint|bridal event|large group', pt: 'reacao adversa|reclamacao|evento nupcial|grupo grande', fr: 'reaction indesirable|plainte|evenement nuptial|grand groupe' },
    },
    pipeline: {
        stages: [
            { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#e91e90', probability: 10, isTerminal: false },
            { name: { es: 'Cita agendada', en: 'Booked', pt: 'Agendado', fr: 'Reserve' }, slug: 'cita_agendada', color: '#ff69b4', probability: 40, isTerminal: false },
            { name: { es: 'En servicio', en: 'In service', pt: 'Em atendimento', fr: 'En service' }, slug: 'en_servicio', color: '#da70d6', probability: 70, isTerminal: false },
            { name: { es: 'Cliente frecuente', en: 'Regular client', pt: 'Cliente frequente', fr: 'Client regulier' }, slug: 'frecuente', color: '#9b59b6', probability: 90, isTerminal: false },
            { name: { es: 'VIP', en: 'VIP', pt: 'VIP', fr: 'VIP' }, slug: 'vip', color: '#8e44ad', probability: 100, isTerminal: true },
        ],
    },
    faqs: [
        { question: { es: '¿Que servicios ofrecen y cuanto cuestan?', en: 'What services do you offer and prices?', pt: 'Quais servicos oferecem e quanto custam?', fr: 'Quels services proposez-vous et a quel prix?' }, answer: { es: 'Ofrecemos corte, color, tratamientos capilares, manicure, pedicure y mas. Escribe "servicios" para ver nuestro catalogo completo con precios.', en: 'We offer cuts, color, hair treatments, manicure, pedicure and more. Write "services" to see our full catalog.', pt: 'Oferecemos corte, coloracao, tratamentos capilares, manicure, pedicure e mais.', fr: 'Nous proposons coupe, coloration, soins capillaires, manucure, pedicure et plus.' }, category: 'servicios' },
        { question: { es: '¿Como agendo una cita?', en: 'How do I book an appointment?', pt: 'Como agendo um horario?', fr: 'Comment prendre rendez-vous?' }, answer: { es: 'Puedes agendar tu cita ahora mismo. Solo dime que servicio te interesa y te mostrare la disponibilidad.', en: 'You can book right now. Just tell me which service you are interested in and I will show you availability.', pt: 'Voce pode agendar agora mesmo. Me diga qual servico te interessa.', fr: 'Vous pouvez prendre rendez-vous maintenant. Dites-moi quel service vous interesse.' }, category: 'citas' },
        { question: { es: '¿Tienen promociones?', en: 'Do you have any promotions?', pt: 'Tem promocoes?', fr: 'Avez-vous des promotions?' }, answer: { es: 'Tenemos promociones especiales cada mes. Pregunta por nuestras ofertas vigentes o escribe "promociones" para conocerlas.', en: 'We have special promotions every month. Ask about current offers or write "promotions".', pt: 'Temos promocoes especiais todo mes. Pergunte sobre nossas ofertas.', fr: 'Nous avons des promotions speciales chaque mois.' }, category: 'promociones' },
        { question: { es: '¿Cual es la politica de cancelacion?', en: 'What is the cancellation policy?', pt: 'Qual e a politica de cancelamento?', fr: 'Quelle est la politique d\'annulation?' }, answer: { es: 'Puedes cancelar o reprogramar con al menos 4 horas de anticipacion sin costo. Cancelaciones tardias pueden generar cargo del 50%.', en: 'You can cancel or reschedule at least 4 hours in advance at no charge. Late cancellations may incur a 50% fee.', pt: 'Voce pode cancelar ou remarcar com pelo menos 4 horas de antecedencia.', fr: 'Vous pouvez annuler ou reprogrammer au moins 4 heures a l\'avance.' }, category: 'politicas' },
        { question: { es: '¿Que productos usan?', en: 'What products do you use?', pt: 'Quais produtos usam?', fr: 'Quels produits utilisez-vous?' }, answer: { es: 'Trabajamos con marcas profesionales de alta calidad. Si tienes alguna alergia o preferencia, indicalo al momento de tu cita.', en: 'We work with high-quality professional brands. If you have allergies or preferences, let us know when booking.', pt: 'Trabalhamos com marcas profissionais de alta qualidade.', fr: 'Nous travaillons avec des marques professionnelles de haute qualite.' }, category: 'productos' },
    ],
    services: [
        { name: { es: 'Corte y estilo', en: 'Cut & style', pt: 'Corte e estilo', fr: 'Coupe et coiffure' }, description: { es: 'Corte de cabello con lavado y secado', en: 'Haircut with wash and blow dry', pt: 'Corte com lavagem e secagem', fr: 'Coupe avec lavage et brushing' }, durationMinutes: 45, price: 40000, currency: 'COP', category: 'cabello' },
        { name: { es: 'Color y tratamiento', en: 'Color & treatment', pt: 'Coloracao e tratamento', fr: 'Coloration et traitement' }, description: { es: 'Coloracion completa con tratamiento hidratante', en: 'Full color with hydrating treatment', pt: 'Coloracao completa com tratamento hidratante', fr: 'Coloration complete avec traitement hydratant' }, durationMinutes: 120, price: 120000, currency: 'COP', category: 'cabello' },
        { name: { es: 'Manicure y pedicure', en: 'Manicure & pedicure', pt: 'Manicure e pedicure', fr: 'Manucure et pedicure' }, description: { es: 'Servicio completo de manos y pies', en: 'Full hand and foot service', pt: 'Servico completo de maos e pes', fr: 'Service complet mains et pieds' }, durationMinutes: 60, price: 50000, currency: 'COP', category: 'unas' },
    ],
    businessHours: {
        schedule: { mon: '09:00-19:00', tue: '09:00-19:00', wed: '09:00-19:00', thu: '09:00-19:00', fri: '09:00-19:00', sat: '09:00-19:00' },
        afterHoursMessage: { es: 'Estamos cerrados. Te responderemos cuando abramos. Puedes agendar tu cita y te confirmaremos.', en: 'We are closed. We will respond when we open. You can book and we will confirm.', pt: 'Estamos fechados. Responderemos quando abrirmos.', fr: 'Nous sommes fermes. Nous repondrons a l\'ouverture.' },
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
        { key: 'venta', label: { es: 'Venta de inmuebles', en: 'Property sales', pt: 'Venda de imoveis', fr: 'Vente immobiliere' } },
        { key: 'arriendo', label: { es: 'Arriendo', en: 'Rental', pt: 'Aluguel', fr: 'Location' } },
        { key: 'comercial', label: { es: 'Inmuebles comerciales', en: 'Commercial real estate', pt: 'Imoveis comerciais', fr: 'Immobilier commercial' } },
        { key: 'construccion', label: { es: 'Construccion y proyectos', en: 'Construction & development', pt: 'Construcao e projetos', fr: 'Construction et projets' } },
    ],
    terminology: {
        customerNoun: { es: 'interesado', en: 'prospect', pt: 'interessado', fr: 'prospect' },
        customerNounPlural: { es: 'interesados', en: 'prospects', pt: 'interessados', fr: 'prospects' },
        transactionNoun: { es: 'negociacion', en: 'deal', pt: 'negociacao', fr: 'negociation' },
        serviceNoun: { es: 'propiedad', en: 'property', pt: 'imovel', fr: 'bien immobilier' },
        pipelineNoun: { es: 'negociaciones', en: 'deals', pt: 'negociacoes', fr: 'negociations' },
    },
    agent: {
        name: { es: 'Carlos', en: 'Carlos', pt: 'Carlos', fr: 'Charles' },
        role: { es: 'Asesor inmobiliario virtual', en: 'Virtual real estate advisor', pt: 'Consultor imobiliario virtual', fr: 'Conseiller immobilier virtuel' },
        tone: 'professional',
        formality: 'formal',
        greeting: { es: 'Hola, soy Carlos, asesor inmobiliario. ¿Estas buscando comprar, arrendar o vender?', en: 'Hello, I\'m Carlos, your real estate advisor. Are you looking to buy, rent or sell?', pt: 'Ola, sou Carlos, consultor imobiliario. Voce procura comprar, alugar ou vender?', fr: 'Bonjour, je suis Charles, votre conseiller immobilier. Recherchez-vous a acheter, louer ou vendre?' },
        rules: { es: 'Califica al prospecto (presupuesto, zona, tipo de inmueble, urgencia). Ofrece agendar visitas. Nunca garantices valorizacion.', en: 'Qualify the prospect (budget, area, property type, timeline). Offer to schedule viewings. Never guarantee appreciation.', pt: 'Qualifique o interessado (orcamento, zona, tipo de imovel). Ofereca agendar visitas.', fr: 'Qualifiez le prospect (budget, zone, type de bien). Proposez de planifier des visites.' },
        forbiddenTopics: { es: 'Garantizar valorizacion|Asesoramiento hipotecario legal|Discriminacion por zona|Precios de costo|Informacion fiscal', en: 'Guarantee appreciation|Legal mortgage advice|Zone discrimination|Cost prices|Tax information', pt: 'Garantir valorizacao|Assessoria hipotecaria legal|Discriminacao por zona', fr: 'Garantir valorisation|Conseil hypothecaire legal|Discrimination par zone' },
        handoffTriggers: { es: 'oferta formal|negociacion de precio|visita presencial|escrituras|credito hipotecario', en: 'formal offer|price negotiation|in-person viewing|deeds|mortgage', pt: 'oferta formal|negociacao de preco|visita presencial|escritura', fr: 'offre formelle|negociation de prix|visite en personne' },
    },
    pipeline: {
        stages: [
            { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#3498db', probability: 5, isTerminal: false },
            { name: { es: 'Calificado', en: 'Qualified', pt: 'Qualificado', fr: 'Qualifie' }, slug: 'calificado', color: '#f39c12', probability: 15, isTerminal: false },
            { name: { es: 'Visita agendada', en: 'Viewing scheduled', pt: 'Visita agendada', fr: 'Visite programmee' }, slug: 'visita_agendada', color: '#e67e22', probability: 30, isTerminal: false },
            { name: { es: 'Propuesta enviada', en: 'Proposal sent', pt: 'Proposta enviada', fr: 'Proposition envoyee' }, slug: 'propuesta', color: '#9b59b6', probability: 50, isTerminal: false },
            { name: { es: 'Negociacion', en: 'Negotiation', pt: 'Negociacao', fr: 'Negociation' }, slug: 'negociacion', color: '#e74c3c', probability: 70, isTerminal: false },
            { name: { es: 'Cerrado', en: 'Closed Won', pt: 'Fechado', fr: 'Conclu' }, slug: 'cerrado', color: '#2ecc71', probability: 100, isTerminal: true },
            { name: { es: 'Perdido', en: 'Lost', pt: 'Perdido', fr: 'Perdu' }, slug: 'perdido', color: '#95a5a6', probability: 0, isTerminal: true },
        ],
    },
    faqs: [
        { question: { es: '¿Que propiedades tienen disponibles?', en: 'What properties do you have available?', pt: 'Quais imoveis tem disponiveis?', fr: 'Quels biens avez-vous disponibles?' }, answer: { es: 'Tenemos diversas opciones en venta y arriendo. Cuentame tu presupuesto, zona de interes y tipo de inmueble para mostrarte las mejores opciones.', en: 'We have various options for sale and rent. Tell me your budget, area of interest and property type.', pt: 'Temos diversas opcoes para venda e aluguel. Me conte seu orcamento e zona de interesse.', fr: 'Nous avons diverses options a la vente et a la location. Dites-moi votre budget et zone d\'interet.' }, category: 'propiedades' },
        { question: { es: '¿Cual es la comision?', en: 'What is the commission?', pt: 'Qual e a comissao?', fr: 'Quelle est la commission?' }, answer: { es: 'Nuestra comision es competitiva y depende del tipo de operacion. Para venta generalmente es del 3% y para arriendo un canon mensual. Agenda una reunion para detalles.', en: 'Our commission is competitive. For sales it\'s typically 3% and for rental one month\'s rent. Schedule a meeting for details.', pt: 'Nossa comissao e competitiva. Para venda geralmente e de 3%.', fr: 'Notre commission est competitive. Pour la vente elle est generalement de 3%.' }, category: 'costos' },
        { question: { es: '¿Ofrecen financiacion?', en: 'Do you offer financing?', pt: 'Oferecem financiamento?', fr: 'Proposez-vous du financement?' }, answer: { es: 'Trabajamos con varias entidades financieras. Podemos orientarte sobre opciones de credito hipotecario. Agenda una asesoria para explorar las mejores alternativas.', en: 'We work with several financial institutions. We can guide you on mortgage options. Schedule a consultation.', pt: 'Trabalhamos com varias instituicoes financeiras. Podemos orientar sobre opcoes de credito.', fr: 'Nous travaillons avec plusieurs institutions financieres.' }, category: 'financiacion' },
        { question: { es: '¿Como agendo una visita?', en: 'How do I schedule a viewing?', pt: 'Como agendo uma visita?', fr: 'Comment planifier une visite?' }, answer: { es: 'Puedo agendar una visita para ti ahora mismo. Dime cual propiedad te interesa y tus horarios disponibles.', en: 'I can schedule a viewing for you right now. Tell me which property interests you and your available times.', pt: 'Posso agendar uma visita agora mesmo. Me diga qual imovel te interessa.', fr: 'Je peux planifier une visite maintenant. Dites-moi quel bien vous interesse.' }, category: 'visitas' },
        { question: { es: '¿Que documentos necesito?', en: 'What documents do I need?', pt: 'Quais documentos preciso?', fr: 'Quels documents sont necessaires?' }, answer: { es: 'Para compra: cedula, certificado laboral, extractos bancarios (3 meses), declaracion de renta. Para arriendo: cedula, carta laboral, referencias. Un asesor te guiara con los detalles.', en: 'For purchase: ID, employment letter, bank statements (3 months), tax return. For rental: ID, employment letter, references.', pt: 'Para compra: RG/CPF, comprovante de renda, extratos bancarios. Para aluguel: RG/CPF, comprovante de renda, referencias.', fr: 'Pour l\'achat: carte d\'identite, certificat d\'emploi, releves bancaires. Pour la location: carte d\'identite, lettre d\'emploi.' }, category: 'documentos' },
    ],
    services: [
        { name: { es: 'Visita guiada', en: 'Guided viewing', pt: 'Visita guiada', fr: 'Visite guidee' }, description: { es: 'Recorrido por la propiedad con asesor', en: 'Property tour with advisor', pt: 'Visita ao imovel com consultor', fr: 'Visite du bien avec conseiller' }, durationMinutes: 60, price: 0, currency: 'COP', category: 'visitas' },
        { name: { es: 'Asesoria hipotecaria', en: 'Mortgage consultation', pt: 'Assessoria de financiamento', fr: 'Conseil hypothecaire' }, description: { es: 'Orientacion sobre credito y financiacion', en: 'Guidance on credit and financing', pt: 'Orientacao sobre credito e financiamento', fr: 'Orientation sur credit et financement' }, durationMinutes: 45, price: 0, currency: 'COP', category: 'asesoria' },
        { name: { es: 'Avaluo comercial', en: 'Commercial appraisal', pt: 'Avaliacao comercial', fr: 'Evaluation commerciale' }, description: { es: 'Valoracion profesional del inmueble', en: 'Professional property valuation', pt: 'Avaliacao profissional do imovel', fr: 'Evaluation professionnelle du bien' }, durationMinutes: 120, price: 200000, currency: 'COP', category: 'valuacion' },
    ],
    businessHours: {
        schedule: { mon: '08:00-18:00', tue: '08:00-18:00', wed: '08:00-18:00', thu: '08:00-18:00', fri: '08:00-18:00', sat: '09:00-14:00' },
        afterHoursMessage: { es: 'Estamos fuera de horario. Dejanos tu consulta y un asesor te contactara al iniciar jornada.', en: 'We are currently closed. Leave your inquiry and an advisor will contact you when we open.', pt: 'Estamos fora do horario. Deixe sua consulta e um consultor entrara em contato.', fr: 'Nous sommes fermes. Laissez votre demande et un conseiller vous contactera.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Interesados', en: 'Prospects', pt: 'Interessados', fr: 'Prospects' },
            pipeline: { es: 'Negociaciones', en: 'Deals', pt: 'Negociacoes', fr: 'Negociations' },
            catalog: { es: 'Propiedades', en: 'Properties', pt: 'Imoveis', fr: 'Biens' },
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
        { key: 'casual_dining', label: { es: 'Restaurante casual', en: 'Casual dining', pt: 'Restaurante casual', fr: 'Restaurant decontracte' } },
        { key: 'comida_rapida', label: { es: 'Comida rapida', en: 'Fast food', pt: 'Fast food', fr: 'Restauration rapide' } },
        { key: 'cafeteria', label: { es: 'Cafeteria', en: 'Coffee shop', pt: 'Cafeteria', fr: 'Cafe' } },
        { key: 'dark_kitchen', label: { es: 'Dark kitchen / Delivery', en: 'Dark kitchen / Delivery', pt: 'Dark kitchen / Delivery', fr: 'Cuisine fantome / Livraison' } },
    ],
    terminology: {
        customerNoun: { es: 'comensal', en: 'diner', pt: 'cliente', fr: 'convive' },
        customerNounPlural: { es: 'comensales', en: 'diners', pt: 'clientes', fr: 'convives' },
        transactionNoun: { es: 'reserva', en: 'reservation', pt: 'reserva', fr: 'reservation' },
        serviceNoun: { es: 'menu', en: 'menu', pt: 'cardapio', fr: 'menu' },
        pipelineNoun: { es: 'reservas', en: 'reservations', pt: 'reservas', fr: 'reservations' },
    },
    agent: {
        name: { es: 'Luca', en: 'Luca', pt: 'Luca', fr: 'Luca' },
        role: { es: 'Asistente del restaurante', en: 'Restaurant assistant', pt: 'Assistente do restaurante', fr: 'Assistant du restaurant' },
        tone: 'warm',
        formality: 'casual',
        greeting: { es: 'Hola! Soy Luca, asistente del restaurante. ¿Te gustaria hacer una reserva o ver nuestro menu?', en: 'Hi! I\'m Luca, the restaurant assistant. Would you like to make a reservation or see our menu?', pt: 'Ola! Sou Luca, assistente do restaurante. Gostaria de fazer uma reserva ou ver nosso cardapio?', fr: 'Bonjour! Je suis Luca, assistant du restaurant. Souhaitez-vous reserver ou voir notre menu?' },
        rules: { es: 'Ofrece el menu del dia y promociones. Confirma alergias alimentarias. Para grupos mayores a 8 personas, escala al equipo.', en: 'Offer daily menu and promotions. Confirm food allergies. For groups over 8, escalate to team.', pt: 'Ofereca o menu do dia e promocoes. Confirme alergias alimentares.', fr: 'Proposez le menu du jour et promotions. Confirmez les allergies alimentaires.' },
        forbiddenTopics: { es: 'Informacion nutricional medica|Garantizar alergenos al 100%|Precios de proveedores|Recetas de cocina', en: 'Medical nutritional info|Guarantee allergens 100%|Supplier prices|Kitchen recipes', pt: 'Informacao nutricional medica|Garantir alergenos|Precos de fornecedores', fr: 'Info nutritionnelle medicale|Garantir allergenes|Prix fournisseurs' },
        handoffTriggers: { es: 'grupo mayor a 8|evento privado|queja alimentaria|intoxicacion|facturacion especial', en: 'group over 8|private event|food complaint|food poisoning|special billing', pt: 'grupo maior que 8|evento privado|reclamacao alimentar', fr: 'groupe de plus de 8|evenement prive|plainte alimentaire' },
    },
    pipeline: {
        stages: [
            { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#e74c3c', probability: 10, isTerminal: false },
            { name: { es: 'Reserva', en: 'Reserved', pt: 'Reserva', fr: 'Reserve' }, slug: 'reserva', color: '#f39c12', probability: 50, isTerminal: false },
            { name: { es: 'Confirmada', en: 'Confirmed', pt: 'Confirmada', fr: 'Confirmee' }, slug: 'confirmada', color: '#2ecc71', probability: 80, isTerminal: false },
            { name: { es: 'Completada', en: 'Completed', pt: 'Completada', fr: 'Terminee' }, slug: 'completada', color: '#27ae60', probability: 100, isTerminal: true },
            { name: { es: 'No Show', en: 'No Show', pt: 'No Show', fr: 'Absent' }, slug: 'no_show', color: '#95a5a6', probability: 0, isTerminal: true },
        ],
    },
    faqs: [
        { question: { es: '¿Cual es el horario del restaurante?', en: 'What are your hours?', pt: 'Qual e o horario?', fr: 'Quels sont vos horaires?' }, answer: { es: 'Abrimos de lunes a domingo de 11:00 AM a 11:00 PM. Los viernes y sabados hasta las 12:00 AM.', en: 'We are open Monday to Sunday 11 AM to 11 PM. Friday and Saturday until midnight.', pt: 'Abrimos de segunda a domingo das 11h as 23h.', fr: 'Nous sommes ouverts du lundi au dimanche de 11h a 23h.' }, category: 'general' },
        { question: { es: '¿Tienen opciones vegetarianas o para alergias?', en: 'Do you have vegetarian or allergy options?', pt: 'Tem opcoes vegetarianas ou para alergias?', fr: 'Avez-vous des options vegetariennes ou pour allergies?' }, answer: { es: 'Si, tenemos opciones vegetarianas, veganas y sin gluten. Indicanos tus restricciones al reservar y nuestro chef las tendra en cuenta.', en: 'Yes, we have vegetarian, vegan and gluten-free options. Tell us your restrictions when booking.', pt: 'Sim, temos opcoes vegetarianas, veganas e sem gluten.', fr: 'Oui, nous proposons des options vegetariennes, veganes et sans gluten.' }, category: 'menu' },
        { question: { es: '¿Hacen domicilios?', en: 'Do you deliver?', pt: 'Fazem entrega?', fr: 'Faites-vous la livraison?' }, answer: { es: 'Si, hacemos domicilios en un radio de 5km. Puedes ver nuestro menu y hacer tu pedido escribiendo "quiero pedir".', en: 'Yes, we deliver within 5km. You can see our menu and order by writing "I want to order".', pt: 'Sim, fazemos entrega em um raio de 5km.', fr: 'Oui, nous livrons dans un rayon de 5km.' }, category: 'delivery' },
        { question: { es: '¿Como hago una reserva?', en: 'How do I make a reservation?', pt: 'Como faco uma reserva?', fr: 'Comment reserver?' }, answer: { es: 'Puedo reservar tu mesa ahora. Dime para cuantas personas, fecha y hora que prefieras.', en: 'I can book your table now. Tell me for how many, date and preferred time.', pt: 'Posso reservar sua mesa agora. Me diga para quantas pessoas, data e horario.', fr: 'Je peux reserver votre table maintenant. Combien de personnes, date et heure?' }, category: 'reservas' },
        { question: { es: '¿Cual es el precio promedio por persona?', en: 'What is the average price per person?', pt: 'Qual e o preco medio por pessoa?', fr: 'Quel est le prix moyen par personne?' }, answer: { es: 'El precio promedio por persona es de $35.000 - $60.000 COP dependiendo de lo que ordenes. Tenemos opciones para todos los presupuestos.', en: 'Average price per person is $15-25 USD depending on your order. We have options for all budgets.', pt: 'O preco medio por pessoa e de R$50-100 dependendo do pedido.', fr: 'Le prix moyen par personne est de 15-25 EUR selon votre commande.' }, category: 'precios' },
    ],
    services: [
        { name: { es: 'Reserva mesa 2-4', en: 'Table 2-4', pt: 'Mesa 2-4', fr: 'Table 2-4' }, description: { es: 'Reserva para 2 a 4 personas', en: 'Reservation for 2 to 4 people', pt: 'Reserva para 2 a 4 pessoas', fr: 'Reservation pour 2 a 4 personnes' }, durationMinutes: 90, price: 0, currency: 'COP', category: 'reservas' },
        { name: { es: 'Reserva grupo 5-8', en: 'Group 5-8', pt: 'Grupo 5-8', fr: 'Groupe 5-8' }, description: { es: 'Reserva para grupo de 5 a 8 personas', en: 'Reservation for group of 5 to 8', pt: 'Reserva para grupo de 5 a 8 pessoas', fr: 'Reservation pour groupe de 5 a 8' }, durationMinutes: 120, price: 0, currency: 'COP', category: 'reservas' },
        { name: { es: 'Evento privado', en: 'Private event', pt: 'Evento privado', fr: 'Evenement prive' }, description: { es: 'Evento privado con menu especial', en: 'Private event with special menu', pt: 'Evento privado com menu especial', fr: 'Evenement prive avec menu special' }, durationMinutes: 240, price: 0, currency: 'COP', category: 'eventos' },
    ],
    businessHours: {
        schedule: { mon: '11:00-23:00', tue: '11:00-23:00', wed: '11:00-23:00', thu: '11:00-23:00', fri: '11:00-00:00', sat: '11:00-00:00', sun: '11:00-22:00' },
        afterHoursMessage: { es: 'El restaurante esta cerrado. Puedes hacer tu reserva y te confirmaremos al abrir.', en: 'The restaurant is closed. You can make a reservation and we will confirm when we open.', pt: 'O restaurante esta fechado. Faca sua reserva e confirmaremos quando abrirmos.', fr: 'Le restaurant est ferme. Reservez et nous confirmerons a l\'ouverture.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Comensales', en: 'Diners', pt: 'Clientes', fr: 'Convives' },
            pipeline: { es: 'Reservas', en: 'Reservations', pt: 'Reservas', fr: 'Reservations' },
            appointments: { es: 'Reservaciones', en: 'Bookings', pt: 'Reservas', fr: 'Reservations' },
        },
        hiddenItems: ['inventory', 'catalog', 'orders'],
    },
    dashboard: {
        kpis: [
            { key: 'appointmentsToday', label: { es: 'Reservas Hoy', en: 'Reservations Today', pt: 'Reservas Hoje', fr: 'Reservations Aujourd\'hui' }, icon: 'UtensilsCrossed', color: '#e74c3c' },
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
        { key: 'concesionario', label: { es: 'Concesionario', en: 'Dealership', pt: 'Concessionaria', fr: 'Concessionnaire' } },
        { key: 'taller', label: { es: 'Taller mecanico', en: 'Auto repair shop', pt: 'Oficina mecanica', fr: 'Atelier mecanique' } },
        { key: 'repuestos', label: { es: 'Repuestos y accesorios', en: 'Parts & accessories', pt: 'Pecas e acessorios', fr: 'Pieces et accessoires' } },
        { key: 'alquiler', label: { es: 'Alquiler de vehiculos', en: 'Car rental', pt: 'Aluguel de veiculos', fr: 'Location de vehicules' } },
    ],
    terminology: {
        customerNoun: { es: 'cliente', en: 'customer', pt: 'cliente', fr: 'client' },
        customerNounPlural: { es: 'clientes', en: 'customers', pt: 'clientes', fr: 'clients' },
        transactionNoun: { es: 'negociacion', en: 'deal', pt: 'negociacao', fr: 'negociation' },
        serviceNoun: { es: 'vehiculo', en: 'vehicle', pt: 'veiculo', fr: 'vehicule' },
        pipelineNoun: { es: 'negociaciones', en: 'deals', pt: 'negociacoes', fr: 'negociations' },
    },
    agent: {
        name: { es: 'Marco', en: 'Marco', pt: 'Marco', fr: 'Marc' },
        role: { es: 'Asesor de ventas automotriz', en: 'Automotive sales advisor', pt: 'Consultor de vendas automotivo', fr: 'Conseiller commercial automobile' },
        tone: 'professional',
        formality: 'formal',
        greeting: { es: 'Hola, soy Marco, asesor automotriz. ¿Buscas un vehiculo nuevo, usado o necesitas servicio de taller?', en: 'Hello, I\'m Marco, your automotive advisor. Looking for a new car, used, or need service?', pt: 'Ola, sou Marco, consultor automotivo. Procura um veiculo novo, usado ou precisa de servico?', fr: 'Bonjour, je suis Marc, votre conseiller automobile. Cherchez-vous un vehicule neuf, d\'occasion ou un service?' },
        rules: { es: 'Califica al cliente (presupuesto, tipo de vehiculo, financiacion, retoma). Ofrece agendar prueba de manejo. Nunca garantices aprobacion de credito.', en: 'Qualify the customer (budget, vehicle type, financing, trade-in). Offer test drives. Never guarantee credit approval.', pt: 'Qualifique o cliente (orcamento, tipo de veiculo, financiamento). Ofereca test drive.', fr: 'Qualifiez le client (budget, type de vehicule, financement). Proposez un essai routier.' },
        forbiddenTopics: { es: 'Garantizar aprobacion de credito|Precios de costo|Diagnostico mecanico sin revision|Garantias no autorizadas', en: 'Guarantee credit approval|Cost prices|Mechanical diagnosis without inspection|Unauthorized warranties', pt: 'Garantir aprovacao de credito|Precos de custo|Diagnostico sem revisao', fr: 'Garantir approbation de credit|Prix de revient|Diagnostic sans inspection' },
        handoffTriggers: { es: 'prueba de manejo|financiacion aprobada|reclamo de garantia|accidente|negociacion final de precio', en: 'test drive|financing approved|warranty claim|accident|final price negotiation', pt: 'test drive|financiamento aprovado|reclamacao de garantia', fr: 'essai routier|financement approuve|reclamation garantie' },
    },
    pipeline: {
        stages: [
            { name: { es: 'Lead', en: 'Lead', pt: 'Lead', fr: 'Lead' }, slug: 'lead', color: '#3498db', probability: 5, isTerminal: false },
            { name: { es: 'Contactado', en: 'Contacted', pt: 'Contatado', fr: 'Contacte' }, slug: 'contactado', color: '#f39c12', probability: 15, isTerminal: false },
            { name: { es: 'Test Drive', en: 'Test Drive', pt: 'Test Drive', fr: 'Essai' }, slug: 'test_drive', color: '#e67e22', probability: 35, isTerminal: false },
            { name: { es: 'Cotizacion', en: 'Quote', pt: 'Cotacao', fr: 'Devis' }, slug: 'cotizacion', color: '#9b59b6', probability: 50, isTerminal: false },
            { name: { es: 'Financiacion', en: 'Financing', pt: 'Financiamento', fr: 'Financement' }, slug: 'financiacion', color: '#e74c3c', probability: 70, isTerminal: false },
            { name: { es: 'Entregado', en: 'Delivered', pt: 'Entregue', fr: 'Livre' }, slug: 'entregado', color: '#2ecc71', probability: 100, isTerminal: true },
            { name: { es: 'Perdido', en: 'Lost', pt: 'Perdido', fr: 'Perdu' }, slug: 'perdido', color: '#95a5a6', probability: 0, isTerminal: true },
        ],
    },
    faqs: [
        { question: { es: '¿Que vehiculos tienen disponibles?', en: 'What vehicles do you have?', pt: 'Quais veiculos tem disponiveis?', fr: 'Quels vehicules avez-vous?' }, answer: { es: 'Tenemos una amplia variedad de vehiculos nuevos y usados. Cuentame tu presupuesto y tipo de vehiculo que buscas para mostrarte las mejores opciones.', en: 'We have a wide variety of new and used vehicles. Tell me your budget and type to show you the best options.', pt: 'Temos uma ampla variedade de veiculos novos e usados.', fr: 'Nous avons une large gamme de vehicules neufs et d\'occasion.' }, category: 'inventario' },
        { question: { es: '¿Ofrecen financiacion?', en: 'Do you offer financing?', pt: 'Oferecem financiamento?', fr: 'Proposez-vous du financement?' }, answer: { es: 'Si, trabajamos con varias entidades financieras para ofrecerte las mejores tasas. Podemos hacer una pre-aprobacion rapida. ¿Te interesa?', en: 'Yes, we work with several financial institutions for the best rates. We can do a quick pre-approval. Interested?', pt: 'Sim, trabalhamos com varias instituicoes financeiras.', fr: 'Oui, nous travaillons avec plusieurs institutions financieres.' }, category: 'financiacion' },
        { question: { es: '¿Puedo agendar una prueba de manejo?', en: 'Can I schedule a test drive?', pt: 'Posso agendar um test drive?', fr: 'Puis-je planifier un essai?' }, answer: { es: 'Claro! Puedo agendar tu prueba de manejo ahora. Dime que vehiculo te interesa y tu horario disponible.', en: 'Of course! I can schedule your test drive now. Tell me which vehicle and your availability.', pt: 'Claro! Posso agendar seu test drive agora. Me diga qual veiculo e seu horario.', fr: 'Bien sur! Je peux planifier votre essai. Quel vehicule et quelle disponibilite?' }, category: 'test_drive' },
        { question: { es: '¿Aceptan vehiculo como parte de pago?', en: 'Do you accept trade-ins?', pt: 'Aceitam veiculo como entrada?', fr: 'Acceptez-vous les reprises?' }, answer: { es: 'Si, aceptamos tu vehiculo actual como parte de pago. Te hacemos una evaluacion sin compromiso. ¿Te gustaria conocer el valor de tu vehiculo?', en: 'Yes, we accept trade-ins. We provide a no-obligation evaluation. Want to know your vehicle\'s value?', pt: 'Sim, aceitamos seu veiculo atual como entrada. Fazemos avaliacao sem compromisso.', fr: 'Oui, nous acceptons les reprises. Evaluation sans engagement.' }, category: 'retoma' },
        { question: { es: '¿Que garantia ofrecen?', en: 'What warranty do you offer?', pt: 'Que garantia oferecem?', fr: 'Quelle garantie proposez-vous?' }, answer: { es: 'Todos nuestros vehiculos nuevos tienen garantia de fabrica. Los usados certificados incluyen garantia extendida. Consultanos sobre las condiciones especificas.', en: 'All new vehicles have factory warranty. Certified pre-owned include extended warranty. Ask us about specific terms.', pt: 'Todos os veiculos novos tem garantia de fabrica. Usados certificados incluem garantia estendida.', fr: 'Tous les vehicules neufs ont la garantie constructeur. Les occasions certifiees incluent une garantie etendue.' }, category: 'garantia' },
    ],
    services: [
        { name: { es: 'Prueba de manejo', en: 'Test drive', pt: 'Test drive', fr: 'Essai routier' }, description: { es: 'Prueba de manejo del vehiculo de tu interes', en: 'Test drive the vehicle of your interest', pt: 'Test drive do veiculo de seu interesse', fr: 'Essai du vehicule de votre choix' }, durationMinutes: 30, price: 0, currency: 'COP', category: 'ventas' },
        { name: { es: 'Revision mecanica', en: 'Mechanical inspection', pt: 'Revisao mecanica', fr: 'Inspection mecanique' }, description: { es: 'Revision general del estado del vehiculo', en: 'General vehicle condition inspection', pt: 'Revisao geral do estado do veiculo', fr: 'Inspection generale du vehicule' }, durationMinutes: 60, price: 80000, currency: 'COP', category: 'taller' },
        { name: { es: 'Cotizacion personalizada', en: 'Custom quote', pt: 'Cotacao personalizada', fr: 'Devis personnalise' }, description: { es: 'Cotizacion detallada con opciones de financiacion', en: 'Detailed quote with financing options', pt: 'Cotacao detalhada com opcoes de financiamento', fr: 'Devis detaille avec options de financement' }, durationMinutes: 45, price: 0, currency: 'COP', category: 'ventas' },
    ],
    businessHours: {
        schedule: { mon: '08:00-18:00', tue: '08:00-18:00', wed: '08:00-18:00', thu: '08:00-18:00', fri: '08:00-18:00', sat: '09:00-15:00' },
        afterHoursMessage: { es: 'Estamos fuera de horario. Dejanos tu consulta y un asesor te contactara al iniciar jornada.', en: 'We are closed. Leave your inquiry and an advisor will contact you.', pt: 'Estamos fora do horario. Deixe sua consulta.', fr: 'Nous sommes fermes. Laissez votre demande.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Clientes', en: 'Customers', pt: 'Clientes', fr: 'Clients' },
            pipeline: { es: 'Negociaciones', en: 'Deals', pt: 'Negociacoes', fr: 'Negociations' },
            catalog: { es: 'Vehiculos', en: 'Vehicles', pt: 'Veiculos', fr: 'Vehicules' },
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
        { key: 'agencia_viajes', label: { es: 'Agencia de viajes', en: 'Travel agency', pt: 'Agencia de viagens', fr: 'Agence de voyages' } },
        { key: 'hotel', label: { es: 'Hotel / Hostal', en: 'Hotel / Hostel', pt: 'Hotel / Hostel', fr: 'Hotel / Auberge' } },
        { key: 'tours', label: { es: 'Tours y actividades', en: 'Tours & activities', pt: 'Tours e atividades', fr: 'Tours et activites' } },
        { key: 'alquiler_vacacional', label: { es: 'Alquiler vacacional', en: 'Vacation rental', pt: 'Aluguel por temporada', fr: 'Location vacances' } },
    ],
    terminology: { customerNoun: { es: 'viajero', en: 'traveler', pt: 'viajante', fr: 'voyageur' }, customerNounPlural: { es: 'viajeros', en: 'travelers', pt: 'viajantes', fr: 'voyageurs' }, transactionNoun: { es: 'reserva', en: 'booking', pt: 'reserva', fr: 'reservation' }, serviceNoun: { es: 'paquete', en: 'package', pt: 'pacote', fr: 'forfait' }, pipelineNoun: { es: 'reservas', en: 'bookings', pt: 'reservas', fr: 'reservations' } },
    agent: { name: { es: 'Maya', en: 'Maya', pt: 'Maya', fr: 'Maya' }, role: { es: 'Asesora de viajes', en: 'Travel advisor', pt: 'Consultora de viagens', fr: 'Conseillere de voyages' }, tone: 'enthusiastic', formality: 'casual', greeting: { es: 'Hola! Soy Maya, tu asesora de viajes. ¿A donde te gustaria ir?', en: 'Hi! I\'m Maya, your travel advisor. Where would you like to go?', pt: 'Ola! Sou Maya, sua consultora de viagens. Para onde gostaria de ir?', fr: 'Bonjour! Je suis Maya, votre conseillere de voyages. Ou souhaitez-vous aller?' }, rules: { es: 'Inspira al viajero con destinos. Cotiza paquetes. Para grupos >10, escala.', en: 'Inspire the traveler with destinations. Quote packages. For groups >10, escalate.', pt: 'Inspire o viajante com destinos. Cote pacotes.', fr: 'Inspirez le voyageur. Cotez les forfaits.' }, forbiddenTopics: { es: 'Informacion migratoria oficial|Vacunas requeridas|Garantizar clima', en: 'Official immigration info|Required vaccines|Guarantee weather', pt: 'Informacao migratoria oficial|Vacinas requeridas', fr: 'Info migratoire officielle|Vaccins requis' }, handoffTriggers: { es: 'grupo >10|viaje corporativo|reclamacion de seguro|emergencia en destino', en: 'group >10|corporate travel|insurance claim|emergency at destination', pt: 'grupo >10|viagem corporativa|reclamacao de seguro', fr: 'groupe >10|voyage d\'affaires|reclamation assurance' } },
    pipeline: { stages: [
        { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#1abc9c', probability: 10, isTerminal: false },
        { name: { es: 'Cotizacion', en: 'Quote', pt: 'Cotacao', fr: 'Devis' }, slug: 'cotizacion', color: '#3498db', probability: 30, isTerminal: false },
        { name: { es: 'Reserva', en: 'Booked', pt: 'Reservado', fr: 'Reserve' }, slug: 'reserva', color: '#f39c12', probability: 60, isTerminal: false },
        { name: { es: 'Confirmado', en: 'Confirmed', pt: 'Confirmado', fr: 'Confirme' }, slug: 'confirmado', color: '#2ecc71', probability: 90, isTerminal: false },
        { name: { es: 'Completado', en: 'Traveled', pt: 'Viajou', fr: 'Voyage effectue' }, slug: 'completado', color: '#27ae60', probability: 100, isTerminal: true },
        { name: { es: 'Cancelado', en: 'Cancelled', pt: 'Cancelado', fr: 'Annule' }, slug: 'cancelado', color: '#95a5a6', probability: 0, isTerminal: true },
    ] },
    faqs: [
        { question: { es: '¿Que destinos manejan?', en: 'What destinations do you cover?', pt: 'Quais destinos cobrem?', fr: 'Quelles destinations couvrez-vous?' }, answer: { es: 'Manejamos destinos nacionales e internacionales. Cuentame a donde te gustaria ir y armamos tu plan ideal.', en: 'We cover national and international destinations. Tell me where you\'d like to go.', pt: 'Cobrimos destinos nacionais e internacionais.', fr: 'Nous couvrons des destinations nationales et internationales.' }, category: 'destinos' },
        { question: { es: '¿Que incluye el paquete?', en: 'What\'s included?', pt: 'O que inclui o pacote?', fr: 'Qu\'est-ce qui est inclus?' }, answer: { es: 'Cada paquete varia. Generalmente incluye alojamiento, transporte y tours. Te detallo todo cuando cotice tu plan.', en: 'Each package varies. Usually includes accommodation, transport and tours.', pt: 'Cada pacote varia. Geralmente inclui hospedagem, transporte e tours.', fr: 'Chaque forfait varie. Inclut generalement hebergement, transport et visites.' }, category: 'paquetes' },
        { question: { es: '¿Cual es la politica de cancelacion?', en: 'What\'s the cancellation policy?', pt: 'Qual e a politica de cancelamento?', fr: 'Quelle est la politique d\'annulation?' }, answer: { es: 'Depende del paquete y proveedores. Generalmente hasta 30 dias antes sin penalidad. Te informamos al momento de la reserva.', en: 'Depends on package and providers. Usually up to 30 days before at no penalty.', pt: 'Depende do pacote. Geralmente ate 30 dias antes sem penalidade.', fr: 'Depend du forfait. Generalement jusqu\'a 30 jours avant sans penalite.' }, category: 'politicas' },
        { question: { es: '¿Necesito seguro de viaje?', en: 'Do I need travel insurance?', pt: 'Preciso de seguro viagem?', fr: 'Ai-je besoin d\'une assurance voyage?' }, answer: { es: 'Recomendamos siempre un seguro de viaje. Ofrecemos opciones con nuestros paquetes. Consultanos.', en: 'We always recommend travel insurance. We offer options with our packages.', pt: 'Sempre recomendamos seguro viagem. Oferecemos opcoes com nossos pacotes.', fr: 'Nous recommandons toujours une assurance voyage.' }, category: 'seguros' },
        { question: { es: '¿Que documentos necesito para viajar?', en: 'What documents do I need?', pt: 'Quais documentos preciso?', fr: 'Quels documents sont necessaires?' }, answer: { es: 'Depende del destino. Para viajes nacionales tu documento de identidad. Para internacionales necesitaras pasaporte vigente y posiblemente visa. Te orientamos.', en: 'Depends on destination. National trips: ID. International: valid passport, possibly visa. We\'ll guide you.', pt: 'Depende do destino. Viagens nacionais: documento de identidade. Internacionais: passaporte.', fr: 'Depend de la destination. National: carte d\'identite. International: passeport valide.' }, category: 'documentos' },
    ],
    services: [
        { name: { es: 'Tour dia completo', en: 'Full day tour', pt: 'Tour dia inteiro', fr: 'Tour journee complete' }, description: { es: 'Tour guiado de dia completo', en: 'Full day guided tour', pt: 'Tour guiado de dia inteiro', fr: 'Tour guide journee complete' }, durationMinutes: 480, price: 300000, currency: 'COP', category: 'tours' },
        { name: { es: 'Paquete fin de semana', en: 'Weekend package', pt: 'Pacote fim de semana', fr: 'Forfait week-end' }, description: { es: 'Paquete todo incluido fin de semana', en: 'All-inclusive weekend package', pt: 'Pacote tudo incluido fim de semana', fr: 'Forfait tout inclus week-end' }, durationMinutes: 0, price: 800000, currency: 'COP', category: 'paquetes' },
        { name: { es: 'Excursion medio dia', en: 'Half day excursion', pt: 'Excursao meio dia', fr: 'Excursion demi-journee' }, description: { es: 'Excursion de medio dia con transporte', en: 'Half day excursion with transport', pt: 'Excursao meio dia com transporte', fr: 'Excursion demi-journee avec transport' }, durationMinutes: 240, price: 150000, currency: 'COP', category: 'tours' },
    ],
    businessHours: { schedule: { mon: '08:00-19:00', tue: '08:00-19:00', wed: '08:00-19:00', thu: '08:00-19:00', fri: '08:00-19:00', sat: '09:00-16:00' }, afterHoursMessage: { es: 'Estamos fuera de horario. Te responderemos al iniciar jornada.', en: 'We are closed. We\'ll respond when we open.', pt: 'Estamos fora do horario.', fr: 'Nous sommes fermes.' } },
    sidebar: { labelOverrides: { crm: { es: 'Viajeros', en: 'Travelers', pt: 'Viajantes', fr: 'Voyageurs' }, pipeline: { es: 'Reservas', en: 'Bookings', pt: 'Reservas', fr: 'Reservations' }, appointments: { es: 'Itinerarios', en: 'Itineraries', pt: 'Itinerarios', fr: 'Itineraires' } }, hiddenItems: [] },
    dashboard: { kpis: [
        { key: 'leadsToday', label: { es: 'Consultas Hoy', en: 'Inquiries Today', pt: 'Consultas Hoje', fr: 'Demandes Aujourd\'hui' }, icon: 'Plane', color: '#1abc9c' },
        { key: 'appointmentsToday', label: { es: 'Reservas Confirmadas', en: 'Confirmed Bookings', pt: 'Reservas Confirmadas', fr: 'Reservations Confirmees' }, icon: 'Calendar', color: '#3498db' },
        { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
        { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Cout IA' }, icon: 'DollarSign', color: '#e67e22' },
    ] },
    bookingEnabled: true,
    deferred: false,
};

// Simplified definitions for Tier 2 verticals (same structure, less detail in FAQs)
const EDUCATION: VerticalDefinition = {
    industry: 'education',
    subTypes: [
        { key: 'idiomas', label: { es: 'Escuela de idiomas', en: 'Language school', pt: 'Escola de idiomas', fr: 'Ecole de langues' } },
        { key: 'universitaria', label: { es: 'Universidad / Instituto', en: 'University / College', pt: 'Universidade / Instituto', fr: 'Universite / Institut' } },
        { key: 'online', label: { es: 'Cursos online', en: 'Online courses', pt: 'Cursos online', fr: 'Cours en ligne' } },
        { key: 'capacitacion', label: { es: 'Capacitacion empresarial', en: 'Corporate training', pt: 'Treinamento empresarial', fr: 'Formation entreprise' } },
    ],
    terminology: { customerNoun: { es: 'estudiante', en: 'student', pt: 'estudante', fr: 'etudiant' }, customerNounPlural: { es: 'estudiantes', en: 'students', pt: 'estudantes', fr: 'etudiants' }, transactionNoun: { es: 'matricula', en: 'enrollment', pt: 'matricula', fr: 'inscription' }, serviceNoun: { es: 'curso', en: 'course', pt: 'curso', fr: 'cours' }, pipelineNoun: { es: 'inscripciones', en: 'enrollments', pt: 'inscricoes', fr: 'inscriptions' } },
    agent: { name: { es: 'Pablo', en: 'Pablo', pt: 'Paulo', fr: 'Paul' }, role: { es: 'Asesor academico', en: 'Academic advisor', pt: 'Orientador academico', fr: 'Conseiller academique' }, tone: 'encouraging', formality: 'semi-formal', greeting: { es: 'Hola! Soy Pablo, asesor academico. ¿En que programa o curso estas interesado?', en: 'Hi! I\'m Pablo, your academic advisor. What program or course interests you?', pt: 'Ola! Sou Paulo, orientador academico. Qual programa ou curso te interessa?', fr: 'Bonjour! Je suis Paul, conseiller academique. Quel programme vous interesse?' }, rules: { es: 'Informa sobre programas, horarios y costos. Ofrece test de nivel si aplica. Nunca prometas becas sin autorizacion.', en: 'Inform about programs, schedules and costs. Offer placement test. Never promise scholarships.', pt: 'Informe sobre programas, horarios e custos. Ofereca teste de nivel.', fr: 'Informez sur programmes, horaires et couts. Proposez un test de niveau.' }, forbiddenTopics: { es: 'Calificaciones de otros estudiantes|Contenido de examenes|Becas no autorizadas|Credenciales falsas', en: 'Other students grades|Exam content|Unauthorized scholarships|False credentials', pt: 'Notas de outros estudantes|Conteudo de provas|Bolsas nao autorizadas', fr: 'Notes d\'autres etudiants|Contenu d\'examens|Bourses non autorisees' }, handoffTriggers: { es: 'solicitud de beca|homologacion|queja academica|reembolso|convalidacion', en: 'scholarship request|credit transfer|academic complaint|refund', pt: 'solicitacao de bolsa|transferencia|reclamacao', fr: 'demande de bourse|transfert|plainte academique' } },
    pipeline: { stages: [
        { name: { es: 'Interesado', en: 'Interested', pt: 'Interessado', fr: 'Interesse' }, slug: 'interesado', color: '#3498db', probability: 10, isTerminal: false },
        { name: { es: 'Info enviada', en: 'Info sent', pt: 'Info enviada', fr: 'Info envoyee' }, slug: 'info_enviada', color: '#f39c12', probability: 25, isTerminal: false },
        { name: { es: 'Inscrito', en: 'Enrolled', pt: 'Inscrito', fr: 'Inscrit' }, slug: 'inscrito', color: '#e67e22', probability: 60, isTerminal: false },
        { name: { es: 'Activo', en: 'Active', pt: 'Ativo', fr: 'Actif' }, slug: 'activo', color: '#2ecc71', probability: 90, isTerminal: false },
        { name: { es: 'Completado', en: 'Completed', pt: 'Completado', fr: 'Complete' }, slug: 'completado', color: '#27ae60', probability: 100, isTerminal: true },
        { name: { es: 'Desercion', en: 'Dropped', pt: 'Desistencia', fr: 'Abandon' }, slug: 'desercion', color: '#95a5a6', probability: 0, isTerminal: true },
    ] },
    faqs: [
        { question: { es: '¿Que programas ofrecen?', en: 'What programs do you offer?', pt: 'Quais programas oferecem?', fr: 'Quels programmes proposez-vous?' }, answer: { es: 'Ofrecemos diversos programas. Cuentame que area te interesa para darte informacion detallada.', en: 'We offer various programs. Tell me your area of interest for detailed info.', pt: 'Oferecemos diversos programas. Me conte qual area te interessa.', fr: 'Nous proposons divers programmes. Dites-moi votre domaine d\'interet.' }, category: 'programas' },
        { question: { es: '¿Cuanto cuesta?', en: 'How much does it cost?', pt: 'Quanto custa?', fr: 'Combien ca coute?' }, answer: { es: 'Los costos varian segun el programa. Ademas ofrecemos planes de pago y posibles becas. Te envio la informacion detallada.', en: 'Costs vary by program. We offer payment plans and possible scholarships.', pt: 'Os custos variam por programa. Oferecemos planos de pagamento.', fr: 'Les couts varient selon le programme. Nous proposons des plans de paiement.' }, category: 'costos' },
        { question: { es: '¿Cuales son los horarios?', en: 'What are the schedules?', pt: 'Quais sao os horarios?', fr: 'Quels sont les horaires?' }, answer: { es: 'Tenemos horarios diurnos, nocturnos y fines de semana. Tambien modalidad virtual. ¿Que horario te conviene?', en: 'We have day, evening and weekend schedules. Also virtual options. What works for you?', pt: 'Temos horarios diurnos, noturnos e fins de semana. Tambem modalidade virtual.', fr: 'Nous avons des horaires jour, soir et week-end. Aussi en ligne.' }, category: 'horarios' },
        { question: { es: '¿Que requisitos de admision hay?', en: 'What are the admission requirements?', pt: 'Quais sao os requisitos de admissao?', fr: 'Quelles sont les conditions d\'admission?' }, answer: { es: 'Los requisitos dependen del programa. Generalmente necesitas documento de identidad y certificado de estudios previos.', en: 'Requirements depend on the program. Generally you need ID and previous education certificate.', pt: 'Os requisitos dependem do programa. Geralmente precisa de documento de identidade e certificado.', fr: 'Les exigences dependent du programme. ID et certificat d\'etudes anterieures.' }, category: 'admision' },
        { question: { es: '¿Ofrecen certificacion?', en: 'Do you offer certification?', pt: 'Oferecem certificacao?', fr: 'Proposez-vous une certification?' }, answer: { es: 'Si, al completar exitosamente el programa recibes certificacion oficial. Consultanos sobre el valor del certificado.', en: 'Yes, upon successful completion you receive official certification.', pt: 'Sim, ao completar o programa voce recebe certificacao oficial.', fr: 'Oui, a la fin du programme vous recevez une certification officielle.' }, category: 'certificacion' },
    ],
    services: [
        { name: { es: 'Clase de prueba', en: 'Trial class', pt: 'Aula experimental', fr: 'Cours d\'essai' }, description: { es: 'Clase de prueba gratuita', en: 'Free trial class', pt: 'Aula experimental gratuita', fr: 'Cours d\'essai gratuit' }, durationMinutes: 60, price: 0, currency: 'COP', category: 'prueba' },
        { name: { es: 'Tutoria personalizada', en: 'Personal tutoring', pt: 'Tutoria personalizada', fr: 'Tutorat personnalise' }, description: { es: 'Sesion de tutoria individual', en: 'Individual tutoring session', pt: 'Sessao de tutoria individual', fr: 'Seance de tutorat individuel' }, durationMinutes: 60, price: 80000, currency: 'COP', category: 'tutoria' },
        { name: { es: 'Test de nivel', en: 'Placement test', pt: 'Teste de nivel', fr: 'Test de niveau' }, description: { es: 'Evaluacion de nivel para ubicacion', en: 'Level assessment for placement', pt: 'Avaliacao de nivel para classificacao', fr: 'Evaluation de niveau pour le placement' }, durationMinutes: 30, price: 0, currency: 'COP', category: 'evaluacion' },
    ],
    businessHours: { schedule: { mon: '07:00-20:00', tue: '07:00-20:00', wed: '07:00-20:00', thu: '07:00-20:00', fri: '07:00-20:00', sat: '08:00-14:00' }, afterHoursMessage: { es: 'Estamos fuera de horario. Te responderemos al iniciar jornada.', en: 'We are closed. We\'ll respond when we open.', pt: 'Estamos fora do horario.', fr: 'Nous sommes fermes.' } },
    sidebar: { labelOverrides: { crm: { es: 'Estudiantes', en: 'Students', pt: 'Estudantes', fr: 'Etudiants' }, pipeline: { es: 'Inscripciones', en: 'Enrollments', pt: 'Inscricoes', fr: 'Inscriptions' } }, hiddenItems: [] },
    dashboard: { kpis: [
        { key: 'leadsToday', label: { es: 'Interesados Hoy', en: 'Inquiries Today', pt: 'Interessados Hoje', fr: 'Interesses Aujourd\'hui' }, icon: 'UserPlus', color: '#3498db' },
        { key: 'appointmentsToday', label: { es: 'Matriculas Hoy', en: 'Enrollments Today', pt: 'Matriculas Hoje', fr: 'Inscriptions Aujourd\'hui' }, icon: 'GraduationCap', color: '#2ecc71' },
        { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
        { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Cout IA' }, icon: 'DollarSign', color: '#e67e22' },
    ] },
    bookingEnabled: true,
};

// Generic fallbacks for verticals with simpler needs
function createGenericVertical(industry: string, config: Partial<VerticalDefinition>): VerticalDefinition {
    const defaults: VerticalDefinition = {
        industry,
        subTypes: [],
        terminology: { customerNoun: { es: 'cliente', en: 'customer', pt: 'cliente', fr: 'client' }, customerNounPlural: { es: 'clientes', en: 'customers', pt: 'clientes', fr: 'clients' }, transactionNoun: { es: 'venta', en: 'sale', pt: 'venda', fr: 'vente' }, serviceNoun: { es: 'servicio', en: 'service', pt: 'servico', fr: 'service' }, pipelineNoun: { es: 'ventas', en: 'sales', pt: 'vendas', fr: 'ventes' } },
        agent: { name: { es: 'Asistente', en: 'Assistant', pt: 'Assistente', fr: 'Assistant' }, role: { es: 'Asistente virtual de atencion al cliente', en: 'Virtual customer service assistant', pt: 'Assistente virtual de atendimento', fr: 'Assistant virtuel service client' }, tone: 'professional', formality: 'semi-formal', greeting: { es: 'Hola! ¿En que puedo ayudarte hoy?', en: 'Hello! How can I help you today?', pt: 'Ola! Como posso ajudar?', fr: 'Bonjour! Comment puis-je vous aider?' }, rules: { es: 'Responde de forma profesional y concisa. Ofrece agendar reuniones cuando sea pertinente.', en: 'Respond professionally and concisely. Offer to schedule meetings when appropriate.', pt: 'Responda profissionalmente. Ofereca agendar reunioes quando pertinente.', fr: 'Repondez professionnellement. Proposez des rendez-vous si pertinent.' }, forbiddenTopics: { es: '', en: '', pt: '', fr: '' }, handoffTriggers: { es: 'queja formal|emergencia|solicitud de reembolso', en: 'formal complaint|emergency|refund request', pt: 'reclamacao formal|emergencia|reembolso', fr: 'plainte formelle|urgence|remboursement' } },
        pipeline: { stages: [
            { name: { es: 'Nuevo', en: 'New', pt: 'Novo', fr: 'Nouveau' }, slug: 'nuevo', color: '#3498db', probability: 10, isTerminal: false },
            { name: { es: 'Contactado', en: 'Contacted', pt: 'Contatado', fr: 'Contacte' }, slug: 'contactado', color: '#f39c12', probability: 25, isTerminal: false },
            { name: { es: 'Calificado', en: 'Qualified', pt: 'Qualificado', fr: 'Qualifie' }, slug: 'calificado', color: '#e67e22', probability: 40, isTerminal: false },
            { name: { es: 'Propuesta', en: 'Proposal', pt: 'Proposta', fr: 'Proposition' }, slug: 'propuesta', color: '#9b59b6', probability: 60, isTerminal: false },
            { name: { es: 'Cerrado ganado', en: 'Closed Won', pt: 'Fechado ganho', fr: 'Conclu gagne' }, slug: 'cerrado_ganado', color: '#2ecc71', probability: 100, isTerminal: true },
            { name: { es: 'Cerrado perdido', en: 'Closed Lost', pt: 'Fechado perdido', fr: 'Conclu perdu' }, slug: 'cerrado_perdido', color: '#95a5a6', probability: 0, isTerminal: true },
        ] },
        faqs: [
            { question: { es: '¿Cual es el horario de atencion?', en: 'What are your hours?', pt: 'Qual e o horario?', fr: 'Quels sont vos horaires?' }, answer: { es: 'Nuestro horario es de lunes a viernes de 8:00 AM a 6:00 PM. Escribenos y te atenderemos.', en: 'Our hours are Monday to Friday 8 AM to 6 PM. Write to us.', pt: 'Nosso horario e de segunda a sexta das 8h as 18h.', fr: 'Nos horaires sont du lundi au vendredi de 8h a 18h.' }, category: 'general' },
            { question: { es: '¿Cuales son los metodos de pago?', en: 'What payment methods?', pt: 'Quais formas de pagamento?', fr: 'Quels modes de paiement?' }, answer: { es: 'Aceptamos efectivo, tarjeta debito/credito y transferencia bancaria.', en: 'We accept cash, debit/credit card and bank transfer.', pt: 'Aceitamos dinheiro, cartao e transferencia.', fr: 'Especes, carte et virement.' }, category: 'pagos' },
            { question: { es: '¿Como puedo contactarlos?', en: 'How can I contact you?', pt: 'Como posso contata-los?', fr: 'Comment vous contacter?' }, answer: { es: 'Puedes escribirnos aqui, llamarnos o visitarnos. Estamos para ayudarte.', en: 'You can write here, call us or visit us. We are here to help.', pt: 'Pode escrever aqui, ligar ou nos visitar.', fr: 'Ecrivez ici, appelez-nous ou visitez-nous.' }, category: 'contacto' },
            { question: { es: '¿Donde estan ubicados?', en: 'Where are you located?', pt: 'Onde ficam?', fr: 'Ou etes-vous situes?' }, answer: { es: 'Consulta nuestra direccion y mapa en la seccion de contacto de nuestro sitio web.', en: 'Check our address and map in the contact section of our website.', pt: 'Consulte nosso endereco na secao de contato do site.', fr: 'Consultez notre adresse dans la section contact de notre site.' }, category: 'ubicacion' },
            { question: { es: '¿Tienen politica de devolucion?', en: 'Do you have a return policy?', pt: 'Tem politica de devolucao?', fr: 'Avez-vous une politique de retour?' }, answer: { es: 'Si, puedes consultar nuestra politica de devolucion. Escribenos si tienes alguna situacion especifica.', en: 'Yes, check our return policy. Contact us for specific situations.', pt: 'Sim, consulte nossa politica de devolucao.', fr: 'Oui, consultez notre politique de retour.' }, category: 'politicas' },
        ],
        services: [],
        businessHours: { schedule: { mon: '08:00-18:00', tue: '08:00-18:00', wed: '08:00-18:00', thu: '08:00-18:00', fri: '08:00-18:00' }, afterHoursMessage: { es: 'Estamos fuera de horario. Te responderemos pronto.', en: 'We are closed. We\'ll respond soon.', pt: 'Estamos fora do horario.', fr: 'Nous sommes fermes.' } },
        sidebar: { labelOverrides: {}, hiddenItems: [] },
        dashboard: { kpis: [
            { key: 'leadsToday', label: { es: 'Leads Hoy', en: 'Leads Today', pt: 'Leads Hoje', fr: 'Leads Aujourd\'hui' }, icon: 'UserPlus', color: '#3498db' },
            { key: 'leadsHot', label: { es: 'Leads Calientes', en: 'Hot Leads', pt: 'Leads Quentes', fr: 'Leads Chauds' }, icon: 'Flame', color: '#e74c3c' },
            { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
            { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Cout IA' }, icon: 'DollarSign', color: '#e67e22' },
        ] },
        bookingEnabled: false,
    };
    return { ...defaults, ...config, terminology: { ...defaults.terminology, ...config.terminology }, agent: { ...defaults.agent, ...config.agent } as VerticalDefinition['agent'], sidebar: { ...defaults.sidebar, ...config.sidebar } as VerticalDefinition['sidebar'] };
}

const FINANZAS = createGenericVertical('finanzas', {
    subTypes: [
        { key: 'seguros', label: { es: 'Seguros', en: 'Insurance', pt: 'Seguros', fr: 'Assurances' } },
        { key: 'asesoria', label: { es: 'Asesoria financiera', en: 'Financial advisory', pt: 'Assessoria financeira', fr: 'Conseil financier' } },
        { key: 'fintech', label: { es: 'Fintech', en: 'Fintech', pt: 'Fintech', fr: 'Fintech' } },
        { key: 'creditos', label: { es: 'Creditos y prestamos', en: 'Loans & credit', pt: 'Creditos e emprestimos', fr: 'Credits et prets' } },
    ],
    terminology: { customerNoun: { es: 'cliente', en: 'client', pt: 'cliente', fr: 'client' }, customerNounPlural: { es: 'clientes', en: 'clients', pt: 'clientes', fr: 'clients' }, transactionNoun: { es: 'solicitud', en: 'application', pt: 'solicitacao', fr: 'demande' }, serviceNoun: { es: 'producto financiero', en: 'financial product', pt: 'produto financeiro', fr: 'produit financier' }, pipelineNoun: { es: 'solicitudes', en: 'applications', pt: 'solicitacoes', fr: 'demandes' } },
    agent: { name: { es: 'Roberto', en: 'Robert', pt: 'Roberto', fr: 'Robert' }, role: { es: 'Asesor financiero virtual', en: 'Virtual financial advisor', pt: 'Consultor financeiro virtual', fr: 'Conseiller financier virtuel' }, tone: 'trustworthy', formality: 'formal', greeting: { es: 'Hola, soy Roberto, asesor financiero. ¿En que producto o servicio puedo orientarte?', en: 'Hello, I\'m Robert, your financial advisor. How can I guide you?', pt: 'Ola, sou Roberto, consultor financeiro. Como posso orientar?', fr: 'Bonjour, je suis Robert, votre conseiller financier.' }, rules: { es: 'Nunca garantices rendimientos ni aprobacion de credito. Siempre remite a asesor certificado para decisiones de inversion.', en: 'Never guarantee returns or credit approval. Always refer to certified advisor for investment decisions.', pt: 'Nunca garanta rendimentos nem aprovacao de credito.', fr: 'Ne jamais garantir rendements ni approbation de credit.' }, forbiddenTopics: { es: 'Garantizar rendimientos|Solicitar datos bancarios completos|Prometer aprobacion de credito|Asesoramiento tributario especifico', en: 'Guarantee returns|Request full banking details|Promise credit approval|Specific tax advice', pt: 'Garantir rendimentos|Solicitar dados bancarios|Prometer aprovacao', fr: 'Garantir rendements|Demander coordonnees bancaires|Promettre approbation' }, handoffTriggers: { es: 'solicitud formal|monto alto|queja regulatoria|reclamo|fraude', en: 'formal application|high amount|regulatory complaint|claim|fraud', pt: 'solicitacao formal|valor alto|reclamacao regulatoria', fr: 'demande formelle|montant eleve|plainte reglementaire' } },
    pipeline: { stages: [
        { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#2c3e50', probability: 10, isTerminal: false },
        { name: { es: 'Pre-aprobacion', en: 'Pre-approval', pt: 'Pre-aprovacao', fr: 'Pre-approbation' }, slug: 'pre_aprobacion', color: '#3498db', probability: 30, isTerminal: false },
        { name: { es: 'Documentacion', en: 'Documentation', pt: 'Documentacao', fr: 'Documentation' }, slug: 'documentacion', color: '#f39c12', probability: 50, isTerminal: false },
        { name: { es: 'Evaluacion', en: 'Evaluation', pt: 'Avaliacao', fr: 'Evaluation' }, slug: 'evaluacion', color: '#e67e22', probability: 70, isTerminal: false },
        { name: { es: 'Aprobado', en: 'Approved', pt: 'Aprovado', fr: 'Approuve' }, slug: 'aprobado', color: '#2ecc71', probability: 100, isTerminal: true },
        { name: { es: 'Rechazado', en: 'Rejected', pt: 'Rejeitado', fr: 'Rejete' }, slug: 'rechazado', color: '#e74c3c', probability: 0, isTerminal: true },
    ] },
    sidebar: { labelOverrides: { crm: { es: 'Clientes', en: 'Clients', pt: 'Clientes', fr: 'Clients' }, pipeline: { es: 'Solicitudes', en: 'Applications', pt: 'Solicitacoes', fr: 'Demandes' } }, hiddenItems: ['inventory', 'orders', 'catalog'] },
    bookingEnabled: true,
    services: [
        { name: { es: 'Asesoria gratuita', en: 'Free consultation', pt: 'Consultoria gratuita', fr: 'Consultation gratuite' }, description: { es: 'Orientacion financiera inicial', en: 'Initial financial guidance', pt: 'Orientacao financeira inicial', fr: 'Orientation financiere initiale' }, durationMinutes: 30, price: 0, currency: 'COP', category: 'asesoria' },
    ],
});

const SERVICIOS_PROFESIONALES = createGenericVertical('servicios_profesionales', {
    subTypes: [
        { key: 'abogados', label: { es: 'Abogados', en: 'Lawyers', pt: 'Advogados', fr: 'Avocats' } },
        { key: 'contadores', label: { es: 'Contadores', en: 'Accountants', pt: 'Contadores', fr: 'Comptables' } },
        { key: 'arquitectos', label: { es: 'Arquitectos', en: 'Architects', pt: 'Arquitetos', fr: 'Architectes' } },
        { key: 'consultores', label: { es: 'Consultores', en: 'Consultants', pt: 'Consultores', fr: 'Consultants' } },
    ],
    terminology: { customerNoun: { es: 'cliente', en: 'client', pt: 'cliente', fr: 'client' }, customerNounPlural: { es: 'clientes', en: 'clients', pt: 'clientes', fr: 'clients' }, transactionNoun: { es: 'caso', en: 'case', pt: 'caso', fr: 'dossier' }, serviceNoun: { es: 'servicio profesional', en: 'professional service', pt: 'servico profissional', fr: 'service professionnel' }, pipelineNoun: { es: 'casos', en: 'cases', pt: 'casos', fr: 'dossiers' } },
    agent: { name: { es: 'Elena', en: 'Elena', pt: 'Elena', fr: 'Helene' }, role: { es: 'Asistente administrativa profesional', en: 'Professional administrative assistant', pt: 'Assistente administrativa profissional', fr: 'Assistante administrative professionnelle' }, tone: 'professional', formality: 'formal', greeting: { es: 'Hola, soy Elena, asistente del despacho. ¿En que asunto puedo orientarte?', en: 'Hello, I\'m Elena, the office assistant. How can I help?', pt: 'Ola, sou Elena, assistente do escritorio. Como posso ajudar?', fr: 'Bonjour, je suis Helene, assistante du cabinet. Comment puis-je vous aider?' }, rules: { es: 'Califica el tipo de consulta. Agenda reuniones. Nunca des asesoramiento legal o financiero directo.', en: 'Qualify the inquiry type. Schedule meetings. Never give direct legal or financial advice.', pt: 'Qualifique o tipo de consulta. Agende reunioes.', fr: 'Qualifiez la demande. Planifiez des reunions.' }, forbiddenTopics: { es: 'Asesoramiento legal directo|Diagnostico fiscal|Garantizar resultados|Tarifas de otros profesionales', en: 'Direct legal advice|Tax diagnosis|Guarantee outcomes|Other professionals rates', pt: 'Assessoria legal direta|Diagnostico fiscal|Garantir resultados', fr: 'Conseil juridique direct|Diagnostic fiscal|Garantir resultats' }, handoffTriggers: { es: 'caso complejo|conflicto de intereses|queja formal|urgencia legal|audiencia', en: 'complex case|conflict of interest|formal complaint|legal emergency|hearing', pt: 'caso complexo|conflito de interesses|reclamacao formal', fr: 'dossier complexe|conflit d\'interets|plainte formelle' } },
    pipeline: { stages: [
        { name: { es: 'Consulta', en: 'Inquiry', pt: 'Consulta', fr: 'Demande' }, slug: 'consulta', color: '#2c3e50', probability: 10, isTerminal: false },
        { name: { es: 'Evaluacion', en: 'Evaluation', pt: 'Avaliacao', fr: 'Evaluation' }, slug: 'evaluacion', color: '#3498db', probability: 25, isTerminal: false },
        { name: { es: 'Propuesta', en: 'Proposal', pt: 'Proposta', fr: 'Proposition' }, slug: 'propuesta', color: '#f39c12', probability: 50, isTerminal: false },
        { name: { es: 'En proceso', en: 'In progress', pt: 'Em andamento', fr: 'En cours' }, slug: 'en_proceso', color: '#e67e22', probability: 75, isTerminal: false },
        { name: { es: 'Completado', en: 'Completed', pt: 'Completado', fr: 'Termine' }, slug: 'completado', color: '#2ecc71', probability: 100, isTerminal: true },
        { name: { es: 'Declinado', en: 'Declined', pt: 'Recusado', fr: 'Decline' }, slug: 'declinado', color: '#95a5a6', probability: 0, isTerminal: true },
    ] },
    sidebar: { labelOverrides: { crm: { es: 'Clientes', en: 'Clients', pt: 'Clientes', fr: 'Clients' }, pipeline: { es: 'Casos', en: 'Cases', pt: 'Casos', fr: 'Dossiers' } }, hiddenItems: ['inventory', 'orders', 'catalog'] },
    bookingEnabled: true,
    services: [
        { name: { es: 'Consulta inicial', en: 'Initial consultation', pt: 'Consulta inicial', fr: 'Consultation initiale' }, description: { es: 'Primera reunion de evaluacion', en: 'First evaluation meeting', pt: 'Primeira reuniao de avaliacao', fr: 'Premiere reunion d\'evaluation' }, durationMinutes: 30, price: 100000, currency: 'COP', category: 'consulta' },
        { name: { es: 'Asesoria especializada', en: 'Specialized advisory', pt: 'Assessoria especializada', fr: 'Conseil specialise' }, description: { es: 'Sesion de asesoria con especialista', en: 'Advisory session with specialist', pt: 'Sessao de assessoria com especialista', fr: 'Seance de conseil avec specialiste' }, durationMinutes: 60, price: 200000, currency: 'COP', category: 'asesoria' },
    ],
});

const RETAIL = createGenericVertical('retail', {
    subTypes: [
        { key: 'moda', label: { es: 'Moda y ropa', en: 'Fashion & clothing', pt: 'Moda e roupas', fr: 'Mode et vetements' } },
        { key: 'electronica', label: { es: 'Electronica', en: 'Electronics', pt: 'Eletronica', fr: 'Electronique' } },
        { key: 'hogar', label: { es: 'Hogar y decoracion', en: 'Home & decor', pt: 'Casa e decoracao', fr: 'Maison et decoration' } },
        { key: 'marketplace', label: { es: 'Marketplace / E-commerce', en: 'Marketplace / E-commerce', pt: 'Marketplace / E-commerce', fr: 'Marketplace / E-commerce' } },
    ],
    terminology: { customerNoun: { es: 'cliente', en: 'customer', pt: 'cliente', fr: 'client' }, customerNounPlural: { es: 'clientes', en: 'customers', pt: 'clientes', fr: 'clients' }, transactionNoun: { es: 'pedido', en: 'order', pt: 'pedido', fr: 'commande' }, serviceNoun: { es: 'producto', en: 'product', pt: 'produto', fr: 'produit' }, pipelineNoun: { es: 'ventas', en: 'sales', pt: 'vendas', fr: 'ventes' } },
    agent: { name: { es: 'Alex', en: 'Alex', pt: 'Alex', fr: 'Alex' }, role: { es: 'Asesor de ventas', en: 'Sales advisor', pt: 'Consultor de vendas', fr: 'Conseiller commercial' }, tone: 'friendly', formality: 'casual', greeting: { es: 'Hola! Soy Alex, tu asesor de compras. ¿Que estas buscando hoy?', en: 'Hi! I\'m Alex, your shopping advisor. What are you looking for?', pt: 'Ola! Sou Alex, seu consultor de compras. O que procura?', fr: 'Bonjour! Je suis Alex, votre conseiller. Que cherchez-vous?' }, rules: { es: 'Sugiere productos basado en necesidades. Informa disponibilidad y tiempos de entrega. Ofrece opciones dentro del presupuesto.', en: 'Suggest products based on needs. Inform availability and delivery times.', pt: 'Sugira produtos com base nas necessidades. Informe disponibilidade.', fr: 'Suggerez des produits selon les besoins. Informez de la disponibilite.' }, forbiddenTopics: { es: 'Precios de costo|Comparaciones con competencia|Garantias no autorizadas', en: 'Cost prices|Competitor comparisons|Unauthorized warranties', pt: 'Precos de custo|Comparacoes com concorrencia', fr: 'Prix de revient|Comparaisons avec concurrence' }, handoffTriggers: { es: 'devolucion compleja|pedido mayorista|queja de calidad|cambio masivo', en: 'complex return|wholesale order|quality complaint', pt: 'devolucao complexa|pedido atacado|reclamacao', fr: 'retour complexe|commande en gros|plainte qualite' } },
    pipeline: { stages: [
        { name: { es: 'Interesado', en: 'Interested', pt: 'Interessado', fr: 'Interesse' }, slug: 'interesado', color: '#3498db', probability: 10, isTerminal: false },
        { name: { es: 'Cotizacion', en: 'Quote', pt: 'Cotacao', fr: 'Devis' }, slug: 'cotizacion', color: '#f39c12', probability: 30, isTerminal: false },
        { name: { es: 'Pedido', en: 'Ordered', pt: 'Pedido', fr: 'Commande' }, slug: 'pedido', color: '#e67e22', probability: 60, isTerminal: false },
        { name: { es: 'Enviado', en: 'Shipped', pt: 'Enviado', fr: 'Expedie' }, slug: 'enviado', color: '#9b59b6', probability: 80, isTerminal: false },
        { name: { es: 'Entregado', en: 'Delivered', pt: 'Entregue', fr: 'Livre' }, slug: 'entregado', color: '#2ecc71', probability: 100, isTerminal: true },
        { name: { es: 'Devolucion', en: 'Return', pt: 'Devolucao', fr: 'Retour' }, slug: 'devolucion', color: '#e74c3c', probability: 0, isTerminal: true },
    ] },
    sidebar: { labelOverrides: { crm: { es: 'Clientes', en: 'Customers', pt: 'Clientes', fr: 'Clients' }, pipeline: { es: 'Ventas', en: 'Sales', pt: 'Vendas', fr: 'Ventes' }, catalog: { es: 'Productos', en: 'Products', pt: 'Produtos', fr: 'Produits' } }, hiddenItems: [] },
});

const TECHNOLOGY = createGenericVertical('technology', {
    subTypes: [
        { key: 'saas', label: { es: 'SaaS', en: 'SaaS', pt: 'SaaS', fr: 'SaaS' } },
        { key: 'consultoria_ti', label: { es: 'Consultoria TI', en: 'IT Consulting', pt: 'Consultoria TI', fr: 'Conseil IT' } },
        { key: 'desarrollo', label: { es: 'Desarrollo de software', en: 'Software development', pt: 'Desenvolvimento de software', fr: 'Developpement logiciel' } },
        { key: 'hardware', label: { es: 'Hardware y redes', en: 'Hardware & networking', pt: 'Hardware e redes', fr: 'Materiel et reseaux' } },
    ],
    terminology: { customerNoun: { es: 'cliente', en: 'client', pt: 'cliente', fr: 'client' }, customerNounPlural: { es: 'clientes', en: 'clients', pt: 'clientes', fr: 'clients' }, transactionNoun: { es: 'deal', en: 'deal', pt: 'deal', fr: 'affaire' }, serviceNoun: { es: 'solucion', en: 'solution', pt: 'solucao', fr: 'solution' }, pipelineNoun: { es: 'pipeline', en: 'pipeline', pt: 'pipeline', fr: 'pipeline' } },
    agent: { name: { es: 'Ana', en: 'Ana', pt: 'Ana', fr: 'Anne' }, role: { es: 'Asesora tecnologica', en: 'Technology advisor', pt: 'Consultora tecnologica', fr: 'Conseillere technologique' }, tone: 'professional', formality: 'semi-formal', greeting: { es: 'Hola, soy Ana, asesora tecnologica. ¿En que solucion puedo ayudarte?', en: 'Hello, I\'m Ana, your tech advisor. What solution can I help with?', pt: 'Ola, sou Ana, consultora tecnologica. Como posso ajudar?', fr: 'Bonjour, je suis Anne, conseillere technologique. Comment puis-je vous aider?' }, rules: { es: 'Califica el nivel tecnico del cliente. Ofrece demos. Para proyectos enterprise, escala.', en: 'Qualify client\'s technical level. Offer demos. For enterprise, escalate.', pt: 'Qualifique o nivel tecnico do cliente. Ofereca demos.', fr: 'Qualifiez le niveau technique. Proposez des demos.' }, forbiddenTopics: { es: 'Acceso a sistemas|Credenciales|Garantizar SLA sin autorizacion', en: 'System access|Credentials|Guarantee SLA without authorization', pt: 'Acesso a sistemas|Credenciais|Garantir SLA', fr: 'Acces systemes|Identifiants|Garantir SLA' }, handoffTriggers: { es: 'proyecto enterprise|integracion compleja|incidente de seguridad|presupuesto >$50M', en: 'enterprise project|complex integration|security incident|budget >$50K', pt: 'projeto enterprise|integracao complexa|incidente de seguranca', fr: 'projet enterprise|integration complexe|incident securite' } },
    pipeline: { stages: [
        { name: { es: 'Lead', en: 'Lead', pt: 'Lead', fr: 'Lead' }, slug: 'lead', color: '#2c3e50', probability: 5, isTerminal: false },
        { name: { es: 'Discovery', en: 'Discovery', pt: 'Discovery', fr: 'Decouverte' }, slug: 'discovery', color: '#3498db', probability: 15, isTerminal: false },
        { name: { es: 'Demo', en: 'Demo', pt: 'Demo', fr: 'Demo' }, slug: 'demo', color: '#f39c12', probability: 35, isTerminal: false },
        { name: { es: 'Propuesta', en: 'Proposal', pt: 'Proposta', fr: 'Proposition' }, slug: 'propuesta', color: '#e67e22', probability: 55, isTerminal: false },
        { name: { es: 'Negociacion', en: 'Negotiation', pt: 'Negociacao', fr: 'Negociation' }, slug: 'negociacion', color: '#9b59b6', probability: 75, isTerminal: false },
        { name: { es: 'Cerrado', en: 'Closed Won', pt: 'Fechado', fr: 'Conclu' }, slug: 'cerrado', color: '#2ecc71', probability: 100, isTerminal: true },
        { name: { es: 'Perdido', en: 'Lost', pt: 'Perdido', fr: 'Perdu' }, slug: 'perdido', color: '#95a5a6', probability: 0, isTerminal: true },
    ] },
    sidebar: { labelOverrides: {}, hiddenItems: ['inventory', 'catalog'] },
    bookingEnabled: true,
    services: [
        { name: { es: 'Demo personalizada', en: 'Custom demo', pt: 'Demo personalizada', fr: 'Demo personnalisee' }, description: { es: 'Demostracion de la solucion', en: 'Solution demonstration', pt: 'Demonstracao da solucao', fr: 'Demonstration de la solution' }, durationMinutes: 45, price: 0, currency: 'COP', category: 'demos' },
    ],
});

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
            { name: { es: 'Lead', en: 'Lead', pt: 'Lead', fr: 'Lead' }, slug: 'lead', color: '#3498db', probability: 10, isTerminal: false },
            { name: { es: 'Calificado', en: 'Qualified', pt: 'Qualificado', fr: 'Qualifié' }, slug: 'calificado', color: '#f39c12', probability: 25, isTerminal: false },
            { name: { es: 'Cotizado', en: 'Quoted', pt: 'Cotado', fr: 'Devis envoyé' }, slug: 'cotizado', color: '#e67e22', probability: 50, isTerminal: false },
            { name: { es: 'Propuesta enviada', en: 'Proposal sent', pt: 'Proposta enviada', fr: 'Proposition envoyée' }, slug: 'propuesta', color: '#9b59b6', probability: 70, isTerminal: false },
            { name: { es: 'Póliza emitida', en: 'Policy issued', pt: 'Apólice emitida', fr: 'Police émise' }, slug: 'poliza_emitida', color: '#2ecc71', probability: 100, isTerminal: true },
            { name: { es: 'Renovación', en: 'Renewal', pt: 'Renovação', fr: 'Renouvellement' }, slug: 'renovacion', color: '#27ae60', probability: 95, isTerminal: false },
            { name: { es: 'Perdido', en: 'Lost', pt: 'Perdido', fr: 'Perdu' }, slug: 'perdido', color: '#95a5a6', probability: 0, isTerminal: true },
        ],
    },
    faqs: [
        { question: { es: '¿Qué tipos de seguros manejan?', en: 'What insurance types do you offer?', pt: 'Que tipos de seguro vocês têm?', fr: 'Quels types d\'assurance proposez-vous?' }, answer: { es: 'Manejamos seguros de vida, salud, auto, hogar, empresarial y de viaje. Cuéntame qué te interesa proteger.', en: 'We handle life, health, auto, home, business and travel insurance.', pt: 'Manejamos seguros de vida, saúde, auto, residencial, empresarial e viagem.', fr: 'Nous proposons assurance vie, santé, auto, habitation, entreprise et voyage.' }, category: 'productos' },
        { question: { es: '¿Cuánto tarda la emisión de una póliza?', en: 'How long until a policy is issued?', pt: 'Quanto tempo para emitir uma apólice?', fr: 'Combien de temps pour émettre une police?' }, answer: { es: 'Una vez aprobada la suscripción, la póliza se emite en 2-5 días hábiles.', en: 'Once underwriting approves, the policy issues in 2-5 business days.', pt: 'Após aprovação da subscrição, a apólice sai em 2-5 dias úteis.', fr: 'Après approbation de la souscription, la police est émise en 2-5 jours ouvrés.' }, category: 'proceso' },
        { question: { es: '¿Cómo funciona un reclamo?', en: 'How does a claim work?', pt: 'Como funciona um sinistro?', fr: 'Comment fonctionne un sinistre?' }, answer: { es: 'Reportas el siniestro por chat, te asignamos un asesor que te acompaña en la documentación. Tiempos típicos: 7-30 días según complejidad.', en: 'Report it via chat — an advisor guides you through docs. Typical times: 7-30 days.', pt: 'Reporta pelo chat — um consultor te acompanha. Tempos: 7-30 dias.', fr: 'Déclarez par chat — un conseiller vous accompagne. Délais : 7-30 jours.' }, category: 'reclamos' },
        { question: { es: '¿Qué pasa si dejo de pagar?', en: 'What if I stop paying?', pt: 'E se eu parar de pagar?', fr: 'Que se passe-t-il si j\'arrête de payer?' }, answer: { es: 'Hay un período de gracia de 30 días. Después la cobertura se suspende. Pasados 60 días sin pago, la póliza se cancela.', en: '30-day grace, then suspended; cancelled after 60 days unpaid.', pt: 'Período de carência de 30 dias, depois suspensa, cancelada após 60 dias.', fr: 'Délai de grâce 30 jours, puis suspension, résiliée après 60 jours.' }, category: 'pagos' },
        { question: { es: '¿Tienen descuentos por bundle?', en: 'Do you offer bundle discounts?', pt: 'Tem desconto em pacote?', fr: 'Avez-vous des réductions multi-contrats?' }, answer: { es: 'Si — combinando dos pólizas o más obtienes 5-15% de descuento. Pregúntame por opciones para tu caso.', en: 'Yes — bundling two+ policies gets 5-15% off.', pt: 'Sim — combinando duas+ apólices fica 5-15% mais barato.', fr: 'Oui — combiner deux+ polices = 5-15% de réduction.' }, category: 'descuentos' },
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
        { key: 'yoga_pilates', label: { es: 'Estudio de yoga / pilates', en: 'Yoga / pilates studio', pt: 'Estudio de yoga / pilates', fr: 'Studio yoga / pilates' } },
        { key: 'cycling', label: { es: 'Cycling / spinning', en: 'Cycling / spinning', pt: 'Cycling / spinning', fr: 'Cycling / spinning' } },
        { key: 'martial_arts', label: { es: 'Artes marciales', en: 'Martial arts', pt: 'Artes marciais', fr: 'Arts martiaux' } },
    ],
    terminology: {
        customerNoun: { es: 'miembro', en: 'member', pt: 'aluno', fr: 'membre' },
        customerNounPlural: { es: 'miembros', en: 'members', pt: 'alunos', fr: 'membres' },
        transactionNoun: { es: 'inscripcion', en: 'membership', pt: 'matricula', fr: 'adhesion' },
        serviceNoun: { es: 'plan', en: 'plan', pt: 'plano', fr: 'plan' },
        pipelineNoun: { es: 'inscripciones', en: 'memberships', pt: 'matriculas', fr: 'adhesions' },
    },
    agent: {
        name: { es: 'Alex', en: 'Alex', pt: 'Alex', fr: 'Alex' },
        role: { es: 'Asistente del gimnasio', en: 'Gym assistant', pt: 'Assistente da academia', fr: 'Assistant du club' },
        tone: 'energetic',
        formality: 'casual',
        greeting: { es: '¡Hey! Soy Alex, asistente del gym. ¿Quieres conocer planes, agendar una clase o info de horarios?', en: 'Hey! I\'m Alex, your gym assistant. Want to check plans, book a class, or know our schedule?', pt: 'Oi! Sou Alex, assistente da academia. Quer conhecer planos, marcar uma aula ou saber horarios?', fr: 'Salut! Je suis Alex, assistant du club. Vous voulez decouvrir les forfaits, reserver un cours, ou connaitre les horaires?' },
        rules: {
            es: 'Llama "miembro" al cliente activo y "interesado" al lead. Antes de reservar una clase usa get_my_membership para verificar credito. Para precios y planes usa get_membership_plans — no improvises montos. Promueve cross-selling de personal training cuando aplique.',
            en: 'Call active customers "members" and leads "prospects". Before booking a class, call get_my_membership to verify credit. Use get_membership_plans for prices — never improvise amounts. Cross-sell personal training when relevant.',
            pt: 'Chame os clientes ativos de "membros" e leads de "interessados". Antes de marcar uma aula use get_my_membership.',
            fr: 'Appelez les clients actifs "membres" et les leads "prospects". Verifiez le credit avant la reservation.',
        },
        forbiddenTopics: {
            es: 'Diagnosticos medicos|Recomendaciones de suplementos|Planes nutricionales detallados|Datos de otros miembros',
            en: 'Medical diagnoses|Supplement recommendations|Detailed nutrition plans|Other members data',
            pt: 'Diagnosticos medicos|Recomendacoes de suplementos|Planos de nutricao',
            fr: 'Diagnostics medicaux|Recommandations de complements|Plans nutritionnels',
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
            { name: { es: 'Interesado', en: 'Prospect', pt: 'Interessado', fr: 'Prospect' }, slug: 'interesado', color: '#3498db', probability: 10, isTerminal: false },
            { name: { es: 'Trial / Pase invitado', en: 'Trial / Guest pass', pt: 'Trial / Convidado', fr: 'Essai / Invite' }, slug: 'trial', color: '#f39c12', probability: 30, isTerminal: false },
            { name: { es: 'Inscrito', en: 'Enrolled', pt: 'Matriculado', fr: 'Inscrit' }, slug: 'inscrito', color: '#e67e22', probability: 60, isTerminal: false },
            { name: { es: 'Activo', en: 'Active member', pt: 'Membro ativo', fr: 'Membre actif' }, slug: 'activo', color: '#2ecc71', probability: 90, isTerminal: false },
            { name: { es: 'Renovacion', en: 'Renewal', pt: 'Renovacao', fr: 'Renouvellement' }, slug: 'renovacion', color: '#27ae60', probability: 95, isTerminal: false },
            { name: { es: 'Inactivo', en: 'Lapsed', pt: 'Inativo', fr: 'Inactif' }, slug: 'inactivo', color: '#95a5a6', probability: 0, isTerminal: true },
        ],
    },
    faqs: [
        { question: { es: '¿Qué planes tienen?', en: 'What plans do you offer?', pt: 'Quais planos tem?', fr: 'Quels forfaits proposez-vous?' }, answer: { es: 'Ofrecemos planes mensuales, trimestrales y anuales con distintos beneficios. Pregunta por tu objetivo y te recomiendo el ideal.', en: 'We offer monthly, quarterly and yearly plans with different perks.', pt: 'Oferecemos planos mensais, trimestrais e anuais com beneficios diversos.', fr: 'Nous proposons des forfaits mensuels, trimestriels et annuels.' }, category: 'planes' },
        { question: { es: '¿Puedo congelar mi membresía si viajo?', en: 'Can I freeze my membership if I travel?', pt: 'Posso congelar a matricula em viagem?', fr: 'Puis-je geler mon adhesion?' }, answer: { es: 'Si — segun tu plan tienes un cupo de congelamiento. Si te vas de viaje o tienes una lesion, lo activamos por los dias que necesites.', en: 'Yes — your plan includes a freeze allowance for travel or injury.', pt: 'Sim, dependendo do plano voce tem dias de congelamento.', fr: 'Oui, selon votre forfait vous avez des jours de gel.' }, category: 'membresia' },
        { question: { es: '¿Tienen clases grupales?', en: 'Do you offer group classes?', pt: 'Tem aulas em grupo?', fr: 'Avez-vous des cours collectifs?' }, answer: { es: 'Si, tenemos clases de yoga, spinning, crossfit, hiit y mas. Reserva tu cupo via chat.', en: 'Yes — yoga, spinning, crossfit, HIIT and more.', pt: 'Sim — yoga, spinning, crossfit, HIIT e mais.', fr: 'Oui — yoga, spinning, crossfit, HIIT et plus.' }, category: 'clases' },
        { question: { es: '¿Tienen sesiones de personal training?', en: 'Do you offer personal training?', pt: 'Tem personal training?', fr: 'Avez-vous des seances de coaching personnel?' }, answer: { es: 'Si, podemos asignarte un entrenador personal. Algunos planes incluyen sesiones; otros se pagan aparte.', en: 'Yes, some plans include sessions, others are pay-per-session.', pt: 'Sim, alguns planos incluem sessoes, outros sao avulsos.', fr: 'Oui, certains forfaits incluent des seances.' }, category: 'personal_training' },
        { question: { es: '¿Cuál es el horario?', en: 'What are your hours?', pt: 'Qual o horario?', fr: 'Quels sont vos horaires?' }, answer: { es: 'Atendemos de lunes a viernes de 5:00 AM a 11:00 PM y fines de semana de 7:00 AM a 8:00 PM.', en: 'Mon-Fri 5 AM-11 PM, weekends 7 AM-8 PM.', pt: 'Seg-sex 5h-23h, fim de semana 7h-20h.', fr: 'Lun-ven 5h-23h, week-end 7h-20h.' }, category: 'horarios' },
    ],
    services: [
        { name: { es: 'Plan Mensual', en: 'Monthly plan', pt: 'Plano mensal', fr: 'Forfait mensuel' }, description: { es: 'Acceso ilimitado al gym + 8 clases grupales/mes', en: 'Unlimited gym + 8 group classes/month', pt: 'Acesso ilimitado + 8 aulas/mes', fr: 'Acces illimite + 8 cours/mois' }, durationMinutes: 30, price: 150000, currency: 'COP', category: 'plan' },
        { name: { es: 'Trial 1 día', en: '1-day trial', pt: 'Trial 1 dia', fr: 'Essai 1 jour' }, description: { es: 'Prueba el gym por un día sin compromiso', en: 'Try the gym for one day, no commitment', pt: 'Experimente por um dia', fr: 'Essai sans engagement' }, durationMinutes: 60, price: 0, currency: 'COP', category: 'trial' },
        { name: { es: 'Personal Training (sesión)', en: 'Personal training (session)', pt: 'Personal training (sessao)', fr: 'Coaching personnel (seance)' }, description: { es: 'Sesion individual con entrenador certificado', en: 'One-on-one session with certified trainer', pt: 'Sessao individual', fr: 'Seance individuelle' }, durationMinutes: 60, price: 80000, currency: 'COP', category: 'personal_training' },
    ],
    businessHours: {
        schedule: { mon: '05:00-23:00', tue: '05:00-23:00', wed: '05:00-23:00', thu: '05:00-23:00', fri: '05:00-23:00', sat: '07:00-20:00', sun: '07:00-20:00' },
        afterHoursMessage: { es: 'Estamos cerrados. Te respondo en cuanto abramos.', en: 'We are closed. We will respond when we open.', pt: 'Estamos fechados.', fr: 'Nous sommes fermes.' },
    },
    sidebar: {
        labelOverrides: {
            crm: { es: 'Miembros', en: 'Members', pt: 'Alunos', fr: 'Membres' },
            pipeline: { es: 'Inscripciones', en: 'Enrollments', pt: 'Matriculas', fr: 'Inscriptions' },
            appointments: { es: 'Reservas', en: 'Bookings', pt: 'Reservas', fr: 'Reservations' },
        },
        hiddenItems: [],
    },
    dashboard: {
        kpis: [
            { key: 'leadsToday', label: { es: 'Interesados Hoy', en: 'Prospects Today', pt: 'Interessados Hoje', fr: 'Prospects Aujourd\'hui' }, icon: 'UserPlus', color: '#3498db' },
            { key: 'appointmentsToday', label: { es: 'Reservas Clases', en: 'Class Bookings', pt: 'Reservas Aulas', fr: 'Reservations Cours' }, icon: 'Dumbbell', color: '#2ecc71' },
            { key: 'messagesProcessed', label: { es: 'Mensajes', en: 'Messages', pt: 'Mensagens', fr: 'Messages' }, icon: 'MessageSquare', color: '#9b59b6' },
            { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Cout IA' }, icon: 'DollarSign', color: '#e67e22' },
        ],
    },
    bookingEnabled: true,
};

const VETERINARIA: VerticalDefinition = {
    industry: 'veterinaria',
    subTypes: [
        { key: 'clinica_general', label: { es: 'Clinica de pequeñas especies', en: 'Small animal clinic', pt: 'Clinica de pequenos animais', fr: 'Clinique petits animaux' } },
        { key: 'hospital_24h', label: { es: 'Hospital veterinario 24h', en: '24h veterinary hospital', pt: 'Hospital veterinario 24h', fr: 'Hopital veterinaire 24h' } },
        { key: 'exoticos', label: { es: 'Animales exoticos', en: 'Exotic animals', pt: 'Animais exoticos', fr: 'Animaux exotiques' } },
        { key: 'peluqueria_canina', label: { es: 'Peluqueria canina / felina', en: 'Pet grooming', pt: 'Banho e tosa', fr: 'Toilettage' } },
    ],
    terminology: {
        customerNoun: { es: 'tutor', en: 'pet parent', pt: 'tutor', fr: 'tuteur' },
        customerNounPlural: { es: 'tutores', en: 'pet parents', pt: 'tutores', fr: 'tuteurs' },
        transactionNoun: { es: 'consulta', en: 'consultation', pt: 'consulta', fr: 'consultation' },
        serviceNoun: { es: 'servicio veterinario', en: 'veterinary service', pt: 'servico veterinario', fr: 'service veterinaire' },
        pipelineNoun: { es: 'seguimiento', en: 'patient journey', pt: 'acompanhamento', fr: 'suivi' },
    },
    agent: {
        name: { es: 'Dra. Ana', en: 'Dr. Ana', pt: 'Dra. Ana', fr: 'Dr. Ana' },
        role: { es: 'Asistente de la clinica veterinaria', en: 'Veterinary clinic assistant', pt: 'Assistente da clinica veterinaria', fr: 'Assistante de la clinique veterinaire' },
        tone: 'warm',
        formality: 'semi-formal',
        greeting: { es: '¡Hola! Soy Ana, asistente de la clinica veterinaria. ¿Como puedo ayudarte con tu mascota hoy?', en: 'Hi! I am Ana, the veterinary clinic assistant. How can I help your pet today?', pt: 'Ola! Sou Ana, assistente da clinica veterinaria. Como posso ajudar seu pet?', fr: 'Bonjour! Je suis Ana, assistante de la clinique veterinaire. Comment puis-je aider votre animal?' },
        rules: {
            es: 'Llama "tutor" al dueño y "paciente" a la mascota. Siempre verifica cual mascota antes de agendar. Nunca des diagnosticos ni nombres de medicamentos. Para urgencias escala inmediatamente.',
            en: 'Call the owner "pet parent" and the animal "patient". Always verify which pet before scheduling. Never provide diagnoses or medication names. Escalate emergencies immediately.',
            pt: 'Chame o dono de "tutor" e o animal de "paciente". Sempre verifique qual pet antes de agendar. Nunca forneca diagnosticos.',
            fr: 'Appelez le proprietaire "tuteur" et l\'animal "patient". Verifiez toujours quel animal avant de planifier. Ne jamais fournir de diagnostics.',
        },
        forbiddenTopics: {
            es: 'Diagnosticos veterinarios|Prescripcion de medicamentos|Dosis|Eutanasia|Pronostico de enfermedad|Interpretacion de examenes|Datos de otras mascotas',
            en: 'Veterinary diagnoses|Medication prescription|Dosing|Euthanasia|Disease prognosis|Test interpretation|Other patients data',
            pt: 'Diagnosticos veterinarios|Prescricao de medicamentos|Doses|Eutanasia|Prognosticos|Interpretacao de exames',
            fr: 'Diagnostics veterinaires|Prescription de medicaments|Doses|Euthanasie|Pronostics|Interpretation d\'examens',
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
            { name: { es: 'Consulta inicial', en: 'Initial inquiry', pt: 'Consulta inicial', fr: 'Demande initiale' }, slug: 'consulta_inicial', color: '#3498db', probability: 10, isTerminal: false },
            { name: { es: 'Cita agendada', en: 'Appointment scheduled', pt: 'Consulta agendada', fr: 'Rendez-vous planifie' }, slug: 'cita_agendada', color: '#f39c12', probability: 30, isTerminal: false },
            { name: { es: 'Primera visita', en: 'First visit', pt: 'Primeira visita', fr: 'Premiere visite' }, slug: 'primera_visita', color: '#e67e22', probability: 50, isTerminal: false },
            { name: { es: 'Paciente activo', en: 'Active patient', pt: 'Paciente ativo', fr: 'Patient actif' }, slug: 'paciente_activo', color: '#2ecc71', probability: 80, isTerminal: false },
            { name: { es: 'Plan de vacunacion', en: 'Vaccination plan', pt: 'Plano de vacinacao', fr: 'Plan de vaccination' }, slug: 'plan_vacunacion', color: '#27ae60', probability: 90, isTerminal: false },
            { name: { es: 'Alta', en: 'Discharged', pt: 'Alta', fr: 'Sorti' }, slug: 'alta', color: '#95a5a6', probability: 100, isTerminal: true },
        ],
    },
    faqs: [
        { question: { es: '¿Atienden urgencias?', en: 'Do you handle emergencies?', pt: 'Atendem urgencias?', fr: 'Gerez-vous les urgences?' }, answer: { es: 'En horario de atencion atendemos urgencias con prioridad. Fuera de horario, dirigete al hospital veterinario 24h mas cercano.', en: 'During business hours we prioritize emergencies. After hours, go to the nearest 24h veterinary hospital.', pt: 'Em horario de atendimento atendemos urgencias com prioridade. Fora do horario, va ao hospital veterinario 24h mais proximo.', fr: 'Pendant les heures d\'ouverture nous priorisons les urgences. En dehors, allez a l\'hopital veterinaire 24h le plus proche.' }, category: 'urgencias' },
        { question: { es: '¿Que vacunas necesita mi mascota?', en: 'What vaccines does my pet need?', pt: 'Que vacinas meu pet precisa?', fr: 'Quels vaccins pour mon animal?' }, answer: { es: 'Depende de la especie, edad y estilo de vida. Agenda una consulta y el medico te indicara el plan de vacunacion adecuado.', en: 'It depends on the species, age and lifestyle. Schedule a consultation and the vet will recommend the right vaccination plan.', pt: 'Depende da especie, idade e estilo de vida. Agende uma consulta para o plano correto.', fr: 'Cela depend de l\'espece, l\'age et le mode de vie. Prenez rendez-vous pour un plan adapte.' }, category: 'vacunas' },
        { question: { es: '¿Hacen esterilizacion?', en: 'Do you perform spay/neuter surgery?', pt: 'Fazem castracao?', fr: 'Faites-vous la sterilisation?' }, answer: { es: 'Si, ofrecemos esterilizacion. Es un procedimiento ambulatorio. Tu mascota necesita ayuno previo y revision general.', en: 'Yes, we offer spay/neuter. It is outpatient. Your pet will need pre-op fasting and a general check-up.', pt: 'Sim, fazemos castracao ambulatorial. O pet precisa de jejum e check-up.', fr: 'Oui, nous proposons la sterilisation ambulatoire. Jeun prealable et bilan general requis.' }, category: 'cirugias' },
        { question: { es: '¿Atienden mascotas exoticas?', en: 'Do you treat exotic pets?', pt: 'Atendem pets exoticos?', fr: 'Soignez-vous les NAC?' }, answer: { es: 'Cuentanos que especie es y te confirmamos. Tenemos veterinarios especializados en algunas especies.', en: 'Tell us the species and we will confirm. We have specialists for several species.', pt: 'Conte-nos a especie e confirmaremos. Temos veterinarios especialistas.', fr: 'Dites-nous l\'espece et nous confirmerons. Nous avons des specialistes.' }, category: 'general' },
        { question: { es: '¿Como funciona el plan integral / preventivo?', en: 'How does the wellness plan work?', pt: 'Como funciona o plano preventivo?', fr: 'Comment fonctionne le plan de bien-etre?' }, answer: { es: 'Es un plan anual que incluye consultas, vacunas y desparasitacion. Pregunta por planes en tu primera visita.', en: 'It is an annual plan covering visits, vaccines and deworming. Ask about plans on your first visit.', pt: 'Plano anual com consultas, vacinas e vermifugos.', fr: 'Plan annuel avec visites, vaccins et vermifuges.' }, category: 'planes' },
    ],
    services: [
        { name: { es: 'Consulta general', en: 'General consultation', pt: 'Consulta geral', fr: 'Consultation generale' }, description: { es: 'Consulta veterinaria general', en: 'General veterinary consultation', pt: 'Consulta veterinaria geral', fr: 'Consultation veterinaire generale' }, durationMinutes: 30, price: 60000, currency: 'COP', category: 'consulta' },
        { name: { es: 'Vacunacion', en: 'Vaccination', pt: 'Vacinacao', fr: 'Vaccination' }, description: { es: 'Aplicacion de vacuna', en: 'Vaccine application', pt: 'Aplicacao de vacina', fr: 'Application de vaccin' }, durationMinutes: 20, price: 50000, currency: 'COP', category: 'preventiva' },
        { name: { es: 'Desparasitacion', en: 'Deworming', pt: 'Vermifugacao', fr: 'Vermifugation' }, description: { es: 'Desparasitacion interna y externa', en: 'Internal and external deworming', pt: 'Vermifugacao interna e externa', fr: 'Vermifugation' }, durationMinutes: 15, price: 35000, currency: 'COP', category: 'preventiva' },
        { name: { es: 'Bañado y peluqueria', en: 'Bathing and grooming', pt: 'Banho e tosa', fr: 'Bain et toilettage' }, description: { es: 'Servicio de peluqueria', en: 'Grooming service', pt: 'Servico de banho e tosa', fr: 'Service de toilettage' }, durationMinutes: 60, price: 80000, currency: 'COP', category: 'estetica' },
    ],
    businessHours: {
        schedule: { mon: '08:00-18:00', tue: '08:00-18:00', wed: '08:00-18:00', thu: '08:00-18:00', fri: '08:00-18:00', sat: '08:00-13:00' },
        afterHoursMessage: { es: 'Estamos fuera de horario. En caso de urgencia veterinaria dirigete al hospital 24h mas cercano. Para consultas no urgentes te responderemos al iniciar jornada.', en: 'We are closed. For emergencies go to the nearest 24h vet hospital. For non-urgent inquiries we will reply when we open.', pt: 'Estamos fora do horario. Para urgencias va ao hospital 24h mais proximo.', fr: 'Nous sommes fermes. Pour les urgences allez a l\'hopital veterinaire 24h le plus proche.' },
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
            { key: 'llmCostToday', label: { es: 'Costo IA', en: 'AI Cost', pt: 'Custo IA', fr: 'Cout IA' }, icon: 'DollarSign', color: '#e67e22' },
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
    otro: OTRO,
};

export function getVerticalDefinition(industry: string): VerticalDefinition {
    return VERTICAL_REGISTRY[industry] || VERTICAL_REGISTRY['otro'];
}
