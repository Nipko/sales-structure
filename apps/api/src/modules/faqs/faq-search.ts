import type { FAQ } from '@parallext/shared';

// Common function words in the four supported languages carry little topic
// information. Keep business nouns, numbers and verbs; no generated synonyms.
const FUNCTION_WORDS = new Set((
    'a al algo ante con cual cuales cuando cuanto cuantos de del el ella ellas ellos en es esa ese eso esta estas este estos hay la las lo los me mi mis nos o para por que se si sin su sus te ti tu tus un una unas uno unos y ' +
    'an and are as at be can could do does for from how i in is it its me my of on or our that the their these this to was we what when where which who with would you your ' +
    'ao aos as com como da das de do dos e ela ele eles em essa esse ha isso meu minha na nas no nos o os ou para pela pelo por qual quais quanto que sao se sem sua suas tem um uma voce voces ' +
    'au aux avec ce ces cet cette dans de des du elle elles en est et eux il ils je la le les leur ma mes moi mon ne nos nous ou par pas pour quel quelle quels quelles qui quoi sa sans ses son sur ta tes toi ton tu un une vos votre vous' +
    // «si QUIERO alquilar», «I WANT to…»: wanting is no topic, and no way of asking either (F4300-53, 29-oct).
    ' quiero quero want veux'
).split(/\s+/));

const fold = (value: string) => value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
const tokens = (value: string) => fold(value).match(/[\p{L}\p{N}]+/gu) || [];
// An answer may express duration as "20 minutes" without repeating "how long".
// Only these specific follow-up words may be absent. A missing topic/name
// anywhere in the query (including a later question) must still reject it.
// "duracion" is the noun of "dura": the words that MEAN duration compare as one concept.
// "tiempo"/"time" do not: "what time" asks for a schedule and "cuanto tiempo antes" for a
// lead time. They are only filler ("cuanto tiempo dura") when the same question already
// holds a duration word, so they are dropped from the query in that case and stay ordinary
// words otherwise. "last"/"lasts" mean both "the final one" and "continues for", so they never
// take part in the comparison.
// «plazo»/«prazo»/«délai» de una garantía es su duración (F4300-51: «¿Cuál es el plazo de garantía…?» answers «how long is the warranty»).
const DURATION_WORDS = new Set(['dura', 'duran', 'durar', 'duracion', 'long', 'duration', 'duracao', 'duree', 'dure', 'durent', 'plazo', 'prazo', 'delai', 'period', 'periodo', 'periode']);
/**
 * F4300-51 (production QA 28-oct, store tenant): the business writes its FAQs in one language and customers ask in four. «how long
 * is the warranty on the QA test headphone?», «combien de temps dure la garantie…?», «quanto tempo dura a garantia… de teste?» never
 * found «¿Cuál es el plazo de garantía QA del audífono de prueba?» and the agent said it had no information. The topic words FAQs
 * are written about compare as one concept across es/en/pt/fr, and the candidate search looks for every spelling.
 */
const EQUIVALENTS: Record<string, string[]> = {
    garantia: ['garantia', 'garantias', 'warranty', 'warranties', 'guarantee', 'garantie', 'garanties'],
    prueba: ['prueba', 'pruebas', 'test', 'tests', 'teste', 'testes', 'essai'],
    audifono: ['audifono', 'audifonos', 'headphone', 'headphones', 'earphone', 'earphones', 'ecouteur', 'ecouteurs', 'fone', 'fones'],
    pago: ['pago', 'pagos', 'payment', 'payments', 'pagamento', 'pagamentos', 'paiement', 'paiements'],
    envio: ['envio', 'envios', 'shipping', 'delivery', 'deliveries', 'entrega', 'entregas', 'livraison', 'livraisons', 'domicilio', 'domicilios'],
    horario: ['horario', 'horarios', 'hours', 'schedule', 'horaire', 'horaires'],
    devolucion: ['devolucion', 'devoluciones', 'return', 'returns', 'refund', 'refunds', 'devolucao', 'devolucoes', 'reembolso', 'reembolsos', 'remboursement', 'retour', 'retours'],
    cancelacion: ['cancelacion', 'cancelaciones', 'cancellation', 'cancellations', 'cancelamento', 'cancelamentos', 'annulation', 'annulations',
        // «si je dois ANNULER…», «if I CANCEL…», «se eu CANCELAR…» ask for the cancellation policy (F4300-53, 29-oct).
        'cancelar', 'cancelo', 'cancel', 'cancelling', 'canceling', 'annuler'],
    // What a question asks («do you HAVE…» is «¿TIENEN…?»): compared as one verb, so a FAQ in another language never «asks something else».
    tener: ['tener', 'tiene', 'tienen', 'have', 'has', 'tem', 'temos', 'ont', 'avez'],
    poder: ['poder', 'puedo', 'puede', 'pueden', 'posso', 'pode', 'podem', 'puis', 'peux', 'peut', 'can', 'could'],
    // «how MUCH is…» asks the price as «¿cuánto CUESTA…?» does (F4300-53, 29-oct).
    costar: ['costar', 'cuesta', 'cuestan', 'cost', 'costs', 'custa', 'custam', 'coute', 'coutent', 'vale', 'valen', 'much'],
    metodo: ['metodo', 'metodos', 'method', 'methods', 'methode', 'methodes', 'moyen', 'moyens', 'medio', 'medios', 'meio', 'meios'],
    politica: ['politica', 'politicas', 'policy', 'policies', 'politique', 'politiques'],
    // F4300-51 residue (production QA 28-oct): «how can I contact you?», «comment puis-je vous contacter ?», «what documents do I need to
    // buy a property?» never found «¿Cómo puedo contactarlos?» / «¿Qué documentos necesito para arrendar / comprar?».
    contacto: ['contacto', 'contactos', 'contactar', 'contactarlos', 'contactarnos', 'contact', 'contacts', 'contato', 'contatos', 'contatar', 'contacter'],
    // F4300-53 (production QA 29-oct): «¿necesito pasaporte para viajar?» / «do I need a passport to travel?» missed «¿Qué documentos
    // necesito para viajar?», and with no FAQ the agent said it cannot give migration requirements. A passport or visa is a travel document.
    documento: ['documento', 'documentos', 'document', 'documents', 'pasaporte', 'pasaportes', 'passport', 'passports', 'passaporte', 'passaportes', 'passeport', 'passeports', 'visa', 'visas', 'visto',
        // «¿qué PAPELES necesito para un viaje internacional?», «what PAPERS…», «quels PAPIERS…» (F4300-53, 29-oct).
        'papeles', 'papers', 'papiers', 'papeis'],
    // «¿dónde nos ENCONTRAMOS para el tour?», «where do we MEET?» ask for «¿Dónde es el punto de ENCUENTRO?» (F4300-53, 29-oct).
    encuentro: ['encuentro', 'encontramos', 'encontrarnos', 'encontrar', 'meet', 'meeting', 'encontro', 'retrouve', 'retrouver', 'rejoindre'],
    // One «where» in the four languages, so «onde…?» does not «ask something else» than «¿Dónde…?».
    donde: ['donde', 'where', 'onde'],
    viajar: ['viajar', 'viaje', 'viajes', 'travel', 'traveling', 'travelling', 'trip', 'viagem', 'viagens', 'viajam', 'voyager', 'voyage', 'voyages'],
    necesitar: ['necesitar', 'necesito', 'necesita', 'necesitan', 'need', 'needs', 'preciso', 'precisa', 'precisam', 'besoin', 'faut',
        // «¿es OBLIGATORIO contratar un seguro?», «is insurance REQUIRED?» ask «¿NECESITO seguro de viaje?» (F4300-53, 29-oct).
        'obligatorio', 'obligatoria', 'obligatoire', 'mandatory', 'required', 'obrigatorio', 'obrigatoria'],
    comprar: ['comprar', 'compra', 'buy', 'buying', 'purchase', 'acheter', 'achat'],
    arrendar: ['arrendar', 'arriendo', 'alquilar', 'alquiler', 'rent', 'renting', 'rental', 'alugar', 'aluguel', 'louer'],
    inmueble: ['inmueble', 'inmuebles', 'propiedad', 'propiedades', 'property', 'properties', 'imovel', 'imoveis', 'bien', 'biens'],
    // F4300-51 residue (production QA 28-oct, after #260): «is there a discount for children?», «what products do you use?», «how much
    // commission do you charge?», «how do I book a table?», «how long does orthodontic treatment take?» missed the Spanish FAQ.
    // «¿los niños pagan menos?», «do kids pay less?», «paient-ils moins cher ?» ask for the discount (F4300-53, 29-oct).
    descuento: ['descuento', 'descuentos', 'discount', 'discounts', 'desconto', 'descontos', 'reduction', 'reductions', 'remise', 'remises', 'menos', 'less', 'moins', 'cher', 'cheaper'],
    nino: ['nino', 'ninos', 'nina', 'ninas', 'child', 'children', 'kid', 'kids', 'crianca', 'criancas', 'enfant', 'enfants'],
    // «¿qué MARCAS o productos usan en el tinte?» (F4300-53, 29-oct): the brand is what «¿Qué productos usan?» answers.
    producto: ['producto', 'productos', 'product', 'products', 'produto', 'produtos', 'produit', 'produits', 'marca', 'marcas', 'brand', 'brands', 'marque', 'marques'],
    comision: ['comision', 'comisiones', 'commission', 'commissions', 'comissao', 'comissoes', 'honorarios', 'fee', 'fees', 'honoraires',
        // «quais são as TAXAS que vocês cobram?» asks «¿Cuánto cobran de comisión / honorarios?» (F4300-53, 29-oct).
        'taxa', 'taxas'],
    reserva: ['reserva', 'reservas', 'reservar', 'reservation', 'reservations', 'book', 'booking', 'reserver', 'reservacion'],
    ortodoncia: ['ortodoncia', 'orthodontic', 'orthodontics', 'ortodontia', 'orthodontie', 'braces', 'brackets'],
    usar: ['usar', 'usan', 'usa', 'usamos', 'use', 'uses', 'using', 'usam', 'utilizan', 'utilisez', 'utiliser', 'utilizam'],
    mesa: ['mesa', 'mesas', 'table', 'tables'],
    tratamiento: ['tratamiento', 'tratamientos', 'treatment', 'treatments', 'tratamento', 'tratamentos', 'traitement', 'traitements'],
    emergencia: ['emergencia', 'emergencias', 'emergency', 'emergencies', 'urgence', 'urgences', 'urgencia', 'urgencias'],
    mascota: ['mascota', 'mascotas', 'pet', 'pets', 'animal', 'animais', 'animaux', 'animales'],
    ubicacion: ['ubicacion', 'ubicados', 'ubicado', 'location', 'address', 'endereco', 'localizacao', 'adresse', 'direccion',
        // «onde FICA o estabelecimento?», «where are you LOCATED?», «où êtes-vous SITUÉS ?» (F4300-53, 29-oct).
        'fica', 'ficam', 'localizado', 'localizados', 'located', 'situe', 'situes', 'situated'],
    seguro: ['seguro', 'seguros', 'insurance', 'assurance', 'assurances'],
    // What a question asks «how much do you CHARGE»: one verb, so the FAQ that charges the same way wins a tie.
    cobrar: ['cobrar', 'cobran', 'cobra', 'cobram', 'charge', 'charges', 'facturez'],
    // F4300-53 (production QA 29-oct, real FAQs read from the tenants' DB): «how much is a dental cleaning?» / «combien coûte un détartrage ?»
    // / «quanto custa uma limpeza dental?» missed «¿Cuánto cuesta una limpieza dental?» and were told the clinic does not offer it;
    // «do kids pay less?» / «¿los niños pagan menos?» missed «¿Hay descuento para niños?»; «what should I bring to my first visit?»
    // missed «¿Qué documentos necesito para la primera visita?» (its answer: «Trae tu documento…»).
    limpieza: ['limpieza', 'limpiezas', 'cleaning', 'cleanings', 'limpeza', 'limpezas', 'detartrage', 'nettoyage', 'profilaxis'],
    pagar: ['pagar', 'pagan', 'paga', 'pagamos', 'pay', 'pays', 'paid', 'pagam', 'payer', 'paient', 'paie'],
    visita: ['visita', 'visitas', 'visit', 'visits', 'visite', 'visites', 'rendez'],
    primero: ['primera', 'primero', 'primer', 'first', 'primeira', 'primeiro', 'premier', 'premiere'],
    // F4300-53 (production QA 29-oct, dental and restaurant): «que faire en cas d’urgence DENTAIRE ?», «j’ai PEUR du DENTISTE, comment
    // GÉREZ-vous cela ?», «I am SCARED of the DENTIST, how do you HANDLE it?», «what is the average PRICE per PERSON?» missed «¿Atienden
    // urgencias dentales?», «¿Cómo manejan el dolor o miedo al dentista?», «¿Cuál es el precio promedio por persona?»: with no FAQ the
    // agent invented an on-call number, said sedation is not offered, or asked how many people the order was for.
    dental: ['dental', 'dentales', 'dentaire', 'dentaires', 'dentario', 'dentaria', 'dentarios', 'dentarias'],
    dentista: ['dentista', 'dentistas', 'dentist', 'dentists', 'dentiste', 'dentistes'],
    miedo: ['miedo', 'miedos', 'temor', 'fear', 'fears', 'scared', 'afraid', 'medo', 'peur', 'ansiedad', 'anxiety', 'anxious', 'ansiedade', 'anxiete'],
    manejar: ['manejar', 'manejan', 'manejo', 'manejamos', 'handle', 'handles', 'manage', 'lidar', 'lidam', 'gerer', 'gerez'],
    precio: ['precio', 'precios', 'price', 'prices', 'preco', 'precos', 'prix'],
    promedio: ['promedio', 'average'],
    persona: ['persona', 'personas', 'person', 'persons', 'people', 'pessoa', 'pessoas', 'personne', 'personnes'],
    llevar: ['llevar', 'llevo', 'traer', 'traigo', 'trae', 'bring', 'levar', 'levo', 'trazer', 'apporter'],
};
const EQUIVALENT_OF = new Map(Object.entries(EQUIVALENTS).flatMap(([concept, words]) => words.map(word => [word, concept] as const)));

/** The terms with every spelling of the same topic in the four languages, for the candidate search. */
export function withEquivalents(terms: string[]): string[] {
    return [...new Set(terms.flatMap(term => {
        const concept = EQUIVALENT_OF.get(term);
        return concept ? [term, ...EQUIVALENTS[concept]] : [term];
    }))];
}
const DURATION_FILLER = new Set(['tiempo', 'time', 'tempo', 'temps']);
const ASKS_TIME = /(?<!\p{L})(?:cuant[oa]|quant[oa]|combien|how\s+much)\s+(?:de\s+)?(?:tiempo|tempo|temps|time)(?!\p{L})(?!\s+(?:antes|before|avant|de\s+antecedencia|d['’]avance))/u;
const AMBIGUOUS_WORDS = new Set(['last', 'lasts']);
const DURATION = 'duration';
// Comparison form of a term: duration words collapse into one concept and a plural
// "s" is dropped ("visitas" = "visita"). Only for ranking; the SQL candidates keep raw terms.
const canon = (term: string): string => DURATION_WORDS.has(term) ? DURATION
    : EQUIVALENT_OF.get(term) ?? (term.length > 4 && term.endsWith('s') ? term.slice(0, -1) : term);
const canonTokens = (value: string): Set<string> => new Set(tokens(value).filter(t => !AMBIGUOUS_WORDS.has(t)).map(canon));
const canonTerms = (value: string): string[] => {
    const raw = faqSearchTerms(value).filter(t => !AMBIGUOUS_WORDS.has(t));
    const hasDuration = raw.some(t => DURATION_WORDS.has(t));
    // F4300-53 (production QA 29-oct): «¿y cuánto tiempo tengo de garantía?» asks a duration with no duration word; «tiempo» stayed a
    // topic the warranty FAQ never says, and the FAQ was dropped. «cuánto tiempo», «quanto tempo», «combien de temps» are a duration.
    const asksTime = ASKS_TIME.test(fold(value));
    return [...new Set(raw.filter(t => !(hasDuration && DURATION_FILLER.has(t)))
        .map(t => asksTime && DURATION_FILLER.has(t) ? DURATION : canon(t)))];
};

// Words that only introduce a code ("Prueba QA QA_C1_T01:", "Pedido ORD_123:"). Text before a
// label made only of these carries no topic, so it can be dropped with the label.
const GENERIC_MARKERS = ['prueba', 'qa', 'test', 'pedido', 'orden', 'ref', 'referencia', 'ticket', 'caso', 'reserva', 'order', 'booking'];
const GENERIC_SET = new Set(GENERIC_MARKERS);
const TRAILING_MARKERS = new RegExp(`(?:[\\s,.;:-]+(?:${GENERIC_MARKERS.join('|')}))+[\\s,.;:-]*$`, 'iu');

/** Drops what a customer pastes next to the real question and no FAQ ever contains:
 * the token of a label `XXX_YYY:`, any other token that carries an underscore, and numbers
 * of 6 or more digits. The text around a label stays (it may hold the topic: "Tour Faro
 * Rojo, reserva RES_77: ¿Cuánto dura?"); the part BEFORE the label is dropped only when it is
 * empty or made only of generic markers ("Prueba QA QA_C1_T01_1: ¿...?"), and the part AFTER
 * only when it is generic. Tokens mixing letters and digits (24h, 4x4, COVID19, mp3...) and
 * short numbers ("plan 2025") are real vocabulary and stay. */
export function stripFaqQueryNoise(query: string): string {
    const noiseTokens = (text: string) => text
        .replace(/[\p{L}\p{N}_-]+/gu, token => token.includes('_') || /^\p{N}{6,}$/u.test(token) ? '' : token);
    const generic = (text: string) => faqSearchTerms(noiseTokens(text)).every(term => GENERIC_SET.has(term));
    // Labels can be stacked ("Prueba QA QA_C1_1: Ref ABC_2: ¿…?"): each one is handled in turn.
    // "Ref 1234567:" anywhere: generic words, a long number and a colon are a label with no topic in it.
    const numberLabel = new RegExp(`(?<![\\p{L}\\p{N}])(?:(?:${GENERIC_MARKERS.join('|')})\\b[\\s,.;-]*)+\\p{N}{6,}\\s*:\\s*`, 'giu');
    let body = query.replace(numberLabel, ' ');
    for (let pass = 0; pass < 4; pass++) {
        const label = /[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)+\s*:/u.exec(body);
        if (!label) break;
        const before = body.slice(0, label.index);
        const after = body.slice(label.index + label[0].length);
        if (generic(before)) body = after;
        else if (generic(after)) body = before;
        else body = `${before.replace(TRAILING_MARKERS, '')} ${after}`;
    }
    // "Ref 1234567:" (the number was dropped as noise): a label made only of generic words and a colon.
    const leadingLabel = new RegExp(`^[\\s:,;.-]*(?:(?:${GENERIC_MARKERS.join('|')})\\b[\\s,.;-]*)+:\\s*`, 'iu');
    let cleaned = noiseTokens(body).replace(/[ \t]{2,}/g, ' ');
    for (let pass = 0; pass < 4 && leadingLabel.test(cleaned); pass++) cleaned = cleaned.replace(leadingLabel, '');
    return cleaned
        .replace(/\s+([,.;:?!])/g, '$1')
        .replace(/^[\s:,;.-]+/, '')
        .trim();
}

export function faqSearchTerms(query: string): string[] {
    return [...new Set(tokens(query).filter(term => term.length > 1 && !FUNCTION_WORDS.has(term)))].slice(0, 32);
}

// Where a new question begins: «y qué garantía tiene», «and what warranty», «e qual a garantia», «et quelle garantie».
const QUESTION_STARTERS = 'cu[aá]nt[oa]s?|qu[eé]|c[oó]mo|d[oó]nde|cu[aá]ndo|cu[aá]l(?:es)?|qui[eé]n(?:es)?|what|how|when|where|which|who|why|quant[oa]s?|qual|quais|quem|onde|quando|combien|comment|quel(?:le)?s?|quand|o[uù]|pourquoi';
const COMPOUND_SPLIT = new RegExp(`[?？¿;,]+|\\b(?:y|and|e|et)\\s+(?=(?:${QUESTION_STARTERS})(?![\\p{L}]))`, 'iu');

/**
 * The questions of a message that asks several at once ("¿Cuánto cuesta X, cuántas unidades hay y qué garantía
 * tiene?" is three). Split on question marks, commas, semicolons and an "and" that opens a new question; parts
 * with no searchable word are dropped. A message with one question comes back as one part.
 */
export function splitCompoundQuery(query: string): string[] {
    return String(query || '').split(COMPOUND_SPLIT)
        .map(part => part.replace(/^[\s:.!-]+|[\s:.!-]+$/g, ''))
        .filter(part => faqSearchTerms(part).length > 0)
        .slice(0, 4);
}

// Words that only carry the question ("tiene", "hay", "cuesta", "have", "há"): a part is about what is left.
const QUESTION_FILLER = new Set([
    'tiene', 'tienen', 'tener', 'hay', 'cuesta', 'cuestan', 'vale', 'valen', 'dura', 'duran', 'incluye', 'incluyen', 'ofrece', 'ofrecen',
    'cobran', 'cobra', 'son', 'estan', 'hacen', 'hace', 'have', 'has', 'there', 'cost', 'costs', 'much', 'many', 'tem', 'custa', 'custam',
    'ha', 'coute', 'ont', 'combien', 'quantas', 'quantos', 'cuantas', 'cuantos', 'sont', 'accept', 'accepts', 'aceptan', 'aceitam', 'acceptez',
    // How a question is asked in the four languages («¿Cómo PUEDO…?», «comment PUIS-je…?», «como POSSO ENTRAR em contato?»).
    'comment', 'puis', 'puedo', 'puede', 'posso', 'pode', 'entrar',
    // «¿Cómo HAGO una reserva?», «how do I…», «what do I DO in…», «EN CASO DE emergencia», «how long does it TAKE».
    'hago', 'hacer', 'hace', 'faco', 'fazer', 'faire', 'fais', 'caso', 'case', 'cas', 'take', 'takes',
    // «what SHOULD I bring…», «qué DEBO llevar», «o que DEVO levar», «que DOIS-je apporter» (F4300-53, 29-oct).
    'should', 'must', 'debo', 'debe', 'devo', 'deve', 'dois', 'doit',
    // «…para viajar con USTEDES», «with YOU»: who the business is, not a topic.
    'ustedes', 'voces', 'vous', 'you',
    // «el PUNTO de encuentro», «meeting POINT»: the place word adds no topic of its own (F4300-53, 29-oct).
    'punto', 'point', 'ponto',
    // «¿DÓNDE…?», «WHERE…?», «ONDE…?» only ask where (the FAQ «¿Dónde es el punto de encuentro?» is about the meeting).
    'donde', 'where', 'onde',
    // «¿cuánto tiempo TENGO de garantía?», «quanto tempo TENHO…» (F4300-53).
    'tengo', 'tenho',
    // «I AM scared», «j’AI peur», «comment gérez-vous CELA», «price PER person» (F4300-53, 29-oct).
    'am', 'ai', 'cela', 'per',
    // «CONTRATAR / SOUSCRIRE un seguro», «papeles que tengo que tener LISTOS», «el ESTABLECIMIENTO»: no topic of their own (29-oct).
    'contratar', 'souscrire', 'listos', 'listas', 'ready', 'prets', 'estabelecimento', 'establecimiento', 'etablissement',
]);

/** The topic words of ONE part of a message: what is left after the function words and the words that only ask. */
export function topicTermsOf(part: string): string[] {
    return faqSearchTerms(part).filter(term => !QUESTION_FILLER.has(term));
}

/**
 * The FAQ a one-word topic ("garantía") points to: its QUESTION holds the word, and among several the one that
 * shares most with the rest of the message ("Audífono QA") wins. Two equally good FAQs are a guess: none.
 */
export function pickTopicFaq(rows: FAQ[], topic: string, message: string, echoTiebreak = false): FAQ | null {
    const term = canon(topic);
    const own = rows.filter(row => canonTokens(row.question).has(term));
    if (!own.length) return null;
    const context = new Set(canonTerms(message).filter(t => t !== term && !QUESTION_FILLER.has(t)));
    // `echoTiebreak` (single-question fallback only): between FAQs the context cannot separate, the one whose
    // QUESTION repeats more of the customer's own words ("cuánto COBRAN de comisión") is the one the customer
    // phrased. Still equal after that: none.
    const words = echoTiebreak ? canonTerms(message) : [];
    const scored = own.map(row => {
        const doc = canonTokens(`${row.question} ${row.answer}`);
        const question = canonTokens(row.question);
        return { row, score: [...context].filter(t => doc.has(t)).length, echo: words.filter(t => question.has(t)).length };
    }).sort((a, b) => b.score - a.score || b.echo - a.echo);
    if (scored.length > 1 && scored[0].score === scored[1].score && scored[0].echo === scored[1].echo) return null;
    // A price FAQ that shares nothing else with the message is about something else ("¿qué precio tiene el
    // Audífono?" is not "¿Cuál es el precio de la instalación?"), and its figure would pass the price guardrail as
    // retrieved knowledge. Product prices come from the catalog tools, so a price topic needs real context.
    if (scored[0].score === 0 && PRICE_TOPICS.has(term)) return null;
    return scored[0].row;
}

const FILLER_CANON = new Set([...QUESTION_FILLER].map(canon));
/** Comparison form of the topic words of a message (`topicTermsOf`, canonicalised). */
const topicCanonOf = (message: string): string[] => canonTerms(message).filter(t => !FILLER_CANON.has(t));

/**
 * The topic words a FAQ QUESTION adds that the message never says ("Faro AZUL" for a "Faro Rojo" message). Words
 * written as alternatives with a slash next to a covered word ("comisión / honorarios") are the same topic, not
 * an addition.
 */
function questionExtras(question: string, message: Set<string>): string[] {
    const own = topicCanonOf(question);
    const alternates = new Set<string>();
    for (const slash of fold(question).matchAll(/([\p{L}\p{N}]+)\s*\/\s*([\p{L}\p{N}]+)/gu)) {
        const [left, right] = [canon(slash[1]), canon(slash[2])];
        if (message.has(left)) alternates.add(right);
        if (message.has(right)) alternates.add(left);
    }
    // F4300-53 (production QA 28-oct): «audífono DE PRUEBA», «QA», «test» mark a seeded record, not another topic — the warranty FAQ
    // «¿Cuál es el plazo de garantía QA del audífono de prueba?» never answered «¿cuánto dura la garantía del Audífono QA Aurora?».
    return own.filter(t => !message.has(t) && !alternates.has(t) && !GENERIC_SET.has(t));
}

/**
 * Last resort for ONE question that carries extra words ("¿cuánto cobran de comisión por vender mi apartamento?"):
 * the strict search needs every word, and the fallbacks need the whole message, so they find nothing even though
 * "¿Cuánto cobran de comisión?" answers it. `rows` are the FAQs holding ANY topic word of the message.
 *
 * A FAQ is returned only when (a) its QUESTION covers a clear majority (at least two, more than half) of the
 * message's topic words, or (b) exactly one topic word of the message appears in any candidate question and
 * `pickTopicFaq` singles out one FAQ for it. Words that only ask ("cuánto", "cobran") never count as topic.
 * A FAQ whose question adds its own topic word while a topic word of the message appears nowhere in the FAQ
 * ("tour Faro Azul" for "tour Faro Rojo"), or that asks something else of the topic ("cuánto DURA" for "cuánto
 * CUESTA"), is about something else and never answers. Equals: none.
 */
export function pickTopicFallbackFaq(rows: FAQ[], message: string): FAQ | null {
    const topic = topicCanonOf(message);
    if (!topic.length || !rows.length) return null;
    const said = new Set(canonTerms(message));
    const words = [...said];
    // What the message asks about its topic ("cuánto CUESTA la visita guiada"): a FAQ question that asks something
    // else of the same topic ("¿Cuánto DURA la visita guiada?") answers a different question.
    // «where» is an English function word, so it never reaches `words`: the question still asks «where» (F4300-53, 29-oct).
    const asks = [...words.filter(t => FILLER_CANON.has(t)), ...(/(?<!\p{L})(?:donde|where|onde)(?!\p{L})/u.test(fold(message)) && !words.includes('donde') ? ['donde'] : [])];
    const scored = rows.map(row => {
        const question = canonTokens(row.question);
        const content = canonTokens(`${row.question} ${row.answer}`);
        const covered = topic.filter(t => question.has(t));
        const questionAsks = canonTerms(row.question).filter(t => FILLER_CANON.has(t));
        const asksOther = asks.length > 0 && questionAsks.length > 0 && !questionAsks.some(t => asks.includes(t));
        const substitutes = asksOther || (questionExtras(row.question, said).length > 0 && topic.some(t => !content.has(t)));
        return { row, covered: covered.length, coveredTerms: covered, echo: words.filter(t => question.has(t)).length, substitutes };
    });
    const eligible = scored.filter(s => !s.substitutes);

    if (topic.length >= 2) {
        const majority = eligible.filter(s => s.covered >= 2 && s.covered * 2 > topic.length)
            .sort((a, b) => b.covered - a.covered || b.echo - a.echo);
        if (majority.length) {
            const [best, next] = majority;
            return next && next.covered === best.covered && next.echo === best.echo ? null : best.row;
        }
    }

    const hit = new Set(scored.flatMap(s => s.coveredTerms));
    // F4300-53 (production QA 29-oct, agency): «¿dónde nos encontramos para salir al tour?» hit «encuentro» in «¿Dónde es el punto de
    // encuentro?» and «tour» in «¿En qué idiomas se hace el tour?»: two topics, so no FAQ. The FAQ that asks the same way the message
    // asks («dónde» / «where» / «onde») is the one, when exactly one eligible FAQ shares that asking word.
    if (hit.size > 1 && asks.length) {
        const sameAsk = eligible.filter(s => s.covered > 0 && canonTerms(s.row.question).some(t => FILLER_CANON.has(t) && asks.includes(t)));
        return sameAsk.length === 1 ? sameAsk[0].row : null;
    }
    if (hit.size !== 1) return null;
    return pickTopicFaq(eligible.map(s => s.row), [...hit][0], message, true);
}

const PRICE_TOPICS = new Set(['precio', 'costo', 'coste', 'valor', 'tarifa', 'price', 'pricing', 'fee', 'preco', 'custo', 'prix', 'tarif', 'cout']);

/** Conservative fallback for questions with added detail. A single shared
 * word such as "visita" cannot pull unrelated vertical seeds into a reply. */
export function rankPartialFaqMatches(rows: FAQ[], query: string, limit: number): FAQ[] {
    const allTerms = canonTerms(query);
    // The fallback may tolerate an ADDED question, never replace the topic of
    // the first one. Keep its full lexical anchor in the FAQ question itself.
    // This is deliberately stricter than fuzzy matching: "Faro Rojo" must not
    // become "Faro Azul" because their answers share "incluye/dura/visita".
    const firstQuestion = fold(query).split(/[?？;]|\b(?:y|and|e|et)\s+(?=(?:cuanto|cuanta|cuantos|cuantas|que|como|donde|what|how|when|where|quanto|qual|quais|quel|quelle|quels|quelles|combien|comment)\b)/u)[0];
    const anchor = canonTerms(firstQuestion);
    if (anchor.length < 2) return [];
    return rows.map((faq, index) => {
        const question = canonTokens(faq.question);
        const content = new Set([...question, ...canonTokens(faq.answer)]);
        // The duration concept is optional in the ANSWER only: when the FAQ never
        // mentions it, it is neither required nor counted.
        const terms = allTerms.filter(term => term !== DURATION || content.has(DURATION));
        const minimumMatches = Math.max(2, Math.ceil(terms.length * 0.75));
        const matched = terms.filter(term => content.has(term)).length;
        const questionMatches = terms.filter(term => question.has(term)).length;
        const topicPreserved = terms.every(term => content.has(term));
        return { faq, index, matched, minimumMatches, anchored: topicPreserved && anchor.every(term => question.has(term)), score: matched + questionMatches };
    }).filter(row => row.anchored && row.matched >= row.minimumMatches)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, limit).map(row => row.faq);
}
