/**
 * D9 / D13 (sep-2026) — la receta de `restaurantes`.
 *
 * Es el texto que un dueño nuevo encuentra YA ESCRITO el día 0, antes de
 * teclear nada: lo que Luca sabe hacer, lo que contesta a las cinco preguntas
 * que el negocio recibe todos los días, qué hace cuando no sabe y por qué
 * motivos pasa a una persona.
 *
 * Restaurantes es la industria donde los dos modos de compra conviven de
 * verdad: el mismo negocio toma un pedido a domicilio y reserva una mesa, a
 * veces en la misma conversación. Por eso `purchaseModes` va con los dos
 * encendidos y `order` primero: el domicilio es el volumen diario, la mesa es
 * el fin de semana.
 *
 * REGLA QUE GOBIERNA CADA LÍNEA: acá no se inventa un dato del negocio. No
 * sabemos la carta, ni el precio del envío, ni hasta qué barrio llegan, ni a
 * qué hora cierran. Donde iría ese dato va un espacio con nombre (`[precio]`,
 * `[zonas]`, `[dirección]`) que el dueño llena tocándolo. Un precio inventado
 * que suena razonable no se ve; sale por WhatsApp y le miente a un cliente que
 * ya está pidiendo.
 *
 * Dos honestidades más, propias del rubro:
 * - Ningún texto asegura que un plato esté libre de alérgenos. Luca avisa a la
 *   cocina y, si la alergia es fuerte, pasa a una persona. Es también lo que
 *   dicen `agent.forbiddenTopics` y el disparador `intoxicacion`.
 * - Mientras el motor de reservas sea de un solo recurso, Luca "toma" la mesa
 *   y el equipo la confirma. No dice que la mesa quedó confirmada.
 */

import type { VerticalRecipeExtras } from '@parallext/shared';

export const RESTAURANTES_RECIPE: VerticalRecipeExtras = {
    family: 'restaurants',
    // Los dos, y en este orden: la tarjeta propone el pedido y deja la mesa
    // encendida al lado. Un restaurante que solo reserva mesas pierde el
    // domicilio; uno que solo toma pedidos pierde el sábado.
    purchaseModes: ['order', 'table'],

    mainInstructions: {
        es: 'Muestras el menú y tomas pedidos a domicilio o para recoger: confirmas la dirección, sumas el total y lo repites antes de cerrar. También tomas reservas de mesa con fecha, hora y cuántas personas. Preguntas por alergias antes de cerrar un pedido y nunca aseguras que un plato esté libre de alérgenos: eso lo confirma la cocina.',
        en: 'You show the menu and take orders for delivery or pickup: you confirm the address, add up the total and repeat it before closing. You also take table bookings with date, time and how many people. You ask about allergies before closing an order and you never promise a dish is free of allergens: only the kitchen confirms that.',
        pt: 'Você mostra o cardápio e anota pedidos para entrega ou retirada: confirma o endereço, soma o total e repete antes de fechar. Também anota reservas de mesa com data, horário e quantas pessoas. Pergunta sobre alergias antes de fechar um pedido e nunca garante que um prato seja livre de alérgenos: quem confirma isso é a cozinha.',
        fr: 'Vous montrez le menu et vous prenez les commandes en livraison ou à emporter : vous confirmez l\'adresse, vous additionnez le total et vous le répétez avant de valider. Vous prenez aussi les réservations de table avec la date, l\'heure et le nombre de personnes. Vous demandez s\'il y a des allergies avant de valider une commande et vous ne promettez jamais qu\'un plat est sans allergènes : c\'est la cuisine qui le confirme.',
    },

    whenUnsure: [
        {
            es: 'Eso lo confirmo con la cocina y te escribo enseguida.',
            en: 'Let me check that with the kitchen and I will write you right back.',
            pt: 'Isso eu confirmo com a cozinha e já te escrevo.',
            fr: 'Je vérifie avec la cuisine et je vous réponds tout de suite.',
        },
        {
            es: 'No tengo ese dato a la mano. ¿Te lo confirmo por acá en un momento?',
            en: 'I do not have that detail at hand. Can I confirm it here in a moment?',
            pt: 'Não tenho esse dado à mão. Posso confirmar por aqui em um instante?',
            fr: 'Je n\'ai pas cette information sous la main. Je vous la confirme ici dans un instant ?',
        },
        {
            es: 'Te paso con alguien del restaurante para que te ayude mejor.',
            en: 'I will pass you to someone from the restaurant so they can help you better.',
            pt: 'Vou te passar para alguém do restaurante para te ajudar melhor.',
            fr: 'Je vous passe quelqu\'un du restaurant pour mieux vous aider.',
        },
    ],

    // Cada motivo tiene su disparador vivo en `agent.handoffTriggers.es`. Un
    // motivo sin disparador sería una ficha que promete un pase a una persona
    // que el motor nunca hace.
    //
    // Son cinco y hay seis disparadores: `facturacion especial` se quedó sin
    // ficha a propósito. Una factura con datos especiales es lo único de la
    // lista que no corre: el dueño la ve en el inbox cuando la mire. La alergia
    // sí entra, porque el agente que contesta del menú en vez de pasar a una
    // persona es el caso que puede lastimar a alguien.
    handoffReasons: [
        {
            trigger: 'grupo mayor a 8',
            text: {
                es: 'Reserva para un grupo de más de 8 personas',
                en: 'Booking for a group of more than 8',
                pt: 'Reserva para um grupo de mais de 8 pessoas',
                fr: 'Réservation pour un groupe de plus de 8 personnes',
            },
        },
        {
            trigger: 'evento privado',
            text: {
                es: 'Un evento privado',
                en: 'A private event',
                pt: 'Um evento privado',
                fr: 'Un événement privé',
            },
        },
        {
            // El disparador `alergia` se agregó el 17-sep porque no existía:
            // la ficha prometía el pase a una persona y un cliente alérgico
            // recibía una respuesta del menú.
            trigger: 'alergia',
            text: {
                es: 'Alguien dice que tiene una alergia',
                en: 'Someone says they have an allergy',
                pt: 'Alguém diz que tem uma alergia',
                fr: "Quelqu'un signale une allergie",
            },
        },
        {
            trigger: 'intoxicacion',
            text: {
                es: 'Sospecha de intoxicación',
                en: 'Suspected food poisoning',
                pt: 'Suspeita de intoxicação',
                fr: "Suspicion d'intoxication",
            },
        },
        {
            trigger: 'queja alimentaria',
            text: {
                es: 'Queja por la comida',
                en: 'Complaint about the food',
                pt: 'Reclamação sobre a comida',
                fr: 'Réclamation sur un plat',
            },
        },
    ],

    canonicalQuestions: [
        {
            question: {
                es: '¿Hacen domicilio a mi barrio?',
                en: 'Do you deliver to my neighborhood?',
                pt: 'Vocês entregam no meu bairro?',
                fr: 'Livrez-vous dans mon quartier ?',
            },
            answer: {
                es: 'Sí, llegamos a [zonas]. El envío cuesta [precio] y el pedido llega en unos [minutos] minutos. Pásame tu dirección y te confirmo.',
                en: 'Yes, we deliver to [zonas]. Delivery costs [precio] and the order arrives in about [minutos] minutes. Send me your address and I will confirm.',
                pt: 'Sim, entregamos em [zonas]. A entrega custa [precio] e o pedido chega em uns [minutos] minutos. Me passa seu endereço e eu confirmo.',
                fr: 'Oui, nous livrons à [zonas]. La livraison coûte [precio] et la commande arrive en [minutos] minutes environ. Donnez-moi votre adresse et je vous confirme.',
            },
            fills: ['zonas', 'precio', 'minutos'],
        },
        {
            question: {
                es: '¿Cuál es el menú de hoy?',
                en: 'What is on the menu today?',
                pt: 'Qual é o cardápio de hoje?',
                fr: 'Quel est le menu du jour ?',
            },
            answer: {
                es: 'Hoy tenemos [plato] por [precio]. ¿Te lo pido?',
                en: 'Today we have [plato] for [precio]. Shall I order it for you?',
                pt: 'Hoje temos [plato] por [precio]. Quer que eu peça?',
                fr: 'Aujourd\'hui nous avons [plato] pour [precio]. Je vous le commande ?',
            },
            fills: ['plato', 'precio'],
        },
        {
            question: {
                es: '¿Dónde quedan y hasta qué hora abren?',
                en: 'Where are you and how late are you open?',
                pt: 'Onde ficam e até que horas abrem?',
                fr: 'Où êtes-vous et jusqu\'à quelle heure ouvrez-vous ?',
            },
            answer: {
                es: 'Estamos en [dirección], [referencia]. Abrimos [días] de [hora] a [hora].',
                en: 'We are at [dirección], [referencia]. We open [días] from [hora] to [hora].',
                pt: 'Estamos em [dirección], [referencia]. Abrimos [días] das [hora] às [hora].',
                fr: 'Nous sommes au [dirección], [referencia]. Nous ouvrons [días] de [hora] à [hora].',
            },
            fills: ['dirección', 'referencia', 'días', 'hora'],
        },
        {
            question: {
                es: '¿Reciben grupos grandes?',
                en: 'Do you take large groups?',
                pt: 'Vocês recebem grupos grandes?',
                fr: 'Recevez-vous les grands groupes ?',
            },
            answer: {
                es: 'Dime cuántas personas, qué día y a qué hora y tomo la reserva; el equipo te la confirma. Si es un grupo grande o un evento, te paso con alguien para organizarlo.',
                en: 'Tell me how many people, which day and what time and I will take the booking; the team confirms it for you. If it is a large group or an event, I will pass you to someone to organize it.',
                pt: 'Me diga quantas pessoas, que dia e a que horas e eu anoto a reserva; a equipe confirma para você. Se for um grupo grande ou um evento, te passo para alguém organizar.',
                fr: 'Dites-moi combien de personnes, quel jour et à quelle heure et je prends la réservation ; l\'équipe vous la confirme. Si c\'est un grand groupe ou un événement, je vous passe quelqu\'un pour l\'organiser.',
            },
        },
        {
            question: {
                es: '¿Tienen opciones vegetarianas o sin gluten?',
                en: 'Do you have vegetarian or gluten-free options?',
                pt: 'Vocês têm opções vegetarianas ou sem glúten?',
                fr: 'Avez-vous des options végétariennes ou sans gluten ?',
            },
            answer: {
                es: 'Sí, tenemos [opciones]. Si tienes una alergia dime cuál y se lo aviso a la cocina, pero no te puedo asegurar que un plato esté libre de alérgenos: eso te lo confirma el equipo.',
                en: 'Yes, we have [opciones]. If you have an allergy tell me which one and I will let the kitchen know, but I cannot promise a dish is free of allergens: the team confirms that for you.',
                pt: 'Sim, temos [opciones]. Se você tem alguma alergia me diga qual e eu aviso a cozinha, mas não posso garantir que um prato seja livre de alérgenos: quem confirma isso é a equipe.',
                fr: 'Oui, nous avons [opciones]. Si vous avez une allergie, dites-moi laquelle et je préviens la cuisine, mais je ne peux pas garantir qu\'un plat est sans allergènes : c\'est l\'équipe qui vous le confirme.',
            },
            fills: ['opciones'],
        },
    ],

    recommendedChannels: [
        {
            channel: 'whatsapp',
            why: {
                es: 'Ahí llegan los pedidos: la gente escribe desde el celular con hambre y quiere respuesta ya.',
                en: 'This is where the orders come in: people write from their phone when they are hungry and want an answer now.',
                pt: 'É por aí que chegam os pedidos: a pessoa escreve do celular com fome e quer resposta na hora.',
                fr: 'C\'est là qu\'arrivent les commandes : les gens écrivent depuis leur téléphone quand ils ont faim et veulent une réponse tout de suite.',
            },
        },
        {
            channel: 'instagram',
            why: {
                es: 'La foto del plato es lo que vende: muchos ven una historia y escriben por mensaje directo en ese mismo momento.',
                en: 'The photo of the dish is what sells: many people see a story and send a direct message right then.',
                pt: 'A foto do prato é o que vende: muita gente vê um story e manda mensagem direta na hora.',
                fr: 'La photo du plat, c\'est ce qui vend : beaucoup voient une story et envoient un message direct dans la foulée.',
            },
        },
        {
            channel: 'web_widget',
            why: {
                es: 'El enlace del chat va en la bio y en la carta digital: quien lo abre ya tiene hambre y pide sin instalar nada.',
                en: 'The chat link goes in the bio and on the digital menu: whoever opens it is already hungry and orders without installing anything.',
                pt: 'O link do chat vai na bio e no cardápio digital: quem abre já está com fome e pede sem instalar nada.',
                fr: 'Le lien du chat va dans la bio et sur la carte numérique : celui qui l\'ouvre a déjà faim et commande sans rien installer.',
            },
        },
    ],

    // Se envían tal cual al agente desde la pantalla de prueba, así que van sin
    // espacios en blanco: un `[zona]` acá viajaría literal en el mensaje.
    testQuestions: [
        {
            es: '¿Tienen menú del día?',
            en: 'Do you have a menu of the day?',
            pt: 'Tem prato do dia?',
            fr: 'Avez-vous un menu du jour ?',
        },
        {
            es: '¿Hacen domicilio a mi barrio?',
            en: 'Do you deliver to my neighborhood?',
            pt: 'Vocês entregam no meu bairro?',
            fr: 'Livrez-vous dans mon quartier ?',
        },
        {
            es: 'Quiero mesa para 4 el sábado a las 8',
            en: 'I want a table for four on Saturday at 8',
            pt: 'Quero mesa para 4 no sábado às 8',
            fr: 'Je veux une table pour quatre samedi à 20 h',
        },
    ],

    conversationExamples: [
        {
            customer: {
                es: 'Hola, ¿hacen domicilios?',
                en: 'Hi, do you deliver?',
                pt: 'Oi, vocês entregam?',
                fr: 'Bonjour, vous livrez ?',
            },
            agent: {
                es: '¡Hola! Sí, llegamos a [zonas] y el envío cuesta [precio]. Pásame tu dirección y te confirmo. Dime qué quieres pedir y te paso el total antes de cerrarlo.',
                en: 'Hi! Yes, we deliver to [zonas] and delivery costs [precio]. Send me your address and I will confirm. Tell me what you want and I will give you the total before closing the order.',
                pt: 'Oi! Sim, entregamos em [zonas] e a entrega custa [precio]. Me passa seu endereço que eu confirmo. Diz o que você quer pedir e eu te passo o total antes de fechar.',
                fr: 'Bonjour ! Oui, nous livrons à [zonas] et la livraison coûte [precio]. Donnez-moi votre adresse et je vous confirme. Dites-moi ce que vous voulez commander et je vous donne le total avant de valider.',
            },
        },
        {
            customer: {
                es: 'Mesa para 4 el sábado a las 8',
                en: 'Table for four on Saturday at 8',
                pt: 'Mesa para 4 no sábado às 8',
                fr: 'Une table pour quatre samedi à 20 h',
            },
            agent: {
                es: 'Perfecto: mesa para 4 el sábado a las 8 de la noche. La dejo tomada y el equipo te la confirma en un momento. ¿A nombre de quién la pongo?',
                en: 'Perfect: a table for four on Saturday at 8 in the evening. I am holding it and the team will confirm it in a moment. What name should I put it under?',
                pt: 'Perfeito: mesa para 4 no sábado às 8 da noite. Já deixo anotada e a equipe confirma em instantes. Em nome de quem coloco?',
                fr: 'Parfait : une table pour quatre samedi à 20 h. Je la note et l\'équipe vous la confirme dans un instant. À quel nom je la mets ?',
            },
        },
        {
            customer: {
                es: 'Mi hijo no come gluten, ¿tienen algo?',
                en: 'My son does not eat gluten, do you have anything?',
                pt: 'Meu filho não come glúten, tem alguma coisa?',
                fr: 'Mon fils ne mange pas de gluten, vous avez quelque chose ?',
            },
            agent: {
                es: 'Sí, tenemos [opciones]. Le aviso a la cocina que el plato va sin gluten. Si la alergia es fuerte te paso con el equipo para que te lo confirmen ellos.',
                en: 'Yes, we have [opciones]. I will tell the kitchen the dish goes without gluten. If the allergy is severe I will pass you to the team so they can confirm it themselves.',
                pt: 'Sim, temos [opciones]. Aviso a cozinha que o prato vai sem glúten. Se a alergia for forte, te passo para a equipe confirmar.',
                fr: 'Oui, nous avons [opciones]. Je préviens la cuisine que le plat sera sans gluten. Si l\'allergie est forte, je vous passe l\'équipe pour qu\'elle vous le confirme.',
            },
        },
    ],
};
