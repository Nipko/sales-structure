/**
 * Deterministic operation cues for the required reads (restaurant pilot).
 *
 * Production QA 2026-10-24, restaurant tenant with `agentRuntime.requiredReads.restaurants` on: the menu read ran before the
 * model for «¿cuánto vale el plato Spark?», «quanto custa o prato Spark?», «combien coûte le plat Spark ?», but 0 of 3 times
 * for «how much is the Spark QA Plato?», «price of the Spark dish?», «what does the Spark dish cost?». The reads only run on a
 * classifier verdict for a pilot operation at or above the threshold, and the English price questions never reached one: they
 * fell to `ask_question` (the FAQ intent reads as "something the business already answered before", and the dish's price was in
 * the history) or to `menu_info` below the threshold. Only `search_faqs` ran; the model answered from history or said it had no confirmed price.
 *
 * A message that is unmistakably about the menu (a dish or menu word together with a price, an ingredient or diet, or a
 * "do you have"), in Spanish, Portuguese, French or English, is `menu_info` whatever the classifier said, unless the
 * classifier confidently named another business operation. The threshold itself does not move. The cue only gates a read
 * (get_menu is a public, side-effect-free read), never a write.
 *
 * The same day, with `requiredReads.properties` and `requiredReads.tours` on, the lodging and travel pilots had the same gap:
 *   - hotel «à quelle heure est l'enregistrement ?» and «what time is check-out?» ran only `search_faqs` and answered «I don't
 *     have the check-in/check-out time configured» (the property has 15:00 / 11:00, in `get_property_details`): the classifier
 *     maps a schedule question to the FAQ intent;
 *   - travel «combien de places restent pour le Spark QA Tour ?» ran only `search_packages` (no departure or details read) and
 *     said there is no specific number of seats (the departure has 10).
 * So a lodging question in the message's own words (check-in/check-out or arrival/departure time, address, capacity, rooms and
 * bathrooms, amenities, minimum stay, nightly price, availability) is `property_info` (list_properties → get_property_details),
 * and a tour question is `package_availability` (seats left, departures, dates: the departures and their seats) or
 * `package_info` (duration, what it includes or excludes, price), under the same rules.
 *
 * And with `requiredReads.listings` on (real-estate QA tenant), «quelle est la surface du Spark QA Inmueble ?» ran only
 * `search_faqs` and answered «Je n'ai pas la surface confirmée» (the listing has 80 m²), and «what properties are available?»
 * listed the listing from the history but said «The price is not confirmed in the catalog» (250.000 EUR): the classifier gave
 * the FAQ intent or a listing operation under the threshold. So a question about a listing's price, area, bedrooms or
 * bathrooms, sale or rent, address, or whether it is still available is `listing_info` (search_listings → get_listing_details
 * on the listing named or the only one), and «what properties do you have / are available?» is `find_listing`
 * (search_listings: the list, with each listing's price and area, is the answer). A visit, the customer's own appointment, a
 * complaint, a payment or the customer's own property is never a listing read.
 *
 * F4300-35 follow-up (production 2026-10-24, store QA tenant with `requiredReads.catalog` on): «tell me about the Audífono QA
 * Aurora» ran ONLY `search_faqs` (no product read), and the reply repeated the product's description as its state («a fictional
 * test product that does not correspond to real inventory») next to «2 units available»: with no catalogue row in the turn,
 * neither the description note nor the output check could apply. A request to be told about or described an item («tell me
 * about X», «háblame de X», «me fala sobre X», «parlez-moi de X», «describe X», «details of X») is the item read of every pilot
 * (`product_info`, `menu_info`, `property_info`, `package_info`, `listing_info`), unless it names a topic that is not a catalogue
 * item (the business itself, its hours, policies, payment, shipping, returns, privacy) or the customer's own records.
 */
import { normalizeForIntent } from '@parallext/shared';
import type { RequiredReadsPilot } from './required-reads.runner';

/** Words that name a menu item or the menu itself. */
const DISH = /\b(?:platos?|platillos?|pratos?|plats?|dish(?:es)?|plates?|meals?|food|foods|comidas?|bebidas?|boissons?|drinks?|postres?|sobremesas?|desserts?|menus?|cardapio|la carta|la carte)\b/;
/** The menu itself: asking for it is a menu question on its own («what's on the menu?», «¿me pasas la carta?»). */
const MENU = /\b(?:menus?|cardapio|la carta|la carte)\b/;
/** Price, cost or preparation-time words («how long does the X dish take?», «¿cuánto tarda el plato?»). */
const PRICE = /\b(?:cuanto|cuanta|cuantos|cuantas|precios?|valor|cuesta|cuestan|cobran|quanto|quanta|precos?|custa|custam|combien|prix|coute|coutent|tarifs?|how much|prices?|priced|pricing|cost|costs|how long|takes?|tarda\w*|demora\w*|prep\w*)\b/;
/** Ingredients, allergens and diets: details of a dish. */
const ATTRIBUTE = /\b(?:ingredientes?|ingredients?|alergen\w*|allergen\w*|allergi\w*|alergi\w*|vegetarian\w*|vegetarien\w*|vegan\w*|gluten|lactosa|lactose|picantes?|spicy|epice\w*|apimentad\w*)\b/;
/** "Do you have …?" forms. */
const HAVE = /\b(?:tienen|tiene|hay|ofrecen|manejan|sirven|tem|tens|temos|voces tem|avez vous|vous avez|y a t il|servez|do you have|do you serve|have you got|is there|are there|any)\b/;
/**
 * The customer's own order, booking or complaint: never the menu, whatever dish word it carries («the status of my order»,
 * «mi pedido del plato Spark», «I want a refund for the dish»). Those belong to the classifier and to their own reads.
 */
const NOT_MENU = /\b(?:(?:mi|mis|meu|meus|minha|minhas|ma|mes|mon|my|our|nuestro|nuestros) (?:pedidos?|ordens?|orders?|commandes?|encomendas?|reservas?|reservations?|bookings?)|status|estado|statut|rastre\w*|track\w*|reembols\w*|refund\w*|rembours\w*|devoluc\w*|devolu\w*|quej\w*|reclam\w*|complain\w*|plaint\w*)\b/;

const folded = (text: unknown): string => normalizeForIntent(text)
    .replace(/[’']/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * «Tell me about / describe X»: the customer asks to be told what an item is (F4300-35 follow-up). es/pt/fr/en, folded text
 * (accents gone, apostrophes and hyphens are spaces: «parlez-moi de l'Audífono» is «parlez moi de l audifono»).
 */
const TELL_ABOUT = new RegExp(`\\b(?:${[
    // es
    /\b(?:hablame|hableme|hablanos|cuentame|cuenteme|cuentanos|dime|digame|informame|informeme) (?:mas )?(?:de|del|sobre|acerca)\b/,
    /\b(?:describe\w*|describa\w*|descripcion)\b/,
    /\b(?:detalles?|informacion|info|caracteristicas|especificaciones) (?:de|del|sobre|acerca)\b/,
    /\b(?:que me puedes|que me puede|que puedes|que puede) (?:decir|contar) (?:de|del|sobre|acerca)\b/,
    // pt
    /\b(?:me )?(?:fala|fale|conta|conte|diga|diz|explica|explique)(?: me)? (?:mais )?(?:sobre|do|da|de)\b/,
    /\b(?:descreva|descreve|descricao|detalhes (?:do|da|de|sobre)|informac\w* (?:sobre|do|da))\b/,
    // fr
    /\b(?:parlez|parle|dites|dis|racontez|raconte) (?:moi|nous) (?:en plus |plus )?(?:de|du|des|d|sur)\b/,
    /\b(?:decri\w*|details (?:du|de|des|sur)|informations? (?:sur|du|de la|des))\b/,
    // en
    /\b(?:tell|show) (?:me|us) (?:more )?about\b/,
    /\b(?:what can you tell me about|more about|details (?:of|on|about|for)|information (?:about|on)|info (?:about|on)|specs (?:of|for))\b/,
].map(re => re.source).join('|')})\\b`);
/**
 * What a «tell me about» names that is not a catalogue item: the business itself, its hours, policies, payment, shipping,
 * returns, privacy, or the customer's own records. Those belong to the classifier and their own reads.
 */
const NOT_ITEM_TOPIC = /\b(?:(?:about|sobre|de|acerca de|sur) (?:you|yourself|yourselves|ustedes|usted|vosotros|ti|vous|toi|voces|voce|vos)|yourselves|empresa|company|compania|companhia|entreprise|negocio|business|marca|brand|equipo|team|equipe|historia|history|histoire|horarios?|hours|heures|horaires?|opening|abren|cierran|abrem|fecham|politicas?|policy|policies|politique\w*|terminos|terms|termos|conditions|condiciones|condicoes|privacidad|privacy|privacidade|confidentialite|datos personales|personal data|pagos?|payments?|pagamentos?|paiements?|metodos de pago|envios?|shipping|delivery|domicilios?|entregas?|livraison\w*|devoluc\w*|devolu\w*|returns?|reembols\w*|refunds?|rembours\w*|garantias? de la tienda|faq|faqs|preguntas frecuentes|perguntas frequentes|ubicacion|location|address|direccion|endereco|adresse|contacto|contact|contato|telefono|phone|whatsapp|email|correo|redes sociales|social media|(?:mi|mis|meu|meus|minha|minhas|ma|mes|mon|my|our|nuestro|nuestros|nuestra|nuestras) (?:pedidos?|ordens?|orders?|commandes?|encomendas?|reservas?|reservations?|bookings?|cuenta|account|conta|compte|citas?|appointments?|compras?|purchases?))\b/;

/** The message asks to be told about or described an item, not about the business or the customer's own records. Pure. */
export function isTellAboutItem(text: unknown): boolean {
    const t = folded(text);
    return !!t && t.length <= 400 && TELL_ABOUT.test(t) && !NOT_ITEM_TOPIC.test(t);
}

/**
 * F4300-08 (production 25-oct, store QA tenant with `requiredReads.catalog` on, 3 of 3): «de qué color es el Audífono QA
 * Aurora?», «de quelle couleur est l'Audífono QA Aurora ?», «qual a cor do Audífono QA Aurora?» ran only `search_faqs` and were
 * answered «no tengo información específica sobre el color» (the product's record says it is blue). Price, stock and «tell me
 * about» questions did read the product; a question about one of an item's attributes named no cue, and the turn's <catalog>
 * (name, price, stock, category only) marked the product reads `projected` even when the classifier named `product_info`.
 *
 * An item's attribute: colour, size, material, weight, dimensions, connectivity, brand, model, warranty, compatibility. es/pt/fr/en, folded
 * text. «peso(s)» alone is the currency («cuánto cuesta en pesos?»): only the weight verbs and «el peso» count.
 */
const COLOUR_NAMES = 'azul|azuis|rojo|roja|negro|negra|blanco|blanca|verde|gris|rosa|amarillo|vermelho|preto|branco|cinza|amarelo|bleue?s?|rouges?|noire?s?|blanche?s?|verte?s?|grise?s?|jaune|blue|red|black|white|green|grey|gray|pink|yellow';
const ITEM_ATTRIBUTE = new RegExp(`\\b(?:${[
    // colour
    /colou?rs?|colores|couleurs?|cor|cores/,
    // a colour named (production QA 27-oct: «¿el Audífono QA Aurora es azul?», «est-il bleu ?» read nothing)
    // («is the Audífono QA Aurora blue?»: the colour ends the question)
    new RegExp(`(?:(?:es|son|e|sao|est(?: il| elle)?|sont(?: ils| elles)?|is|are|viene en|vem em|in) (?:de color |de cor |en |em )?(?:${COLOUR_NAMES})|(?:${COLOUR_NAMES})$)`),
    // size
    /tallas?|tamanos?|tamanhos?|tailles?|sizes?|sizing|pointures?/,
    // material
    /materia(?:l|les|is)|materiaux|materiau|fabric|tela|tecido|tissu|hech[oa]s? de|feit[oa]s? de|fait en|made of|made from/,
    // weight («peso» alone is also the currency)
    /(?:el|o|su|seu|the|its) peso|pesa|pesan|pesam|combien pese\w*|poids|weighs?|weight|how heavy/,
    // dimensions
    /medidas?|dimension(?:es|s)?|dimensoes|dimensao|how big/,
    // connectivity (production QA 27-oct: «¿el Audífono QA Aurora es de cable?», «est-il filaire ?» read nothing)
    /(?:de|con|com|with) cables?|com fio|cabo|filaires?|wired|wireless|inalambric[oa]s?|sem fio|sans fil|bluetooth/,
    // brand, model
    /marcas?|marques?|brands?|fabricante|fabricant|manufacturer|modelos?|models?|modeles?/,
    // warranty
    /garantias?|garanties?|warrant(?:y|ies)|guarantee/,
    // compatibility
    /compatib\w*|funciona con|funciona com|fonctionne avec|works with/,
].map(re => re.source).join('|')})\\b`);
/** The store's own warranty or brand as a policy, not an item's: «la garantía de la tienda», «your warranty policy». */
const NOT_ITEM_ATTRIBUTE = /\b(?:(?:de la|da|de|of the|du|de votre|de su|de sua|your|vuestra|votre|sua|su) (?:tienda|loja|magasin|boutique|store|shop|empresa|company|entreprise|negocio|business)|(?:politica|policy|politique|terminos|terms|termos|conditions|condiciones|condicoes) (?:de|of|da|du|des)? ?(?:garantia|warranty|garantie|devoluc\w*|returns?)|(?:warranty|garantia|garantie) (?:policy|politica|politique)|(?:your|vuestra|su|sua|votre) (?:marca|brand|marque))\b/;

/**
 * The message asks about one of an item's attributes (colour, size, material, weight, dimensions, brand, model, warranty,
 * compatibility), not the store's own policy, an order or a payment. Pure.
 */
export function isItemAttributeQuestion(text: unknown): boolean {
    const t = folded(text);
    if (!t || t.length > 400 || NOT_CATALOGUE.test(t) || NOT_MENU.test(t) || NOT_ITEM_ATTRIBUTE.test(t)) return false;
    return ITEM_ATTRIBUTE.test(t);
}

/**
 * The turn's <catalog> (name, price, stock, category) does not answer the message: it asks to be told about an item (#219) or
 * about one of its attributes (F4300-08). The product reads then run instead of being declared `projected`. Pure.
 */
export function needsItemDetailRead(text: unknown): boolean {
    return isTellAboutItem(text) || isItemAttributeQuestion(text);
}

/**
 * The message asks about the menu or one of its items: what is on the menu, or the price, ingredients, allergens, diet or
 * preparation time of a dish or drink. Spanish, Portuguese, French and English. Pure.
 */
export function isMenuQuestion(text: unknown): boolean {
    const t = folded(text);
    if (!t || t.length > 400 || NOT_MENU.test(t)) return false;
    if (MENU.test(t)) return true;
    if (isTellAboutItem(text)) return true;
    // F4300-08: «de qué tamaño es el plato Spark?» names a dish and one of its attributes.
    return DISH.test(t) && (PRICE.test(t) || ATTRIBUTE.test(t) || HAVE.test(t) || isItemAttributeQuestion(text));
}

// ── Lodging (hotel / vacation rental) ───────────────────────────────────────────────────────────────────────────────────

/** Check-in / check-out: a stay's schedule on its own («what time is check-out?», «à quelle heure est l'enregistrement ?»). */
const STAY_CHECK = /\b(?:check ?ins?|check ?outs?|enregistrement|horario de entrada|horario de salida)\b/;
/** Arriving or leaving the property: a schedule question together with a time word («a que horas é a chegada?»). */
const STAY_MOVE = /\b(?:llegada|llegar|entrada|entrar|salida|salir|entregar|chegada|chegar|saida|sair|arrivee|arriver|depart|partir|quitter|liberer|arrival|arrive|departure|leave|vacate)\b/;
const TIME = /\b(?:hora|horas|horario|heure|heures|horaire|time|times|when|cuando|quando|quand)\b/;
/** Where the property is («¿en qué calle está…?», «dans quelle rue…», «em que rua…», «what street…», production QA 27-oct). */
const ADDRESS = /\b(?:(?:en )?(?:que|cual) calle|dans quelle rue|(?:em )?que rua|what street|which street|direccion|ubicacion|ubicad[oa]s?|donde (?:queda|quedan|esta|estan|se encuentra\w*)|endereco|localizacao|localizad[oa]s?|onde (?:fica|fika|ficam|esta|estao)|adresse|ou (?:se trouve|se situe|etes vous|est situe\w*)|situe\w*|address|location|located|where is|where are)\b/;
/** How many people fit. */
const CAPACITY = /\b(?:capacidad|capacidade|capacite|capacity|sleeps|caben|cabem)\b/;
const PEOPLE = /\b(?:huespedes|hospedes|guests|personas|pessoas|personnes|people|persons|adultos|adults|adultes)\b/;
const HOW_MANY = /\b(?:cuant\w*|quant\w*|combien|how many|max\w*|hasta|up to|jusqu\w*)\b/;
/** Rooms, beds and bathrooms. */
const ROOMS = /\b(?:habitacion\w*|cuartos?|recamaras?|dormitorios?|banos?|quartos?|banheiros?|chambres?|salles? de bains?|salles? d eau|bedrooms?|bathrooms?|beds?|camas?|lits?|rooms?|suites?)\b/;
/** Amenities and house services. */
const AMENITY = /\b(?:amenities|amenidades|comodidades|servicios|servicos|equipements?|wifi|wi fi|internet|piscina|piscine|pool|parqueadero|parqueo|estacionamiento|estacionamento|parking|garagem|desayuno|breakfast|petit dejeuner|cafe da manha|aire acondicionado|ar condicionado|air conditioning|climatisation|cocina|cozinha|kitchen|cuisine|jacuzzi|spa|gym|gimnasio|mascotas|pets?|animais|animaux|pet friendly|toallas|toalhas|towels|serviettes|lavadora|lavanderia|laundry)\b/;
/** Minimum stay. */
const MINIMUM = /\bminim\w*\b/;
const NIGHTS = /\b(?:noches?|noites?|nuits?|nights?|estadias?|estancias?|stays?|sejours?)\b/;
/** What is rented: a night, a stay, a room, the property. */
const LODGING = /\b(?:noches?|noites?|nuits?|nights?|nightly|diarias?|estadias?|estancias?|stays?|sejours?|habitacion\w*|cuartos?|quartos?|chambres?|rooms?|suites?|cabanas?|cabins?|apartamentos?|apartments?|appartements?|alojamientos?|hospedagem|logements?|hotel|propiedad\w*|property|properties|propriete\w*)\b/;
const AVAILABLE = /\b(?:disponib\w*|available|availability|vacancy|vacancies)\b/;
/** Price words of a stay or a tour (no preparation time: that is the menu's). */
const PRICE_WORDS = /\b(?:cuanto|cuanta|precios?|valor|cuesta|cuestan|cobran|tarifas?|quanto|precos?|custa|custam|combien|prix|coute|coutent|tarifs?|how much|prices?|pricing|cost|costs|rates?)\b/;
/** A question form, for words that are also small talk («the room is nice»). */
const QUESTION = /\b(?:cuant\w*|quant\w*|combien|how many|how much|tiene\w*|tienen|hay|tem|avez|vous avez|y a t il|il y a|have|has|is there|are there|que|qual|quais|what|which|quel\w*|incluye\w*|inclui\w*|include\w*|permit\w*|allow\w*|accept\w*|acept\w*)\b/;
/**
 * A write or a complaint about the customer's own stay or trip: never a catalogue read, whatever words it carries («cancel my
 * booking», «I want a refund», «can I pay on arrival?»). Those belong to the classifier and their own flows.
 */
const NOT_CATALOGUE = /\b(?:cancel\w*|anul\w*|annul\w*|reembols\w*|refund\w*|rembours\w*|devoluc\w*|devolu\w*|quej\w*|reclam\w*|complain\w*|plainte\w*|modific\w*|cambiar|changer|alterar|pagar|pago|pay|paid|payment|paiement|payer|pagamento|link)\b/;
/** The customer's own reservation: the guest's booking reads (identity step-up), not the public catalogue. */
const MY_BOOKING = /\b(?:mi|mis|meu|meus|minha|minhas|ma|mes|mon|my|our|nuestra|nuestras|nuestro) (?:reservas?|reservations?|reservaciones?|bookings?)\b/;

const asked = (raw: unknown, t: string) => (typeof raw === 'string' && raw.includes('?')) || QUESTION.test(t);

/**
 * The message asks about a lodging's offer: check-in/check-out or arrival/departure time, address, capacity, rooms and
 * bathrooms, amenities, minimum stay, nightly price or availability. Spanish, Portuguese, French and English. Pure.
 */
export function isLodgingQuestion(text: unknown): boolean {
    const t = folded(text);
    if (!t || t.length > 400 || NOT_CATALOGUE.test(t)) return false;
    if (STAY_CHECK.test(t) || (STAY_MOVE.test(t) && TIME.test(t))) return true;
    if (MY_BOOKING.test(t)) return false;
    if (ADDRESS.test(t) || CAPACITY.test(t) || (PEOPLE.test(t) && HOW_MANY.test(t))) return true;
    if (MINIMUM.test(t) && NIGHTS.test(t)) return true;
    if (LODGING.test(t) && PRICE_WORDS.test(t)) return true;
    if (AVAILABLE.test(t) && (LODGING.test(t) || /\d/.test(t))) return true;
    if (isTellAboutItem(text)) return true;
    // F4300-08: «what size is the room?», «de qué tamaño es la cabaña?»: an attribute of what is rented.
    if (LODGING.test(t) && isItemAttributeQuestion(text)) return true;
    return asked(text, t) && (ROOMS.test(t) || AMENITY.test(t));
}

// ── Travel agency / tours ───────────────────────────────────────────────────────────────────────────────────────────────

/** What a travel agency sells. */
const TOUR = /\b(?:tours?|paquetes?|pacotes?|forfaits?|excursion\w*|excursao|excursoes|planes|viajes?|viagens?|voyages?|trips?|experiencias?|experiences?|packages?|passeios?|circuitos?|circuits?|actividad\w*|activites?|activities|activity)\b/;
/** Seats on a departure… */
const SEATS = /\b(?:cupos?|lugares|plazas?|asientos?|places?|vagas?|seats?|spots?|spaces?|assentos?)\b/;
/** …that are left. */
const LEFT = /\b(?:quedan|queda|restan|resta|disponibles?|libres?|hay|left|remaining|available|restent|reste|restantes?|restam|sobram|sobra|disponiveis|livres?|how many|cuant\w*|quant\w*|combien|still)\b/;
/** Departures and their dates, on their own. */
const DEPARTURES = /\b(?:salidas|proxim\w* salida|siguiente salida|saidas|proxim\w* saida|departs|prochain\w* depart|next departure|departures?|fechas|datas|dates|proxim\w* fecha|proxim\w* data|prochain\w* date|next date)\b/;
/** When it leaves, or whether it is available: about a tour. */
// At what time it leaves (production QA 26-oct): «à quelle heure part le Spark QA Tour du 15 décembre ?» ran only search_faqs
// (2 of 2) and was answered «je n'ai pas l'heure exacte… confirmée»; the departure is at 09:00.
const WHEN_OR_AVAILABLE = /\b(?:cuando sale\w*|quando sai\w*|quand part\w*|when does|when do|when is|horarios?|schedule|disponib\w*|available|availability|(?:a )?que hora\w*|que horas|(?:a )?quelle heure|what time|heure de depart|hora de salida|horario de saida)\b/;
/** How long it lasts. */
const DURATION = /\b(?:cuanto dura\w*|duracion|dura|duran|duracao|quanto tempo|combien de temps|duree|dure|durent|how long|duration|lasts|cuant[oa]s (?:dias|horas|noches)|quant[oa]s (?:dias|horas|noites)|combien de (?:jours|heures|nuits)|how many (?:days|hours|nights))\b/;
/**
 * The languages it is guided in (F4300-32, production 2026-10-24): «en qué idiomas es el Spark QA Tour?» ran only search_faqs and
 * search_packages and was answered «no tengo esa información» (the package has languages ['es']); «em que idiomas é o Tour QA
 * Aurora?» (languages []) was answered «espanhol». Only next to a tour word or a guide: «¿en qué idiomas atienden?» is not a tour.
 */
const LANGUAGE = /\b(?:idiomas?|idiomes?|lenguas?|linguas?|languages?|langues?|langue|bilingu\w*|in english|en ingles|em ingles|en anglais|in spanish|en espanol|em espanhol|en espagnol|in french|en frances|em frances|en francais|in portuguese|en portugues|em portugues|en portugais)\b/;
const GUIDE = /\b(?:guias?|guides?|guided|guiad[oa]s?|guidee?s?)\b/;
/** What it includes or excludes, and what to bring. */
const INCLUDES = /\b(?:incluye\w*|incluid\w*|inclui\w*|inclus\w*|incluso|include\w*|exclu\w*|comprend\w*|que trae|what to bring|que llevar|o que levar|apporter)\b/;
/**
 * Where it goes and where it leaves from. F4300-08 (production QA 26-oct, image 6f1d3bf6): «¿a qué destino va el Tour QA Aurora?»
 * in the four languages ran only search_faqs and was answered «no tengo información confirmada sobre el destino» — the package
 * says «Destino QA Aurora».
 */
const PLACE = /\b(?:destinos?|destinations?|a donde va|adonde va|para onde vai|aonde vai|ou va|where does|where do|desde donde sale\w*|de donde sale\w*|de onde sai\w*|d ou part\w*|punto de (?:salida|encuentro)|ponto de (?:saida|encontro)|point de (?:depart|rendez vous)|meeting point|departure point|pick ?up point)\b/;

/**
 * The tour operation the message's words name: `package_availability` for seats left, departures and dates, `package_info` for
 * duration, inclusions and price; null when it is neither. Spanish, Portuguese, French and English. Pure.
 */
export function tourQuestionOperation(text: unknown): 'package_availability' | 'package_info' | null {
    const t = folded(text);
    if (!t || t.length > 400 || NOT_CATALOGUE.test(t) || MY_BOOKING.test(t)) return null;
    if ((SEATS.test(t) && LEFT.test(t)) || DEPARTURES.test(t) || (TOUR.test(t) && WHEN_OR_AVAILABLE.test(t))) return 'package_availability';
    if (DURATION.test(t) || INCLUDES.test(t) || (TOUR.test(t) && PRICE_WORDS.test(t))) return 'package_info';
    if (LANGUAGE.test(t) && (TOUR.test(t) || GUIDE.test(t))) return 'package_info';
    if (TOUR.test(t) && PLACE.test(t)) return 'package_info';
    if (isTellAboutItem(text)) return 'package_info';
    return null;
}

// ── Real estate (listings for sale or rent) ─────────────────────────────────────────────────────────────────────────────

/** What a real-estate agency lists. */
const LISTING = /\b(?:inmuebles?|propiedad\w*|apartamentos?|aptos?|apartaestudios?|departamentos?|casas?|lotes?|terrenos?|locales?|oficinas?|bodegas?|fincas?|imovel|imoveis|propriedades?|biens?|proprietes?|appartements?|maisons?|terrains?|logements?|properties|property|listings?|apartments?|flats?|houses?|homes?|condos?|units?|plots?)\b/;
/** The same, as an offer: «what properties do you have?», «¿qué inmuebles tienen?», «quels biens avez-vous ?». */
const LISTINGS = /\b(?:inmuebles|propiedades|apartamentos|casas|lotes|oficinas|imoveis|propriedades|biens|proprietes|appartements|maisons|properties|listings|apartments|flats|houses|homes|units|options|opciones|opcoes)\b/;
/** Area: «la surface», «cuántos metros», «80 m²», «how big». */
const AREA = /\b(?:areas?|superficie|surface|metros?|metraje|mts|metres?|meters?|square (?:meters|metres|feet)|sqm|sq ft|tamano|tamanho|taille|size|how big|que tan grande|quao grande)\b|\bm(?:2\b|²)/;
/** Bedrooms, bathrooms and the rest of a listing's layout. */
const LAYOUT = /\b(?:habitacion\w*|alcobas?|cuartos?|recamaras?|dormitorios?|banos?|quartos?|banheiros?|suites?|chambres?|pieces|salles? de bains?|salles? d eau|bedrooms?|bathrooms?|rooms?|baths?|parqueaderos?|garajes?|garagem|garages?|parking|estacionamientos?|estrato|pisos?|andar|etage|floors?)\b/;
/** Sale or rent: «¿es para venta o arriendo?», «is it for rent?», «c'est à louer ?». */
const SALE_OR_RENT = /\b(?:venta|vende\w*|arriendo|arrienda\w*|alquiler|alquila\w*|renta|rentar|venda|vende|aluguel|aluga\w*|alugar|louer|loue|vendre|vente|sale|rent|rental|lease|buy|comprar|acheter)\b/;
/**
 * Where the listing is (the business's own address is a FAQ: only with a listing word). «¿en qué calle está el Spark QA
 * Inmueble?», «dans quelle rue…», «em que rua…» read nothing and got «no tengo la dirección» (production QA 27-oct).
 */
const LISTING_PLACE = /\b(?:calle|rue|rua|street|direccion|ubicacion|ubicad[oa]s?|donde (?:queda|quedan|esta|estan)|barrio|sector|zona|endereco|localizacao|localizad[oa]s?|onde (?:fica|fika|ficam|esta|estao)|bairro|adresse|ou (?:se trouve|se situe|est)|situe\w*|quartier|address|location|located|where is|where are|neighbou?rhood|area)\b/;
const STILL_AVAILABLE = /\b(?:disponib\w*|available|availability|todavia|aun|ainda|toujours|still)\b/;
/** «what properties do you have?», «¿qué inmuebles tienen?», «quais imóveis vocês têm?», «quels biens avez-vous ?». */
const OFFER = /\b(?:que|cuales|qual|quais|quel\w*|what|which|tienen|tiene|hay|manejan|ofrecen|tem|tens|tem disponivel|avez vous|vous avez|y a t il|proposez|do you have|have you got|is there|are there|any|show me|muestrame|mostrar|mostre|montrez)\b/;
/**
 * Never a listing read: a visit or appointment (scheduling it, the customer's own one), a complaint, a payment, the agency's
 * commission, or the customer's own property («quiero vender mi casa»). Those belong to the classifier and their own flows.
 */
const NOT_LISTING = /\b(?:visitas?|visitar|visite\w*|visit\w*|viewing|agend\w*|cita|citas|appointments?|rendez vous|rdv|reunion|meeting|schedul\w*|reprogram\w*|reagend\w*|remarc\w*|conocer|conhecer|tour the|comision\w*|commission\w*|honorarios|honoraires|(?:mi|mis|meu|meus|minha|minhas|ma|mes|mon|my|our|nuestra|nuestro) (?:casa|apartamento|apto|inmueble|propiedad|imovel|maison|appartement|bien|house|home|apartment|flat|property|lote|terreno|local|oficina)|(?:su|sus|vuestra|vuestras|sua|suas|seu|seus|votre|vos|your) (?:oficinas?|offices?|bureaux?|escritorios?|agencia|agence|agency|inmobiliaria|imobiliaria|negocio|business))\b/;

/**
 * The listings operation the message's words name: `listing_info` for a listing's price, area, bedrooms or bathrooms, sale or
 * rent, address or availability; `find_listing` for «what properties do you have / are available?»; null when it is neither.
 * Spanish, Portuguese, French and English. Pure.
 */
export function listingQuestionOperation(text: unknown): 'listing_info' | 'find_listing' | null {
    const t = folded(text);
    if (!t || t.length > 400 || NOT_CATALOGUE.test(t) || NOT_LISTING.test(t)) return null;
    const listing = LISTING.test(t);
    const question = asked(text, t);
    if (PRICE_WORDS.test(t) || AREA.test(t)) return 'listing_info';
    if (question && LAYOUT.test(t)) return 'listing_info';
    if (listing && LISTING_PLACE.test(t)) return 'listing_info';
    // An open offer question first: «what properties are available?» is the list, «is the apartment still available?» one listing.
    if (LISTINGS.test(t) && OFFER.test(t)) return 'find_listing';
    if (question && SALE_OR_RENT.test(t)) return 'listing_info';
    if (listing && STILL_AVAILABLE.test(t)) return 'listing_info';
    if (isTellAboutItem(text)) return 'listing_info';
    // F4300-08: «de qué material es la casa?», «medidas del apartamento»: an attribute of a listing.
    if (listing && isItemAttributeQuestion(text)) return 'listing_info';
    return null;
}

// ── Store (product catalogue) ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * The message asks to be told about or described a product of the store (F4300-35 follow-up: «tell me about the Audífono QA
 * Aurora» ran only search_faqs), or about one of its attributes (F4300-08: «de qué color es…»). Never the customer's own order, a payment, a return or a complaint. Pure.
 */
export function isProductQuestion(text: unknown): boolean {
    const t = folded(text);
    if (!t || t.length > 400 || NOT_CATALOGUE.test(t) || NOT_MENU.test(t)) return false;
    // F4300-08: «de qué color es el Audífono QA Aurora?» asks about one of the product's attributes.
    return isTellAboutItem(text) || isItemAttributeQuestion(text);
}

// ── The customer's own past orders («what did I buy last time?») ───────────────────────────────────────────────────────

/**
 * F4300-11 (production QA 2026-10-22 and 25-oct): «¿cuáles son mis pedidos?», «what did I buy last time?» (store) and «qué pedí
 * la última vez?» (restaurant) are questions about the customer's own orders. The store's answer was replaced by the
 * outcome-claim template twice in a row; the restaurant read only list_my_orders, which carries no items, and answered «No tengo
 * detalles específicos de los ítems que pidió» about an order whose dish was one detail read away.
 *
 * Folded text (accents gone, apostrophes are spaces: «qu'est-ce que j'ai acheté» is «qu est ce que j ai achete»).
 */
const PAST_ORDERS = new RegExp(`(?:${[
    // es: «qué pedí / compré», «lo que compré», «mis pedidos», «mi último pedido», «mi última compra», «mis compras»
    /\b(?:que|cual|cuales|lo que) (?:fue lo que )?(?:yo )?(?:le )?(?:pedi|compre|ordene|encargue|pedimos|compramos)\b/,
    /\b(?:mis|mi) (?:ultim[oa]s? |anterior(?:es)? |previ[oa]s? )?(?:pedidos|compras|ordenes)\b/,
    /\bmi (?:ultim[oa]|anterior|previ[oa]) (?:pedido|compra|orden)\b|\bmi (?:pedido|compra|orden) (?:anterior|pasad[oa])\b/,
    // en: «what did I buy / order», «what I purchased», «my last order», «my orders», «my purchase history»
    /\bwhat (?:did|have) (?:i|we) (?:order|buy|purchase|get)\w*\b|\bwhat (?:i|we) (?:ordered|bought|purchased)\b/,
    /\bmy (?:last|latest|previous|recent|most recent|past) (?:orders?|purchases?)\b|\bmy (?:orders|purchases|order history|purchase history)\b/,
    // pt: «o que eu pedi / comprei», «meus pedidos», «meu último pedido», «minha última compra»
    /\b(?:o que|que) (?:eu )?(?:pedi|comprei|encomendei|pedimos|compramos)\b/,
    /\b(?:meus pedidos|minhas compras|minhas encomendas|meu ultimo pedido|minha ultima compra|minha ultima encomenda|meu pedido anterior|minha compra anterior)\b/,
    // fr: «qu'est-ce que j'ai acheté / commandé», «ce que j'ai acheté», «mes commandes», «ma dernière commande», «mon dernier achat»
    /\b(?:qu est ce que|ce que|qu) j ai (?:commande|achete|pris)\b|\bj ai (?:commande|achete) quoi\b/,
    /\b(?:mes commandes|mes achats|ma derniere commande|mon dernier achat|ma commande precedente|mon achat precedent)\b/,
    // F4300-45 (production QA 26-oct, image 6f1d3bf6): «¿cuándo hice mi primer pedido en la tienda?» read no order and was answered
    // «viernes 2 de octubre», the product's creation date (the oldest order is of 8-oct). The first order is one of the customer's own.
    /\bmi (?:primer|primera) (?:pedido|compra|orden)\b|\bmy (?:first|earliest|oldest) (?:store |shop |restaurant )?(?:orders?|purchases?)\b/,
    /\b(?:meu primeiro pedido|minha primeira compra|minha primeira encomenda|ma premiere commande|mon premier achat)\b/,
].map(re => re.source).join('|')})`);
/**
 * How many orders (production QA 26-oct, catalog pilot): «combien de commandes ai-je chez vous ?», «j'ai passé combien de
 * commandes dans la boutique ?» ran only search_faqs (2 of 2) and the count was not said; «cuántas compras tengo» did read. The
 * list answers it: no order's detail is needed, so this is not a past-orders question (which also reads the newest order).
 */
const ORDER_COUNT = /\b(?:cuant[oa]s (?:pedidos|compras|ordenes)|quant[oa]s (?:pedidos|compras|encomendas)|how many (?:orders|purchases)|combien (?:de commandes|d achats))\b/;
/**
 * A write about those orders, or a new order: never only a question about the past («cancel my last order», «I want to pay my
 * order», «repeat what I ordered», «quiero pedir lo mismo otra vez»).
 */
const PAST_ORDERS_ACTION = /\b(?:cancel\w*|anul\w*|annul\w*|reembols\w*|refund\w*|rembours\w*|devol\w*|devolu\w*|repet\w*|repeat\w*|repit\w*|again|otra vez|de nuevo|de novo|outra vez|encore|modific\w*|cambiar|change\w*|alterar|quiero (?:pedir|comprar|ordenar)|want to (?:order|buy)|quero (?:pedir|comprar)|je veux (?:commander|acheter)|quej\w*|reclam\w*|complain\w*|plainte\w*|(?:quiero|quisiera|deseo|want to|would like to|d like to|quero|gostaria de|je veux|je voudrais|je souhaite) (?:hacer|realizar|make|place|fazer|passer) (?:mi|my|meu|ma|mon) (?:primer|primera|first|primeiro|primeira|premiere|premier))\b/;

/** A payment to be made («I want to pay my order», «quiero pagar mi pedido»): a write, never a question about the past. */
const PAYMENT_ACTION = /\b(?:pagar|pay|payer|pague|paye)\b/;
/**
 * F4300-43 (production QA 27-oct, store tenant, image 399e594e): «¿cuánto pagué por mi último Audífono QA Aurora?» and «combien
 * ai-je payé mon dernier Audífono QA Aurora ?» ran only search_faqs («pagué» / «payé» read as a payment to make) and were
 * answered «pagó 119.900 COP» / «a été payé 119 900 COP». No order of that customer shows a payment. How much the customer paid
 * is asked of their own orders: the turn reads them.
 */
const PAST_PAYMENT = /\b(?:cuanto (?:fue lo que )?(?:yo )?(?:le )?pague|how much (?:did|have) (?:i|we) (?:pay|paid|spen[dt])|how much (?:i|we) paid|quanto (?:eu )?paguei|combien (?:ai je|j ai|est ce que j ai|avons nous) paye|j ai paye combien)\b/;

/** The customer asks about their own past orders or purchases (es/en/pt/fr), and asks for nothing to be done to them. Pure. */
export function isPastOrdersQuestion(text: unknown): boolean {
    const t = folded(text);
    if (!t || t.length > 400 || PAST_ORDERS_ACTION.test(t)) return false;
    return PAST_PAYMENT.test(t) || (PAST_ORDERS.test(t) && !PAYMENT_ACTION.test(t));
}

/** The customer asks how many orders or purchases they have (es/en/pt/fr), and asks for nothing to be done to them. Pure. */
export function isOrderCountQuestion(text: unknown): boolean {
    const t = folded(text);
    return !!t && t.length <= 400 && ORDER_COUNT.test(t) && !PAST_ORDERS_ACTION.test(t) && !PAYMENT_ACTION.test(t);
}

// ── The customer's own bookings and appointments («do I have a booking?») ─────────────────────────────────────────────────

/**
 * F4300-08 (production QA 2026-10-25, image fe2edd65): the customer asked about their OWN bookings and the agent answered «you
 * have none» after `search_faqs` alone, with no booking read at all:
 *   - hotel (`requiredReads.properties` on): «tenho alguma reserva no hotel?», «j'ai une réservation chez vous ?» → «você não tem
 *     nenhuma reserva» / «Vous n'avez actuellement aucune réservation» without list_my_property_bookings (EN read it);
 *   - tours (`requiredReads.tours` on): «do I have any tour bookings?», «tenho alguma reserva de passeio?» → «none» without
 *     list_my_tour_bookings (ES read it);
 *   - salon (no pilot flag): «tenho algum horário marcado?», «tengo citas agendadas?», «est-ce que j'ai un rendez-vous ?» → «no
 *     tengo registro» without list_customer_appointments (EN read it).
 *
 * «Do I have a booking?» is the customer's own records; «can I book?», «I want to book», «is the room available?» are not.
 * Folded text (accents gone, apostrophes and hyphens are spaces: «j'ai un rendez-vous» is «j ai un rendez vous»).
 */
const BOOKING_NOUN = '(?:reservas?|reservaciones|reservacion|citas?|turnos?|visitas?|agendamentos?|horarios? marcados?|consultas? marcadas?|'
    + 'reservations?|rendez vous|rdv|bookings?|appointments?|visits?|tour bookings?|trip bookings?)';
const OWN_BOOKINGS = new RegExp(`(?:${[
    // es: «¿tengo alguna reserva?», «tengo citas agendadas?», «¿tenemos reserva para mañana?»
    `\\b(?:tengo|tenemos|tendre|tendria) (?:algun[oa]?s? |una? |unas |unos |ya )?(?:${BOOKING_NOUN})\\b`,
    // es / pt / fr / en: the possessive («mi reserva», «mis citas», «minha reserva», «meu agendamento», «ma réservation», «my booking»)
    `\\b(?:mi|mis|nuestra|nuestras|nuestro|meu|meus|minha|minhas|nossa|nossas|ma|mes|mon|notre|nos|my|our) (?:${BOOKING_NOUN}|horario)\\b`,
    // pt: «tenho alguma reserva?», «tenho algum horário marcado?», «temos agendamento?»
    `\\b(?:tenho|temos|terei) (?:algum[a]?s? |uma? |umas |uns |ja )?(?:${BOOKING_NOUN}|consulta)\\b`,
    // fr: «j'ai une réservation ?», «est-ce que j'ai un rendez-vous ?», «ai-je une réservation ?», «nous avons une réservation»
    `\\b(?:j ai|ai je|avons nous|nous avons) (?:une? |des |deja une? )?(?:${BOOKING_NOUN})\\b`,
    // en: «do I have any reservations?», «do I have any tour bookings?», «have I got an appointment?», «I have a booking»
    `\\b(?:do|did) (?:i|we) (?:still )?have (?!to\\b)(?:a |an |any )?(?:[a-z]+ ){0,2}(?:${BOOKING_NOUN})\\b`,
    `\\b(?:have|has) (?:i|we) (?:got )?(?:a |an |any )?(?:[a-z]+ ){0,2}(?:${BOOKING_NOUN})\\b`,
    `\\b(?:i|we) (?:have|ve got|got) (?:a|an) (?:[a-z]+ ){0,1}(?:${BOOKING_NOUN})\\b`,
    // the name the booking is under («a mi nombre», «no meu nome», «à mon nom», «under my name»)
    `\\b${BOOKING_NOUN}\\b.*\\b(?:a mi nombre|a nombre mio|no meu nome|em meu nome|a mon nom|under my name|in my name)\\b`,
].join('|')})`);
/**
 * Not a question about the customer's own records: booking (or asking to), availability, or a change, payment or complaint about
 * a booking («quiero cancelar mi cita», «can I book a room?», «tengo que reservar con anticipación?», «is the room available?»).
 */
const OWN_BOOKINGS_NOT = new RegExp([
    /\b(?:cancel\w*|anul\w*|annul\w*|modific\w*|cambiar|cambio|changer|change|alterar|reprogram\w*|reagend\w*|remarc\w*|reschedul\w*|mover|move|deplacer|pagar|pago|pay|paid|payment|payer|paiement|pagamento|reembols\w*|refund\w*|rembours\w*|devol\w*|quej\w*|reclam\w*|complain\w*|plainte\w*)\b/.source,
    /\b(?:disponib\w*|available|availability|vacancy|vacancies|cupos?|vagas?|places? libres?)\b/.source,
    /\b(?:tengo que|tenemos que|hay que|tenho que|temos que|do i have to|do i need|do we have to|j ai besoin)\b/.source,
    // A request to book: «puedo reservar», «quiero hacer una reserva», «quero marcar», «je voudrais réserver», «can I book».
    /\b(?:puedo|podemos|podria|quiero|queremos|quisiera|me gustaria|deseo|necesito|posso|quero|queria|gostaria|preciso|je veux|je voudrais|j aimerais|puis je|peut on|can i|could i|may i|can we|i want|i d like|i would like|want to|how do i|how can i|como hago|como puedo|como se) (?:\w+ ){0,2}(?:reservar\w*|reserver|reserve|book|agendar\w*|marcar|apartar|hacer|fazer|faire|make|prendre|pedir|sacar|tomar)\b/.source,
].join('|'));

/** A check-in / check-out or arrival / departure time question: a lodging detail even about the guest's own stay. */
function isStayScheduleQuestion(t: string): boolean {
    return STAY_CHECK.test(t) || (STAY_MOVE.test(t) && TIME.test(t));
}

/**
 * The customer asks whether they have a booking, reservation, appointment or visit, or about their own ones (es/en/pt/fr), and
 * asks for nothing to be done to them; never a request to book or an availability question. Pure.
 */
export function isOwnBookingsQuestion(text: unknown): boolean {
    const t = folded(text);
    return !!t && t.length <= 400 && OWN_BOOKINGS.test(t) && !OWN_BOOKINGS_NOT.test(t);
}

/** The read of the customer's own bookings each pilot publishes (F4300-08). */
const OWN_BOOKINGS_OPERATION: Readonly<Partial<Record<RequiredReadsPilot, { tool: string; operation: string }>>> = Object.freeze({
    properties: { tool: 'list_my_property_bookings', operation: 'view_my_stay_bookings' },
    tours: { tool: 'list_my_tour_bookings', operation: 'view_my_tour_bookings' },
    // Real estate: the customer's own visits are appointments.
    listings: { tool: 'list_customer_appointments', operation: 'view_my_appointments' },
    appointments: { tool: 'list_customer_appointments', operation: 'view_my_appointments' },
});

/** The own-bookings operation of the pilot when the message asks about the customer's own bookings, or null. Pure. */
export function ownBookingsOperation(text: unknown, pilot: RequiredReadsPilot, publishedTools: readonly string[]): string | null {
    const own = OWN_BOOKINGS_OPERATION[pilot];
    if (!own || !publishedTools.includes(own.tool) || !isOwnBookingsQuestion(text)) return null;
    // «what time is check-in for my reservation?» is the property's check-in time (#208), not the booking list.
    if (pilot === 'properties' && isStayScheduleQuestion(folded(text))) return null;
    return own.operation;
}

/**
 * The pilot operation the message's own words name, when the turn publishes its read; null otherwise: the restaurant menu
 * (`menu_info` → get_menu), a lodging's details (`property_info` → list_properties), a tour's details or departures
 * (`package_info` / `package_availability` → search_packages) and a real-estate listing or the listings on offer
 * (`listing_info` / `find_listing` → search_listings), and a product the customer asks to be told about (`product_info` →
 * search_products → get_product), and the customer's own past orders (`check_my_orders` → list_my_orders, `track_catalog_order` →
 * list_my_catalog_orders), and the customer's own bookings or appointments (`view_my_stay_bookings` → list_my_property_bookings,
 * `view_my_tour_bookings` → list_my_tour_bookings, `view_my_appointments` → list_customer_appointments).
 */
export function lexicalRequiredReadsOperation(text: unknown, pilot: RequiredReadsPilot, publishedTools: readonly string[]): string | null {
    // F4300-08: «tenho alguma reserva?» / «do I have any tour bookings?» is the customer's own bookings, before any catalogue word.
    const own = ownBookingsOperation(text, pilot, publishedTools);
    if (own) return own;
    // F4300-11: «qué pedí la última vez?» / «what did I buy last time?» is the customer's own orders, before any menu or product word.
    const ownOrders = isPastOrdersQuestion(text) || isOrderCountQuestion(text);
    if (pilot === 'restaurants' && publishedTools.includes('list_my_orders') && ownOrders) return 'check_my_orders';
    if (pilot === 'catalog' && publishedTools.includes('list_my_catalog_orders') && ownOrders) return 'track_catalog_order';
    if (pilot === 'restaurants' && publishedTools.includes('get_menu') && isMenuQuestion(text)) return 'menu_info';
    if (pilot === 'catalog' && publishedTools.includes('search_products') && isProductQuestion(text)) return 'product_info';
    if (pilot === 'properties' && publishedTools.includes('list_properties') && isLodgingQuestion(text)) return 'property_info';
    if (pilot === 'tours' && publishedTools.includes('search_packages')) return tourQuestionOperation(text);
    if (pilot === 'listings' && publishedTools.includes('search_listings')) return listingQuestionOperation(text);
    return null;
}
