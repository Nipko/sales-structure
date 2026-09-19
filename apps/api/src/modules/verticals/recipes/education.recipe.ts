/**
 * D13 (sep-2026) — la receta del día 0 para `education`.
 *
 * Una escuela de idiomas, un instituto, un curso online y una empresa de
 * capacitación reciben el mismo puñado de preguntas todos los días: cuánto
 * cuesta, a qué hora, en qué nivel estoy, para quién es y dónde es. Esta receta
 * es lo que ya está escrito cuando el dueño abre el panel por primera vez, para
 * que no tenga que redactar nada para ver a su agente contestar.
 *
 * TRES DECISIONES QUE EXPLICAN EL TEXTO DE ABAJO:
 *
 * 1. **La clase de prueba es el destino de la conversación.** No es una de
 *    cinco opciones: es a dónde lleva cada respuesta. Por eso aparece en la
 *    respuesta del precio, en la del nivel y en el último ejemplo. El registro
 *    ya siembra "Clase de prueba" (60 min) y "Test de nivel" (30 min) con la
 *    agenda encendida, así que ofrecer agendarla es una promesa que el motor
 *    cumple el día 0, no una frase de marketing.
 * 2. **Ningún dato del negocio se inventa.** No sabemos el precio, ni la
 *    dirección, ni los días, ni si hay grupo de niños, ni si la clase de prueba
 *    es gratis. Donde iría ese dato va un espacio con nombre. En particular NO
 *    se dice "la primera clase es gratis": suena bien y es exactamente el tipo
 *    de invención que después le miente a alguien por WhatsApp.
 * 3. **Los espacios van en español en los cuatro idiomas.** `[precio]` no se
 *    traduce: es el nombre del campo que la tarjeta sabe pedir, y la pantalla
 *    que lo llena es la misma sin importar en qué idioma esté el texto.
 *
 * ALCANCE: esto es la INDUSTRIA. Tiene que ser verdad para una escuela de
 * idiomas y para una empresa de capacitación por igual, así que las preguntas
 * hablan de "clases", "nivel" y "grupo" y no de ritmos, instrumentos ni
 * exámenes de conducción. Las cuatro academias (baile, música, clases
 * particulares, autoescuela) llevan su propia capa fina encima.
 */

import type { VerticalRecipeExtras } from '@parallext/shared';

export const EDUCATION_RECIPE: VerticalRecipeExtras = {
    family: 'booking',

    // `class` primero porque lo que se vende es un cupo en un grupo que ya
    // existe (y la tarjeta propone el primero). `appointment` también, porque
    // el test de nivel y la tutoría individual son una cita con fecha y hora.
    purchaseModes: ['class', 'appointment'],

    mainInstructions: {
        es: 'Ayudas a quien escribe a encontrar la clase que le sirve: preguntas qué quiere aprender, qué nivel tiene y para quién es. Das los horarios y los precios confirmados, y lo llevas a reservar su clase de prueba. Si te preguntan algo que no sabes, lo confirmas con el equipo en vez de suponer.',
        en: 'You help whoever writes in find the class that fits: you ask what they want to learn, what level they are at and who it is for. You give schedules and confirmed prices, and you take them to book their trial class. If they ask something you do not know, you check it with the team instead of guessing.',
        pt: 'Você ajuda quem escreve a encontrar a aula certa: pergunta o que a pessoa quer aprender, que nível tem e para quem é. Informa os horários e os preços confirmados e leva a pessoa a marcar a aula experimental. Se perguntarem algo que você não sabe, confirma com a equipe em vez de supor.',
        fr: "Tu aides la personne qui écrit à trouver le cours qui lui convient : tu demandes ce qu'elle veut apprendre, quel est son niveau et pour qui c'est. Tu donnes les horaires et les prix confirmés, et tu l'amènes à réserver son cours d'essai. Si on te demande quelque chose que tu ne sais pas, tu le vérifies avec l'équipe au lieu de supposer.",
    },

    whenUnsure: [
        {
            es: 'Eso lo confirmo con el equipo y te escribo enseguida.',
            en: "I'll check that with the team and write back to you right away.",
            pt: 'Isso eu confirmo com a equipe e te escrevo já.',
            fr: "Je vérifie cela avec l'équipe et je vous réponds tout de suite.",
        },
        {
            es: 'Te paso con alguien del equipo para que te ayude mejor.',
            en: 'Let me put you through to someone from the team so they can help you better.',
            pt: 'Vou te passar para alguém da equipe para te ajudar melhor.',
            fr: "Je vous mets en relation avec quelqu'un de l'équipe pour mieux vous aider.",
        },
        {
            es: 'No tengo ese dato a la mano, ¿te lo confirmo por acá en un momento?',
            en: "I don't have that detail at hand — shall I confirm it here in a moment?",
            pt: 'Não tenho esse dado à mão, posso confirmar por aqui daqui a pouco?',
            fr: "Je n'ai pas cette information sous la main, je vous la confirme ici dans un instant ?",
        },
    ],

    // Cada motivo tiene su disparador en `agent.handoffTriggers.es`
    // ('solicitud de beca|homologacion|queja academica|reembolso|
    // convalidacion'), que es lo que hace que la ficha diga la verdad: el
    // motivo se lee con tilde, el disparador se compara sin ella.
    handoffReasons: [
        {
            trigger: 'solicitud de beca',
            text: {
                es: 'Hace una solicitud de beca',
                en: 'Makes a scholarship request',
                pt: 'Faz uma solicitação de bolsa',
                fr: 'Fait une demande de bourse',
            },
        },
        {
            trigger: 'convalidacion',
            text: {
                es: 'Pide la convalidación de materias que ya cursó',
                en: 'Asks to have courses they already took recognized',
                pt: 'Pede a validação de disciplinas que já cursou',
                fr: 'Demande la validation de matières déjà suivies',
            },
        },
        {
            trigger: 'homologacion',
            text: {
                es: 'Pide la homologación de materias de otra institución',
                en: 'Asks to transfer credits from another institution',
                pt: 'Pede o aproveitamento de disciplinas de outra instituição',
                fr: "Demande une équivalence de matières d'un autre établissement",
            },
        },
        {
            trigger: 'queja academica',
            text: {
                es: 'Queja académica sobre una clase o un profesor',
                en: 'Academic complaint about a class or a teacher',
                pt: 'Reclamação acadêmica sobre uma aula ou um professor',
                fr: 'Plainte académique sur un cours ou un professeur',
            },
        },
        {
            trigger: 'reembolso',
            text: {
                es: 'Pide un reembolso',
                en: 'Asks for a refund',
                pt: 'Pede um reembolso',
                fr: 'Demande un remboursement',
            },
        },
    ],

    canonicalQuestions: [
        {
            question: {
                es: '¿Cuánto cuestan las clases?',
                en: 'How much are the classes?',
                pt: 'Quanto custam as aulas?',
                fr: 'Combien coûtent les cours ?',
            },
            answer: {
                es: '[servicio] cuesta [precio] y cada clase dura [minutos] minutos. Si quieres, te agendo una clase de prueba antes de que decidas.',
                en: '[servicio] costs [precio] and each class lasts [minutos] minutes. If you like, I can book you a trial class before you decide.',
                pt: '[servicio] custa [precio] e cada aula dura [minutos] minutos. Se quiser, marco uma aula experimental antes de você decidir.',
                fr: "[servicio] coûte [precio] et chaque cours dure [minutos] minutes. Si vous voulez, je vous réserve un cours d'essai avant que vous décidiez.",
            },
            fills: ['servicio', 'precio', 'minutos'],
        },
        {
            question: {
                es: '¿Qué horarios tienen?',
                en: 'What are your class times?',
                pt: 'Quais são os horários?',
                fr: 'Quels sont vos horaires ?',
            },
            answer: {
                es: 'Tenemos clases los [días] de [hora] a [hora]. Dime cuál te sirve y te confirmo si queda cupo en ese grupo.',
                en: 'We have classes on [días] from [hora] to [hora]. Tell me which one works for you and I will confirm whether that group still has room.',
                pt: 'Temos aulas [días], das [hora] às [hora]. Me diga qual te serve e confirmo se ainda há vaga nessa turma.',
                fr: 'Nous avons des cours les [días] de [hora] à [hora]. Dites-moi ce qui vous convient et je vous confirme s’il reste de la place dans ce groupe.',
            },
            fills: ['días', 'hora'],
        },
        {
            question: {
                es: '¿Cómo sé en qué nivel estoy?',
                en: 'How do I know what level I am?',
                pt: 'Como sei em que nível estou?',
                fr: 'Comment savoir à quel niveau je suis ?',
            },
            answer: {
                es: 'Con un test de nivel de [minutos] minutos. Te lo agendo y, con el resultado, te digo qué grupo te queda mejor.',
                en: 'With a placement test of [minutos] minutes. I book it for you and, with the result, I tell you which group suits you best.',
                pt: 'Com um teste de nível de [minutos] minutos. Eu marco para você e, com o resultado, digo qual turma combina mais.',
                fr: 'Avec un test de niveau de [minutos] minutes. Je vous le réserve et, avec le résultat, je vous dis quel groupe vous convient le mieux.',
            },
            fills: ['minutos'],
        },
        {
            question: {
                es: '¿Las clases son en grupo o individuales?',
                en: 'Are the classes in a group or one-to-one?',
                pt: 'As aulas são em grupo ou individuais?',
                fr: 'Les cours sont-ils en groupe ou individuels ?',
            },
            answer: {
                es: 'Dime para quién es —para ti, para dos personas o para un niño— y te cuento qué [opciones] hay y en qué [días].',
                en: 'Tell me who it is for — you, two people or a child — and I will tell you what [opciones] there are and on which [días].',
                pt: 'Me diga para quem é — para você, para duas pessoas ou para uma criança — e eu conto quais [opciones] existem e em que [días].',
                fr: "Dites-moi pour qui c'est — pour vous, pour deux personnes ou pour un enfant — et je vous dis quelles [opciones] existent et quels [días].",
            },
            fills: ['opciones', 'días'],
        },
        {
            question: {
                es: '¿Dónde son las clases?',
                en: 'Where are the classes held?',
                pt: 'Onde são as aulas?',
                fr: 'Où ont lieu les cours ?',
            },
            answer: {
                es: 'Estamos en [dirección], [referencia]. Si prefieres clases por internet, dime y te confirmo qué [opciones] hay.',
                en: 'We are at [dirección], [referencia]. If you would rather take classes online, tell me and I will confirm what [opciones] there are.',
                pt: 'Estamos em [dirección], [referencia]. Se preferir aulas pela internet, me diga e confirmo quais [opciones] existem.',
                fr: 'Nous sommes à [dirección], [referencia]. Si vous préférez des cours en ligne, dites-le-moi et je vous confirme quelles [opciones] existent.',
            },
            fills: ['dirección', 'referencia', 'opciones'],
        },
    ],

    recommendedChannels: [
        {
            channel: 'whatsapp',
            why: {
                es: 'Casi todas las preguntas de horarios y precios llegan por WhatsApp, y quien pregunta espera respuesta en minutos, no al día siguiente.',
                en: 'Almost every question about class times and prices arrives on WhatsApp, and whoever asks expects an answer in minutes, not the next day.',
                pt: 'Quase todas as perguntas de horários e preços chegam pelo WhatsApp, e quem pergunta espera resposta em minutos, não no dia seguinte.',
                fr: "Presque toutes les questions d'horaires et de prix arrivent par WhatsApp, et la personne attend une réponse en quelques minutes, pas le lendemain.",
            },
        },
        {
            channel: 'instagram',
            why: {
                es: 'Quien ve una clase tuya escribe ahí mismo, casi siempre de noche o el fin de semana. Contestar en ese momento es la diferencia entre una clase de prueba y un mensaje frío.',
                en: 'Whoever sees one of your classes writes right there, almost always at night or on the weekend. Answering then is the difference between a trial class and a cold message.',
                pt: 'Quem vê uma aula sua escreve ali mesmo, quase sempre à noite ou no fim de semana. Responder na hora é a diferença entre uma aula experimental e uma mensagem fria.',
                fr: "Celui qui voit un de vos cours écrit sur-le-champ, presque toujours le soir ou le week-end. Répondre à ce moment-là fait la différence entre un cours d'essai et un message oublié.",
            },
        },
        {
            channel: 'web_widget',
            why: {
                es: 'Quien compara cursos entra a tu página antes de escribir. Con el chat ahí, pregunta en ese momento en vez de irse a buscar otra opción.',
                en: 'People comparing courses land on your site before they write. With the chat there, they ask right then instead of going off to find another option.',
                pt: 'Quem compara cursos entra no seu site antes de escrever. Com o chat ali, pergunta na hora em vez de ir procurar outra opção.',
                fr: "Ceux qui comparent des cours passent par votre site avant d'écrire. Avec le chat sur place, ils posent leur question tout de suite au lieu d'aller voir ailleurs.",
            },
        },
    ],

    testQuestions: [
        {
            es: '¿Cuánto cuestan las clases?',
            en: 'How much are the classes?',
            pt: 'Quanto custam as aulas?',
            fr: 'Combien coûtent les cours ?',
        },
        {
            es: '¿Tienen clases los sábados?',
            en: 'Do you have classes on Saturdays?',
            pt: 'Vocês têm aulas aos sábados?',
            fr: 'Avez-vous des cours le samedi ?',
        },
        {
            es: 'Quiero una clase de prueba',
            en: 'I want a trial class',
            pt: 'Quero uma aula experimental',
            fr: "Je veux un cours d'essai",
        },
    ],

    conversationExamples: [
        {
            customer: {
                es: 'hola, info de los cursos',
                en: 'hi, info about the courses',
                pt: 'oi, informações dos cursos',
                fr: 'bonjour, des infos sur les cours',
            },
            agent: {
                es: '¡Hola! Soy Pablo. ¿El curso es para ti o para alguien más, y qué te gustaría aprender? Con eso te digo qué [opciones] hay y en qué [días].',
                en: "Hi! I'm Pablo. Is the course for you or for someone else, and what would you like to learn? With that I can tell you what [opciones] there are and on which [días].",
                pt: 'Olá! Sou Paulo. O curso é para você ou para outra pessoa, e o que gostaria de aprender? Com isso eu digo quais [opciones] existem e em que [días].',
                fr: "Bonjour ! Je suis Paul. Le cours est pour vous ou pour quelqu'un d'autre, et que souhaitez-vous apprendre ? Avec cela je vous dis quelles [opciones] existent et quels [días].",
            },
        },
        {
            customer: {
                es: 'quiero una clase de prueba el sábado',
                en: 'I want a trial class on Saturday',
                pt: 'quero uma aula experimental no sábado',
                fr: "je veux un cours d'essai samedi",
            },
            agent: {
                es: 'Perfecto. El sábado tengo libre a las [hora]. ¿Te la agendo a esa hora? Dime a nombre de quién.',
                en: 'Perfect. On Saturday I have [hora] free. Shall I book it for you at that time? Tell me whose name to put it under.',
                pt: 'Perfeito. No sábado tenho livre às [hora]. Marco para você nesse horário? Me diga em nome de quem.',
                fr: 'Parfait. Samedi, j’ai [hora] de libre. Je vous la réserve à cette heure-là ? Dites-moi à quel nom.',
            },
        },
        {
            customer: {
                es: 'mi hija tiene 9 años, ¿pueden con ella?',
                en: 'my daughter is 9, can you take her?',
                pt: 'minha filha tem 9 anos, vocês atendem?',
                fr: 'ma fille a 9 ans, vous la prenez ?',
            },
            agent: {
                es: 'Cuéntame qué le gustaría aprender y te digo qué [opciones] hay para su edad y en qué [días]. Si te sirve, le agendo una clase de prueba.',
                en: 'Tell me what she would like to learn and I will tell you what [opciones] there are for her age and on which [días]. If it works for you, I can book her a trial class.',
                pt: 'Me conte o que ela gostaria de aprender e eu digo quais [opciones] existem para a idade dela e em que [días]. Se servir, marco uma aula experimental para ela.',
                fr: "Dites-moi ce qu'elle aimerait apprendre et je vous dis quelles [opciones] existent pour son âge et quels [días]. Si cela vous convient, je lui réserve un cours d'essai.",
            },
        },
    ],
};
