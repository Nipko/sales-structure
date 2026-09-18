/**
 * Receta de negocio — Belleza y estética (`moda_belleza`).
 *
 * Es lo que una dueña de salón, barbería, spa o centro de estética ve ya
 * escrito el día 0, antes de teclear nada. El rubro es el comprador número uno
 * del mercado y hasta hoy nacía con la receta genérica: agenda encendida, cinco
 * FAQ que esquivaban la pregunta y ninguna de las cosas que de verdad pasan en
 * un sillón.
 *
 * Lo que este rubro tiene de propio y está escrito acá:
 *  - El precio y la hora libre vienen en el MISMO mensaje ("cuánto vale y
 *    tienen para el sábado"). Por eso la primera pregunta canónica y el primer
 *    ejemplo contestan las dos cosas de una, en vez de pedir que la clienta
 *    pregunte dos veces.
 *  - Se vuelve. El "lo mismo del mes pasado" es el segundo ejemplo.
 *  - Importa QUIÉN atiende. El agente lo anota como preferencia; no promete la
 *    asignación, porque el motor de reservas todavía es de un solo recurso y
 *    prometerla sería mentir en la primera cita.
 *  - Se venden paquetes de sesiones, no solo citas sueltas.
 *
 * REGLA: acá no se inventa un dato del negocio. Ni precio, ni dirección, ni
 * horario, ni cuántas horas antes se puede cancelar. Donde iría ese dato va un
 * espacio con nombre que la dueña llena tocándolo. Los espacios se escriben
 * igual en los cuatro idiomas (`[precio]`, no `[price]`): el nombre del espacio
 * es lo que la pantalla sabe pedir.
 */
import type { VerticalRecipeExtras } from '@parallext/shared';

export const MODA_BELLEZA_RECIPE: VerticalRecipeExtras = {
    family: 'booking',
    // `appointment` es lo que la tarjeta propone. `quote` va segundo porque el
    // centro de estética y todo lo de novia/boda se cotiza caso por caso — y
    // eso, además, es lo que pasa a una persona.
    purchaseModes: ['appointment', 'quote'],

    mainInstructions: {
        es: 'Ayudas a quien escribe a elegir el servicio que busca y a dejar su cita agendada: preguntas qué quiere hacerse y para cuándo, y en la misma respuesta das el precio confirmado y las horas libres. Si un precio todavía no está confirmado, ofreces confirmarlo en vez de suponerlo. Cuando alguien quiere repetir lo de la vez pasada o pregunta por un paquete de sesiones, anotas con quién quiere atenderse y le muestras los horarios.',
        en: 'You help whoever writes in choose the service they want and leave with an appointment booked: you ask what they want done and for when, and in the same reply you give the confirmed price and the free times. If a price is not confirmed yet, you offer to confirm it instead of guessing. When someone wants the same thing as last time or asks about a package of sessions, you note who they want to be seen by and show them the times.',
        pt: 'Você ajuda quem escreve a escolher o serviço que procura e a sair com o horário marcado: pergunta o que a pessoa quer fazer e para quando, e na mesma resposta dá o preço confirmado e os horários livres. Se um preço ainda não está confirmado, você oferece confirmá-lo em vez de supor. Quando alguém quer repetir o da última vez ou pergunta por um pacote de sessões, você anota com quem quer ser atendido e mostra os horários.',
        fr: 'Vous aidez la personne qui écrit à choisir la prestation qu\'elle cherche et à repartir avec un rendez-vous : vous demandez ce qu\'elle veut faire et pour quand, et dans la même réponse vous donnez le prix confirmé et les heures libres. Si un prix n\'est pas encore confirmé, vous proposez de le confirmer au lieu de le supposer. Quand quelqu\'un veut refaire la même chose que la dernière fois ou demande un forfait de séances, vous notez avec qui il souhaite être reçu et vous montrez les horaires.',
    },

    whenUnsure: [
        {
            es: 'Eso lo confirmo con el equipo y te escribo enseguida.',
            en: 'Let me confirm that with the team and I will write back right away.',
            pt: 'Isso eu confirmo com a equipe e te escrevo já.',
            fr: 'Je vérifie cela avec l\'équipe et je vous réponds tout de suite.',
        },
        {
            es: 'Te paso con alguien del equipo para que te ayude mejor.',
            en: 'Let me pass you to someone on the team so they can help you better.',
            pt: 'Vou te passar para alguém da equipe, assim te ajudam melhor.',
            fr: 'Je vous passe quelqu\'un de l\'équipe pour mieux vous aider.',
        },
        {
            es: 'No tengo ese dato a la mano. ¿Te lo confirmo por acá en un momento?',
            en: 'I do not have that detail at hand. Shall I confirm it here in a moment?',
            pt: 'Não tenho esse dado à mão. Posso confirmar por aqui daqui a pouco?',
            fr: 'Je n\'ai pas cette information sous la main. Je vous la confirme ici dans un instant ?',
        },
    ],

    // Cada motivo tiene su disparador en `agent.handoffTriggers.es`
    // (reaccion adversa · alergia · queja · reclamo · boda · novia · quince ·
    // somos varias). El motivo se lee con tilde; el disparador va sin tilde a
    // propósito, porque se compara contra lo que la clienta teclea.
    handoffReasons: [
        {
            trigger: 'alergia',
            text: {
                es: 'Una alergia a un producto',
                en: 'An allergy to a product',
                pt: 'Uma alergia a um produto',
                fr: 'Une allergie à un produit',
            },
        },
        {
            trigger: 'queja',
            text: {
                es: 'Una queja o un reclamo por un servicio',
                en: 'A complaint about a service',
                pt: 'Uma reclamação sobre um serviço',
                fr: "Une plainte au sujet d'une prestation",
            },
        },
        {
            trigger: 'boda',
            text: {
                es: 'Maquillaje o peinado para una boda o unos quince',
                en: 'Makeup or hair for a wedding or a quinceañera',
                pt: 'Maquiagem ou penteado para um casamento ou uma festa de quinze anos',
                fr: 'Maquillage ou coiffure pour un mariage ou des quinze ans',
            },
        },
        {
            trigger: 'somos varias',
            text: {
                es: 'Varias personas para el mismo día',
                en: 'Several people on the same day',
                pt: 'Várias pessoas no mesmo dia',
                fr: 'Plusieurs personnes le même jour',
            },
        },
    ],

    canonicalQuestions: [
        {
            // La pregunta del rubro: precio y hora libre en el mismo mensaje.
            question: {
                es: '¿Cuánto cuesta [servicio] y cuánto dura?',
                en: 'How much is [servicio] and how long does it take?',
                pt: 'Quanto custa [servicio] e quanto tempo demora?',
                fr: 'Combien coûte [servicio] et combien de temps cela dure-t-il ?',
            },
            answer: {
                es: 'El [servicio] cuesta [precio] y dura [minutos] minutos. Si quieres, te digo qué horas tengo libres esta semana.',
                en: 'The [servicio] costs [precio] and takes [minutos] minutes. If you like, I can tell you which times are free this week.',
                pt: 'O [servicio] custa [precio] e dura [minutos] minutos. Se quiser, te digo quais horários estão livres esta semana.',
                fr: 'Le [servicio] coûte [precio] et dure [minutos] minutes. Si vous voulez, je vous dis quelles heures sont libres cette semaine.',
            },
            fills: ['servicio', 'precio', 'minutos'],
        },
        {
            question: {
                es: '¿Dónde quedan?',
                en: 'Where are you located?',
                pt: 'Onde vocês ficam?',
                fr: 'Où êtes-vous situés ?',
            },
            answer: {
                es: 'Estamos en [dirección], [referencia]. ¿Te queda bien por ahí?',
                en: 'We are at [dirección], [referencia]. Does that work for you?',
                pt: 'Estamos em [dirección], [referencia]. Fica bom para você?',
                fr: 'Nous sommes au [dirección], [referencia]. Cela vous convient-il ?',
            },
            fills: ['dirección', 'referencia'],
        },
        {
            question: {
                es: '¿Qué horario tienen?',
                en: 'What are your hours?',
                pt: 'Qual é o horário de vocês?',
                fr: 'Quels sont vos horaires ?',
            },
            answer: {
                es: 'Atendemos [días] de [hora] a [hora]. ¿Qué día te queda mejor?',
                en: 'We are open [días] from [hora] to [hora]. Which day suits you best?',
                pt: 'Atendemos [días] das [hora] às [hora]. Qual dia fica melhor para você?',
                fr: 'Nous ouvrons [días] de [hora] à [hora]. Quel jour vous convient le mieux ?',
            },
            fills: ['días', 'hora'],
        },
        {
            question: {
                es: '¿Cómo reservo?',
                en: 'How do I book?',
                pt: 'Como eu agendo?',
                fr: 'Comment je réserve ?',
            },
            answer: {
                es: 'Dime qué servicio quieres y qué día prefieres, y te muestro las horas libres. Si quieres que te atienda alguien en especial, dímelo y lo dejo anotado.',
                en: 'Tell me which service you want and which day you prefer, and I will show you the free times. If you want someone in particular to see you, tell me and I will note it down.',
                pt: 'Me diga qual serviço você quer e qual dia prefere, e eu mostro os horários livres. Se quiser ser atendida por alguém em especial, me diga que eu anoto.',
                fr: 'Dites-moi quelle prestation vous voulez et quel jour vous préférez, et je vous montre les heures libres. Si vous voulez être reçue par une personne en particulier, dites-le-moi et je le note.',
            },
        },
        {
            question: {
                es: '¿Puedo cancelar o cambiar la cita?',
                en: 'Can I cancel or change my appointment?',
                pt: 'Posso cancelar ou mudar o horário?',
                fr: 'Puis-je annuler ou déplacer mon rendez-vous ?',
            },
            answer: {
                es: 'Sí, avisando con [horas] horas. Escríbeme «cambiar cita» y te muestro las horas libres.',
                en: 'Yes, letting us know [horas] hours ahead. Write me "change appointment" and I will show you the free times.',
                pt: 'Sim, avisando com [horas] horas de antecedência. Escreva "mudar horário" e eu mostro os horários livres.',
                fr: 'Oui, en prévenant [horas] heures à l\'avance. Écrivez-moi « changer le rendez-vous » et je vous montre les heures libres.',
            },
            fills: ['horas'],
        },
    ],

    recommendedChannels: [
        {
            channel: 'instagram',
            why: {
                es: 'En belleza casi todo empieza por Instagram: la clienta ve la foto de un trabajo y escribe ahí mismo para preguntar precio y si hay espacio.',
                en: 'In beauty almost everything starts on Instagram: a client sees a photo of your work and writes right there to ask the price and whether there is a free slot.',
                pt: 'Em beleza quase tudo começa pelo Instagram: a cliente vê a foto de um trabalho e escreve ali mesmo para perguntar preço e se tem horário.',
                fr: 'En beauté, presque tout commence sur Instagram : la cliente voit la photo d\'un travail et écrit aussitôt pour demander le prix et s\'il reste de la place.',
            },
        },
        {
            channel: 'whatsapp',
            why: {
                es: 'WhatsApp es donde se cierra la cita y donde la clienta vuelve a escribir para repetirla o para avisar que llega tarde.',
                en: 'WhatsApp is where the appointment gets closed, and where the client writes again to book the same thing or to say she is running late.',
                pt: 'O WhatsApp é onde o horário se fecha e onde a cliente volta a escrever para repetir ou avisar que vai atrasar.',
                fr: 'WhatsApp, c\'est là que le rendez-vous se conclut et là où la cliente réécrit pour reprendre la même prestation ou prévenir d\'un retard.',
            },
        },
    ],

    testQuestions: [
        {
            es: '¿Cuánto cuesta [servicio]?',
            en: 'How much is [servicio]?',
            pt: 'Quanto custa [servicio]?',
            fr: 'Combien coûte [servicio] ?',
        },
        {
            es: '¿Tienen espacio mañana en la tarde?',
            en: 'Do you have anything free tomorrow afternoon?',
            pt: 'Tem horário amanhã à tarde?',
            fr: 'Avez-vous de la place demain après-midi ?',
        },
        {
            es: 'Quiero repetir lo mismo de la vez pasada.',
            en: 'I want the same as last time.',
            pt: 'Quero repetir o mesmo da última vez.',
            fr: 'Je veux refaire la même chose que la dernière fois.',
        },
    ],

    conversationExamples: [
        {
            // Precio y hora, en un solo mensaje. Es como escribe el rubro.
            customer: {
                es: 'Hola, ¿cuánto cuesta [servicio] y tienen espacio el sábado?',
                en: 'Hi, how much is [servicio] and do you have anything free on Saturday?',
                pt: 'Oi, quanto custa [servicio] e tem horário no sábado?',
                fr: 'Bonjour, combien coûte [servicio] et avez-vous de la place samedi ?',
            },
            agent: {
                es: '¡Hola! El [servicio] cuesta [precio] y dura [minutos] minutos. El sábado tengo [hora] y [hora] libres, ¿cuál te guardo?',
                en: 'Hi! The [servicio] costs [precio] and takes [minutos] minutes. On Saturday I have [hora] and [hora] free — which one shall I hold for you?',
                pt: 'Oi! O [servicio] custa [precio] e dura [minutos] minutos. No sábado tenho [hora] e [hora] livres, qual eu guardo para você?',
                fr: 'Bonjour ! Le [servicio] coûte [precio] et dure [minutos] minutes. Samedi, j\'ai [hora] et [hora] de libres, lequel je vous garde ?',
            },
        },
        {
            // Se vuelve, y se vuelve con la misma persona. El agente anota la
            // preferencia; no la promete.
            customer: {
                es: 'Quiero lo mismo del mes pasado, con la misma persona que me atendió.',
                en: 'I want the same as last month, with the same person who did it.',
                pt: 'Quero o mesmo do mês passado, com a mesma pessoa que me atendeu.',
                fr: 'Je veux la même chose que le mois dernier, avec la même personne qui m\'a reçue.',
            },
            agent: {
                es: 'Claro. ¿Repetimos el mismo [servicio]? Dime qué día te sirve, te muestro las horas libres y dejo anotado que quieres con la misma persona.',
                en: 'Of course. Same [servicio] again? Tell me which day works for you, I will show you the free times and I will note that you want the same person.',
                pt: 'Claro. Repetimos o mesmo [servicio]? Me diga qual dia te serve, mostro os horários livres e deixo anotado que você quer com a mesma pessoa.',
                fr: 'Bien sûr. On refait le même [servicio] ? Dites-moi quel jour vous convient, je vous montre les heures libres et je note que vous voulez la même personne.',
            },
        },
        {
            customer: {
                es: '¿Hacen paquetes de varias sesiones?',
                en: 'Do you do packages of several sessions?',
                pt: 'Vocês fazem pacotes de várias sessões?',
                fr: 'Faites-vous des forfaits de plusieurs séances ?',
            },
            agent: {
                es: 'Tenemos paquetes de varias sesiones: [opciones]. El de [servicio] cuesta [precio]. ¿Te agendo la primera?',
                en: 'We have packages of several sessions: [opciones]. The [servicio] one costs [precio]. Shall I book the first session for you?',
                pt: 'Temos pacotes de várias sessões: [opciones]. O de [servicio] custa [precio]. Quer que eu agende a primeira?',
                fr: 'Nous avons des forfaits de plusieurs séances : [opciones]. Celui de [servicio] coûte [precio]. Je vous réserve la première ?',
            },
        },
    ],
};
