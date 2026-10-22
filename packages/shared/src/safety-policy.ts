/**
 * Health safety policy — versioned DATA, never prompt text and never a regex
 * inside the conversation orchestrator.
 *
 * Production (2026-10): a dental agent was told "me duele una muela desde hace
 * 3 días y se me hinchó la cara, ¿qué antibiótico me tomo?" and "tengo fiebre y
 * la encía muy inflamada desde la extracción de ayer". It refused the
 * antibiotic and offered an ordinary appointment. Nobody told the patient that
 * a swelling face with fever can be an emergency, and nobody on the team was
 * told either.
 *
 * Each health vertical declares a safety class here:
 *
 * - its red flags, each with a description the classifier reads and a family
 *   of multilingual terms (es/en/pt/fr) that acts as a BACKSTOP. The classifier
 *   is the primary signal; the terms may only escalate, never downgrade;
 * - the urgency template the customer receives (4 languages, placeholders for
 *   the regional emergency line, which comes from the country pack —
 *   `emergencyContactsFor` — and never from the template);
 * - the handoff priority and whether booking may continue. Owner decision
 *   (2026-10-22): a red flag ALWAYS hands the conversation to a person, so no
 *   class lets booking continue.
 *
 * The templates are a DRAFT until a clinician signs them
 * (`SAFETY_TEMPLATE_REVIEW`). The runtime that uses this policy sits behind
 * the per-tenant flag `agentRuntime.safetyTriage`, off by default, and the flag
 * must not be turned on before that review.
 */
import { canonicalSubtypeId } from './subtype-experience-profile';
import { emergencyContactsFor } from './tenant-regional-profile';

export const SAFETY_POLICY_VERSION = '2026-10-22.1' as const;

export const SAFETY_LANGUAGES = ['es', 'en', 'pt', 'fr'] as const;
export type SafetyLanguage = typeof SAFETY_LANGUAGES[number];

export type SafetyClassKey =
    | 'dental_acute'
    | 'medical_acute'
    | 'aesthetic_complication'
    | 'mental_health_crisis'
    | 'pet_emergency';

export type SafetyTemplateKey =
    | 'urgency.dental'
    | 'urgency.medical'
    | 'urgency.aesthetic'
    | 'urgency.mental_health'
    | 'urgency.pet'
    | 'footer.human_health'
    | 'footer.animal_health'
    | 'handoff.priority_notice';

/**
 * A term family. Every group must be present for the family to match; inside a
 * group any alternative is enough. Alternatives are matched at the START of a
 * word after normalisation (lower case, no accents, punctuation as spaces), so
 * `hinch` matches «hinchó» / «hinchada» and `ojo` does not match «rojo».
 */
export interface SafetyTermFamily {
    readonly allOf: readonly (readonly string[])[];
}

export interface SafetyRedFlagDefinition {
    readonly key: string;
    /** What the classifier is told this red flag is (English, model-facing). */
    readonly description: string;
    /** Backstop term families, per language. Every language is required. */
    readonly terms: Readonly<Record<SafetyLanguage, readonly SafetyTermFamily[]>>;
}

export type SafetyHandoffPriority = 'urgent';
export type SafetyEmergencyContactSource = 'country_pack.medical' | 'country_pack.medical_and_crisis' | 'none';

export interface SafetyClassDefinition {
    readonly key: SafetyClassKey;
    readonly domain: 'human_health' | 'animal_health';
    /** Who the business is, for the classifier (English, model-facing). */
    readonly description: string;
    /** What is NOT a red flag, for the classifier (English, model-facing). */
    readonly notRedFlags: string;
    readonly redFlags: readonly SafetyRedFlagDefinition[];
    readonly urgencyTemplateKey: SafetyTemplateKey;
    /** Appended to a normal reply when the classifier was unavailable and the backstop fired. */
    readonly footerTemplateKey: SafetyTemplateKey;
    /** Where the emergency line in the template comes from. */
    readonly emergencyContactSource: SafetyEmergencyContactSource;
    readonly handoffPriority: SafetyHandoffPriority;
    /** Owner decision 2026-10-22: always false — a red flag always goes to a person. */
    readonly bookingMayContinue: false;
    /**
     * Whether the BACKSTOP stays quiet when the message places the symptom
     * clearly in the past («hace un año se me hinchó la cara»). Never applies
     * to the classifier. Off for mental-health crises: a disclosed past attempt
     * is for the classifier and the clinician to judge, not for a term list to
     * dismiss.
     */
    readonly backstopHistoricalSuppression: boolean;
    /** The vertical-domain-contract intent this class shares semantics with. */
    readonly domainIntentKey?: 'pet_emergency';
}

const fam = (...groups: (readonly string[])[]): SafetyTermFamily => Object.freeze({ allOf: Object.freeze(groups.map(group => Object.freeze([...group]))) });
const any = (...alternatives: string[]): SafetyTermFamily => fam(alternatives);
const flag = (key: string, description: string, terms: Record<SafetyLanguage, SafetyTermFamily[]>): SafetyRedFlagDefinition =>
    Object.freeze({ key, description, terms: Object.freeze({ es: Object.freeze(terms.es), en: Object.freeze(terms.en), pt: Object.freeze(terms.pt), fr: Object.freeze(terms.fr) }) });

// ── Red flags shared by the human-health classes ─────────────────────────────

const BREATHING = flag('breathing_difficulty', 'Difficulty breathing, shortness of breath or choking right now.', {
    es: [any('dificultad para respirar', 'no puedo respirar', 'me cuesta respirar', 'me falta el aire', 'falta de aire', 'me ahogo', 'me estoy ahogando')],
    en: [any("can't breathe", 'cannot breathe', 'difficulty breathing', 'trouble breathing', 'short of breath', 'shortness of breath', 'struggling to breathe')],
    pt: [any('dificuldade para respirar', 'dificuldade de respirar', 'não consigo respirar', 'falta de ar', 'estou sem ar', 'sufocando')],
    fr: [any('difficulté à respirer', 'du mal à respirer', "je n'arrive pas à respirer", 'je ne peux pas respirer', 'je suffoque', 'souffle court')],
});

// «Me sangran mucho las encías al cepillarme» is routine: only bleeding that
// does not stop (or pours) is a term-level red flag; the classifier judges the rest.
const BLEEDING = flag('uncontrolled_bleeding', 'Heavy bleeding or bleeding that does not stop.', {
    es: [fam(['sangr', 'hemorrag'], ['no para', 'no se detiene', 'no deja de', 'no se corta', 'abundante', 'sin parar', 'a chorros'])],
    en: [fam(['bleed', 'blood'], ["won't stop", 'wont stop', "doesn't stop", 'does not stop', 'not stopping', 'nonstop', 'non stop', 'pouring'])],
    pt: [fam(['sangr', 'hemorrag'], ['não para', 'não está parando', 'sem parar', 'abundante', 'jorrando'])],
    fr: [fam(['saign', 'hémorrag', 'sang'], ["ne s'arrête pas", "n'arrête pas", 'abondamment', 'sans arrêt'])],
});

const ANAPHYLAXIS = flag('anaphylaxis', 'Allergic reaction with swelling of the lips, tongue or throat, hives all over, or difficulty breathing.', {
    es: [fam(['alergia', 'alérgic', 'reacción', 'picadura'], ['garganta', 'lengua', 'labios', 'respirar', 'hinch', 'ronchas por todo'])],
    en: [fam(['allerg', 'reaction', 'sting'], ['throat', 'tongue', 'lips', 'breath', 'swell', 'hives all over'])],
    pt: [fam(['alergi', 'reação', 'picada'], ['garganta', 'língua', 'lábios', 'respirar', 'inch'])],
    fr: [fam(['allerg', 'réaction', 'piqûre'], ['gorge', 'langue', 'lèvres', 'respirer', 'gonfl'])],
});

const LOSS_OF_CONSCIOUSNESS = flag('loss_of_consciousness_or_seizure', 'Fainting, loss of consciousness or a seizure.', {
    es: [any('desmay', 'perdí el conocimiento', 'perdió el conocimiento', 'convulsi', 'inconsciente')],
    en: [any('fainted', 'passed out', 'unconscious', 'seizure', 'convulsion', 'unresponsive', 'blacked out')],
    pt: [any('desmai', 'perdi a consciência', 'perdeu a consciência', 'convuls', 'inconsciente')],
    fr: [any('évanoui', 'perdu connaissance', 'convuls', 'inconscient', "crise d'épilepsie")],
});

const POISONING = flag('poisoning_or_overdose', 'Poisoning, overdose or swallowing too many pills or a toxic substance.', {
    es: [any('sobredosis', 'intoxica', 'envenen', 'me tomé todas las pastillas', 'me tomé muchas pastillas', 'tomé muchas pastillas', 'se tomó muchas pastillas', 'tomé veneno', 'tomó veneno')],
    en: [any('overdose', 'poisoned', 'poisoning', 'took too many pills', 'took all my pills', 'took a lot of pills', 'swallowed bleach')],
    pt: [any('overdose', 'intoxica', 'envenen', 'tomei muitos comprimidos', 'tomei todos os comprimidos', 'tomei muitos remédios')],
    fr: [any('surdose', 'overdose', 'intoxiqu', 'empoisonn', 'pris trop de médicaments', 'pris tous mes médicaments', 'avalé des médicaments')],
});

// ── Dental ──────────────────────────────────────────────────────────────────

const FACIAL_SWELLING = flag('facial_swelling', 'Swelling of the face, cheek, jaw, eye or neck (possible spreading dental infection).', {
    es: [fam(['hinch', 'inflam'], ['cara', 'cachete', 'mejilla', 'mandíbula', 'quijada', 'pómulo', 'ojo', 'párpado', 'cuello'])],
    en: [fam(['swell', 'swollen', 'puffy'], ['face', 'cheek', 'jaw', 'eye', 'eyelid', 'neck'])],
    pt: [fam(['inch', 'inflam'], ['rosto', 'cara', 'bochecha', 'mandíbula', 'olho', 'pálpebra', 'pescoço'])],
    fr: [fam(['gonfl', 'enfl'], ['visage', 'joue', 'mâchoire', 'oeil', 'œil', 'yeux', 'paupière', 'cou'])],
});

const DENTAL_FEVER = flag('dental_infection_with_fever', 'Fever or chills together with a dental problem, a recent extraction, surgery or implant.', {
    es: [fam(['fiebre', 'calentura', 'escalofr'], ['encía', 'muela', 'diente', 'extracción', 'me sacaron', 'cirugía', 'boca', 'absceso', 'flemón', 'implante', 'cordal', 'postemilla'])],
    en: [fam(['fever', 'chills'], ['gum', 'tooth', 'teeth', 'extraction', 'pulled', 'surgery', 'mouth', 'abscess', 'implant', 'wisdom'])],
    pt: [fam(['febre', 'calafrio'], ['gengiva', 'dente', 'extração', 'extraí', 'cirurgia', 'boca', 'abscesso', 'implante', 'siso'])],
    fr: [fam(['fièvre', 'frisson'], ['gencive', 'dent', 'extraction', 'arrach', 'chirurgie', 'bouche', 'abcès', 'implant', 'sagesse'])],
});

const TRISMUS_DYSPHAGIA = flag('cannot_open_mouth_or_swallow', 'Cannot open the mouth, or difficulty or pain swallowing.', {
    es: [fam(['no puedo abrir', 'casi no puedo abrir', 'no logro abrir', 'me cuesta abrir'], ['boca']), any('no puedo tragar', 'me cuesta tragar', 'dificultad para tragar', 'no puedo pasar saliva')],
    en: [fam(["can't open", 'cannot open', 'can barely open', 'unable to open', 'hard to open'], ['mouth', 'jaw']), any("can't swallow", 'cannot swallow', 'difficulty swallowing', 'trouble swallowing', 'hard to swallow', 'painful to swallow')],
    pt: [fam(['não consigo abrir', 'mal consigo abrir', 'dificuldade para abrir', 'dificuldade de abrir'], ['boca']), any('não consigo engolir', 'dificuldade para engolir', 'dificuldade de engolir', 'dói para engolir')],
    fr: [fam(["je n'arrive pas à ouvrir", 'je ne peux pas ouvrir', 'du mal à ouvrir', 'difficulté à ouvrir'], ['bouche', 'mâchoire']), any("je n'arrive pas à avaler", 'je ne peux pas avaler', 'du mal à avaler', 'difficulté à avaler')],
});

const DENTAL_TRAUMA = flag('dental_trauma', 'A blow or accident that knocked out, broke or moved teeth, or injured the jaw.', {
    es: [fam(['golpe', 'accidente', 'me caí', 'caída', 'choque', 'pelea', 'pelotazo'], ['diente', 'dientes', 'muela', 'mandíbula'])],
    en: [fam(['got hit', 'was hit', 'knocked', 'punched', 'fell', 'accident'], ['tooth', 'teeth', 'jaw'])],
    pt: [fam(['pancada', 'acidente', 'caí', 'queda', 'batida', 'soco'], ['dente', 'dentes', 'mandíbula'])],
    fr: [fam(['choc', 'accident', 'tombé', 'chute', 'coup de poing'], ['dent', 'dents', 'mâchoire'])],
});

// ── General medicine ────────────────────────────────────────────────────────

const CHEST_PAIN = flag('chest_pain', 'Chest pain, pressure or tightness.', {
    es: [fam(['dolor', 'presión', 'opresión', 'apretón'], ['pecho', 'tórax'])],
    en: [fam(['pain', 'pressure', 'tightness'], ['chest'])],
    pt: [fam(['dor', 'pressão', 'aperto'], ['peito', 'tórax'])],
    fr: [fam(['douleur', 'mal', 'pression', 'serrement', 'oppression'], ['poitrine', 'thorax'])],
});

const STROKE = flag('stroke_signs', 'Drooping face, slurred speech, sudden weakness or numbness on one side of the body.', {
    es: [any('boca torcida', 'cara caída', 'cara torcida', 'no puedo mover un lado', 'no puedo mover el brazo', 'no puedo mover la pierna', 'se me durmió medio cuerpo', 'perdí la fuerza', 'no puedo hablar bien', 'habla arrastrada', 'arrastra las palabras')],
    en: [any('face drooping', 'facial droop', 'drooping face', 'slurred speech', 'slurring', 'numb on one side', 'weakness on one side', "can't move my arm", 'cannot move my arm', "can't move my leg", "can't speak properly")],
    pt: [any('boca torta', 'rosto caído', 'fala enrolada', 'não consigo mexer o braço', 'não consigo mexer a perna', 'dormência de um lado', 'fraqueza de um lado')],
    fr: [any('bouche déviée', 'visage affaissé', 'visage qui tombe', 'parole confuse', 'du mal à parler', "engourdi d'un côté", 'je ne peux plus bouger le bras', "faiblesse d'un côté")],
});

const DANGEROUS_FEVER = flag('dangerous_fever', 'Fever with a stiff neck, a rash, a seizure or confusion, or any fever in a baby.', {
    es: [fam(['fiebre', 'calentura'], ['cuello rígido', 'rigidez en el cuello', 'rigidez de nuca', 'manchas', 'convuls', 'bebé', 'recién nacido', 'confundid', 'delira', 'no se despierta'])],
    en: [fam(['fever'], ['stiff neck', 'rash', 'seizure', 'baby', 'newborn', 'infant', 'confused', "won't wake"])],
    pt: [fam(['febre'], ['pescoço rígido', 'rigidez na nuca', 'manchas', 'convuls', 'bebê', 'recém nascido', 'confus'])],
    fr: [fam(['fièvre'], ['nuque raide', 'raideur de la nuque', 'taches', 'convuls', 'bébé', 'nourrisson', 'nouveau né', 'confus'])],
});

const PREGNANCY = flag('pregnancy_emergency', 'During pregnancy: bleeding, severe pain, waters breaking or the baby not moving.', {
    es: [fam(['embaraz', 'gestación'], ['sangr', 'dolor fuerte', 'dolor muy fuerte', 'no siento al bebé', 'no se mueve el bebé', 'rompí fuente', 'se me rompió la fuente', 'contracciones'])],
    en: [fam(['pregnan'], ['bleed', 'severe pain', "baby isn't moving", 'baby is not moving', 'water broke', 'contractions'])],
    pt: [fam(['grávida', 'gestação', 'gestante'], ['sangr', 'dor forte', 'bebê não mexe', 'bolsa estourou', 'contrações'])],
    fr: [fam(['enceinte', 'grossesse'], ['saign', 'douleur intense', 'forte douleur', 'bébé ne bouge', 'perdu les eaux', 'contractions'])],
});

// ── Aesthetic / dermatology ─────────────────────────────────────────────────

const AESTHETIC_COMPLICATION = flag('post_procedure_complication', 'After an injection, filler, toxin, thread, peel, laser or surgical aesthetic procedure: skin turning white, purple or dark, severe pain, vision changes, blisters or burns, pus or fever.', {
    es: [fam(
        ['relleno', 'ácido hialurónico', 'hialurónico', 'botox', 'toxina', 'inyección', 'inyecciones', 'bichectomía', 'hilos', 'peeling', 'láser', 'lipo', 'tratamiento', 'procedimiento'],
        ['después', 'luego', 'desde', 'me hicieron', 'me aplicaron', 'me pusieron', 'tras'],
        ['blanca', 'morad', 'oscur', 'negr', 'dolor fuerte', 'dolor intenso', 'no veo', 'visión borrosa', 'veo borroso', 'ampolla', 'quemad', 'pus', 'necros', 'fiebre'],
    )],
    en: [fam(
        ['filler', 'hyaluronic', 'botox', 'toxin', 'injection', 'threads', 'peel', 'laser', 'lipo', 'treatment', 'procedure'],
        ['after', 'since', 'got', 'had'],
        ['white', 'purple', 'dark', 'black', 'severe pain', "can't see", 'blurred vision', 'blurry vision', 'blister', 'burn', 'pus', 'fever', 'necro'],
    )],
    pt: [fam(
        ['preenchimento', 'ácido hialurônico', 'botox', 'toxina', 'injeção', 'fios', 'peeling', 'laser', 'lipo', 'tratamento', 'procedimento'],
        ['depois', 'desde', 'fiz', 'aplicaram', 'após'],
        ['branc', 'roxa', 'roxo', 'escur', 'dor forte', 'não enxergo', 'visão embaçada', 'bolha', 'queimad', 'pus', 'febre', 'necros'],
    )],
    fr: [fam(
        ['acide hyaluronique', 'injection', 'botox', 'toxine', 'fils', 'peeling', 'laser', 'lipo', 'traitement', 'soin', 'comblement', 'filler'],
        ['après', 'depuis', "on m'a fait", "j'ai fait"],
        ['blanc', 'blanche', 'violet', 'foncé', 'noir', 'douleur intense', 'je ne vois plus', 'vision floue', 'cloque', 'brûl', 'pus', 'fièvre', 'nécros'],
    )],
});

// ── Mental health ───────────────────────────────────────────────────────────

const SUICIDAL = flag('suicidal_ideation', 'Thoughts of suicide, wanting to die or to end one\'s life (current, even if expressed indirectly).', {
    es: [any('suicid', 'quitarme la vida', 'matarme', 'me quiero matar', 'no quiero vivir', 'no quiero seguir viviendo', 'acabar con mi vida', 'quiero morir', 'me quiero morir', 'no vale la pena vivir')],
    en: [any('suicid', 'kill myself', 'end my life', 'want to die', 'wanna die', "don't want to live", 'dont want to live', 'better off dead', 'take my own life')],
    pt: [any('suicid', 'me matar', 'tirar minha vida', 'tirar a minha vida', 'acabar com a minha vida', 'acabar com minha vida', 'quero morrer', 'não quero mais viver')],
    fr: [any('suicid', 'me tuer', 'mettre fin à mes jours', 'en finir avec la vie', 'je veux mourir', 'envie de mourir', 'je ne veux plus vivre')],
});

const SELF_HARM = flag('self_harm', 'Self-harm, or intent to hurt oneself.', {
    es: [any('hacerme daño', 'lastimarme', 'cortarme', 'me corto', 'autolesi', 'me hago daño')],
    en: [any('hurt myself', 'harm myself', 'self harm', 'cut myself', 'cutting myself')],
    pt: [any('me machucar', 'me cortar', 'me corto', 'autolesão', 'me ferir')],
    fr: [any('me faire du mal', 'me blesser', 'me couper', 'me scarifier', 'automutil')],
});

const DANGER = flag('danger_to_self_or_others', 'Intent to harm someone else, or being in immediate danger or under attack.', {
    es: [any('hacerle daño a', 'matar a alguien', 'lo voy a matar', 'la voy a matar', 'me quiere matar', 'me va a matar', 'estoy en peligro', 'me está golpeando')],
    en: [any('kill someone', 'hurt someone', 'going to kill him', 'going to kill her', 'wants to kill me', 'going to kill me', 'i am in danger', "i'm in danger", 'he is hitting me', 'she is hitting me')],
    pt: [any('matar alguém', 'machucar alguém', 'vou matar ele', 'vou matar ela', 'quer me matar', 'vai me matar', 'estou em perigo', 'está me batendo')],
    fr: [any("tuer quelqu'un", "faire du mal à quelqu'un", 'je vais le tuer', 'je vais la tuer', 'veut me tuer', 'va me tuer', 'je suis en danger', 'il me frappe', 'elle me frappe')],
});

// ── Animals (same semantics as the `pet_emergency` domain intent) ──────────────

const PET_POISONING = flag('pet_poisoning', 'The animal ate or drank something toxic (poison, rat bait, chocolate, grapes, antifreeze, medicines) or swallowed an object.', {
    es: [any('envenen', 'intoxic', 'veneno', 'raticida', 'comió chocolate', 'se comió chocolate', 'comió uvas', 'comió pasas', 'anticongelante', 'se tragó')],
    en: [any('poison', 'ate chocolate', 'ate grapes', 'ate raisins', 'antifreeze', 'rat bait', 'swallowed')],
    pt: [any('envenen', 'intoxica', 'veneno', 'chumbinho', 'comeu chocolate', 'comeu uva', 'engoliu')],
    fr: [any('empoisonn', 'intoxiqu', 'poison', 'mort aux rats', 'mangé du chocolat', 'mangé du raisin', 'antigel', 'avalé')],
});

const PET_BREATHING = flag('pet_breathing_difficulty', 'The animal struggles to breathe, is choking, or has blue or purple gums or tongue.', {
    es: [any('no puede respirar', 'le cuesta respirar', 'respira con dificultad', 'dificultad para respirar', 'se está ahogando', 'se ahoga', 'encías moradas', 'lengua morada', 'encías azules')],
    en: [any("can't breathe", 'cannot breathe', 'struggling to breathe', 'difficulty breathing', 'choking', 'blue gums', 'purple gums', 'blue tongue')],
    pt: [any('não consegue respirar', 'dificuldade para respirar', 'respirando com dificuldade', 'engasgad', 'gengiva roxa', 'língua roxa')],
    fr: [any("n'arrive pas à respirer", 'du mal à respirer', 'difficulté à respirer', "s'étouffe", 'gencives bleues', 'langue bleue')],
});

const PET_TRAUMA = flag('pet_trauma', 'The animal was hit by a vehicle, attacked, fell from a height, or has a visible fracture.', {
    es: [any('atropell', 'lo mordió un perro', 'la mordió un perro', 'se cayó de', 'se cayó del', 'fractura', 'hueso expuesto')],
    en: [any('hit by a car', 'run over', 'attacked by a dog', 'bitten by a dog', 'fell from', 'broken bone', 'fracture')],
    pt: [any('atropel', 'foi mordido', 'foi mordida', 'caiu da', 'caiu do', 'fratura', 'osso exposto')],
    fr: [any('renversé par une voiture', 'percuté par une voiture', 'mordu par un chien', 'mordue par un chien', 'tombé du', 'tombée du', 'fracture')],
});

const PET_COLLAPSE = flag('pet_collapse_or_seizure', 'The animal is having a seizure, collapsed, is unconscious, does not react, or cannot stand up.', {
    es: [any('convulsi', 'se desmayó', 'colaps', 'no reacciona', 'inconsciente', 'no se puede parar', 'no se puede levantar')],
    en: [any('seizure', 'seizing', 'collapsed', 'unconscious', 'unresponsive', "can't stand up", 'cannot stand')],
    pt: [any('convuls', 'desmaiou', 'desmaio', 'colaps', 'não reage', 'inconsciente', 'não consegue levantar')],
    fr: [any('convuls', 'évanoui', 'effondré', 'ne réagit plus', 'inconscient', 'ne peut plus se lever')],
});

const PET_BLOAT = flag('pet_bloat', 'Swollen, hard abdomen, or trying to vomit without bringing anything up.', {
    es: [fam(['abdomen', 'barriga', 'panza', 'estómago', 'vientre'], ['hinchad', 'inflamad', 'inflad', 'duro', 'dura']), any('intenta vomitar y no puede', 'arcadas sin vomitar')],
    en: [fam(['belly', 'abdomen', 'stomach'], ['bloated', 'swollen', 'distended', 'hard']), any('trying to vomit', 'retching', 'dry heaving')],
    pt: [fam(['barriga', 'abdômen', 'estômago'], ['inchad', 'dur', 'estufad']), any('tenta vomitar e não consegue', 'ânsia sem vomitar')],
    fr: [fam(['ventre', 'abdomen', 'estomac'], ['gonfl', 'dur', 'distendu']), any('essaie de vomir', 'haut le coeur', 'haut le cœur')],
});

const PET_BLEEDING = flag('pet_uncontrolled_bleeding', 'The animal is bleeding heavily or the bleeding does not stop.', BLEEDING.terms as Record<SafetyLanguage, SafetyTermFamily[]>);

const PET_URINARY = flag('pet_cannot_urinate', 'The animal (especially a male cat) strains but cannot urinate.', {
    es: [any('no puede orinar', 'no orina', 'no hace pis', 'intenta orinar y no puede')],
    en: [any("can't pee", 'cannot pee', "can't urinate", 'cannot urinate', 'not peeing', 'straining to pee', 'straining to urinate')],
    pt: [any('não consegue urinar', 'não faz xixi', 'não consegue fazer xixi')],
    fr: [any("n'arrive pas à uriner", 'ne fait plus pipi', 'ne peut pas uriner')],
});

const PET_BIRTH = flag('pet_difficult_birth', 'A difficult birth: a puppy or kitten stuck, or hours of labour without progress.', {
    es: [fam(['parto', 'pariendo', 'dando a luz'], ['no sale', 'horas', 'complic', 'atorad', 'atascad'])],
    en: [fam(['labor', 'labour', 'giving birth', 'whelping', 'delivering'], ['stuck', 'hours', 'complication', "won't come out"])],
    pt: [fam(['parto', 'parindo'], ['não sai', 'horas', 'complica', 'preso', 'presa'])],
    fr: [fam(['mise bas', 'accouche', 'met bas'], ['coincé', 'heures', 'complication', 'ne sort pas'])],
});

const PET_HEATSTROKE = flag('pet_heatstroke', 'Heatstroke: heavy panting, collapse after heat exposure.', {
    es: [any('golpe de calor')],
    en: [any('heatstroke', 'heat stroke')],
    pt: [any('insolação', 'intermação')],
    fr: [any('coup de chaleur')],
});

const cls = (definition: SafetyClassDefinition): SafetyClassDefinition => Object.freeze({ ...definition, redFlags: Object.freeze([...definition.redFlags]) });

export const SAFETY_CLASSES: Readonly<Record<SafetyClassKey, SafetyClassDefinition>> = Object.freeze({
    dental_acute: cls({
        key: 'dental_acute', domain: 'human_health',
        description: 'a dental clinic (odontology)',
        notRedFlags: 'Routine requests (cleanings, whitening, orthodontics, prices, schedules, appointments), ordinary toothache or sensitivity without swelling of the face or fever, gum inflammation without fever, and symptoms clearly in the past and resolved.',
        redFlags: [FACIAL_SWELLING, DENTAL_FEVER, TRISMUS_DYSPHAGIA, BREATHING, BLEEDING, DENTAL_TRAUMA, ANAPHYLAXIS],
        urgencyTemplateKey: 'urgency.dental', footerTemplateKey: 'footer.human_health',
        emergencyContactSource: 'country_pack.medical', handoffPriority: 'urgent', bookingMayContinue: false,
        backstopHistoricalSuppression: true,
    }),
    medical_acute: cls({
        key: 'medical_acute', domain: 'human_health',
        description: 'a general medical practice, clinic or pharmacy',
        notRedFlags: 'Routine requests (check-ups, prescriptions renewals, prices, schedules, appointments, product availability), mild ongoing symptoms (a cold, a mild headache), and symptoms clearly in the past and resolved.',
        redFlags: [CHEST_PAIN, BREATHING, STROKE, LOSS_OF_CONSCIOUSNESS, BLEEDING, ANAPHYLAXIS, POISONING, DANGEROUS_FEVER, PREGNANCY],
        urgencyTemplateKey: 'urgency.medical', footerTemplateKey: 'footer.human_health',
        emergencyContactSource: 'country_pack.medical', handoffPriority: 'urgent', bookingMayContinue: false,
        backstopHistoricalSuppression: true,
    }),
    aesthetic_complication: cls({
        key: 'aesthetic_complication', domain: 'human_health',
        description: 'a dermatology or aesthetic-medicine clinic (injectables, fillers, lasers, peels)',
        notRedFlags: 'Routine requests (prices, treatments, results, schedules, appointments), the mild, expected redness or small swelling right after a treatment, cosmetic concerns, and symptoms clearly in the past and resolved.',
        redFlags: [AESTHETIC_COMPLICATION, ANAPHYLAXIS, BREATHING, BLEEDING],
        urgencyTemplateKey: 'urgency.aesthetic', footerTemplateKey: 'footer.human_health',
        emergencyContactSource: 'country_pack.medical', handoffPriority: 'urgent', bookingMayContinue: false,
        backstopHistoricalSuppression: true,
    }),
    mental_health_crisis: cls({
        key: 'mental_health_crisis', domain: 'human_health',
        description: 'a psychology or therapy practice',
        notRedFlags: 'Routine requests (first session, prices, schedules, modalities, insurance), describing ordinary sadness, stress or anxiety without risk to self or others, and asking general questions about therapy topics.',
        redFlags: [SUICIDAL, SELF_HARM, DANGER, POISONING],
        urgencyTemplateKey: 'urgency.mental_health', footerTemplateKey: 'footer.human_health',
        emergencyContactSource: 'country_pack.medical_and_crisis', handoffPriority: 'urgent', bookingMayContinue: false,
        backstopHistoricalSuppression: false,
    }),
    pet_emergency: cls({
        key: 'pet_emergency', domain: 'animal_health',
        description: 'a veterinary clinic or a pet-services business (grooming, daycare, boarding, walking, training)',
        notRedFlags: 'Routine requests (vaccines, grooming, baths, daycare, boarding, prices, schedules), mild symptoms without distress (a single vomit, mild itching), and events clearly in the past and resolved.',
        redFlags: [PET_POISONING, PET_BREATHING, PET_TRAUMA, PET_COLLAPSE, PET_BLOAT, PET_BLEEDING, PET_URINARY, PET_BIRTH, PET_HEATSTROKE],
        urgencyTemplateKey: 'urgency.pet', footerTemplateKey: 'footer.animal_health',
        emergencyContactSource: 'none', handoffPriority: 'urgent', bookingMayContinue: false,
        backstopHistoricalSuppression: true,
        domainIntentKey: 'pet_emergency',
    }),
});

/**
 * Which class governs a business type. Keyed by the CANONICAL profile id, so a
 * legacy alias (`veterinaria/peluqueria_canina`) resolves through
 * `canonicalSubtypeId` to the same class as its target.
 */
export const SAFETY_CLASS_BY_PROFILE: Readonly<Record<string, SafetyClassKey>> = Object.freeze({
    'salud/dental': 'dental_acute',
    'salud/medica_general': 'medical_acute',
    'salud/farmacia': 'medical_acute',
    'salud/dermatologia': 'aesthetic_complication',
    'salud/psicologia': 'mental_health_crisis',
    'moda_belleza/estetica': 'aesthetic_complication',
    'veterinaria/clinica_general': 'pet_emergency',
    'veterinaria/hospital_24h': 'pet_emergency',
    'veterinaria/exoticos': 'pet_emergency',
    'pet_services/peluqueria': 'pet_emergency',
    'pet_services/guarderia': 'pet_emergency',
    'pet_services/hotel': 'pet_emergency',
    'pet_services/paseos': 'pet_emergency',
    'pet_services/adiestramiento': 'pet_emergency',
});

/** Industries whose every business type is a health business, and the class used when the subtype is unknown. */
export const SAFETY_CLASS_BY_INDUSTRY: Readonly<Record<string, SafetyClassKey>> = Object.freeze({
    salud: 'medical_acute',
    veterinaria: 'pet_emergency',
    pet_services: 'pet_emergency',
});

export function safetyClassFor(industry?: string | null, subtype?: string | null): SafetyClassDefinition | null {
    const canonical = canonicalSubtypeId(industry, subtype);
    if (!canonical) return null;
    const key = (canonical.subtype && SAFETY_CLASS_BY_PROFILE[`${canonical.industry}/${canonical.subtype}`])
        || SAFETY_CLASS_BY_INDUSTRY[canonical.industry];
    return key ? SAFETY_CLASSES[key] : null;
}

// ── Templates (DRAFT — clinical review pending) ─────────────────────────────────

/**
 * Status of the clinical sign-off of every template below. The owner decided
 * (2026-10-22) that a clinician reviews them before `agentRuntime.safetyTriage`
 * is turned on for any tenant; whoever reviews them updates this record in the
 * same change that edits the texts.
 */
export const SAFETY_TEMPLATE_REVIEW = Object.freeze({
    status: 'pending_clinical_review' as 'pending_clinical_review' | 'clinically_reviewed',
    reviewedBy: null as string | null,
    reviewedAt: null as string | null,
});

/**
 * `{emergencyLine}` is replaced with `SAFETY_EMERGENCY_LINE` (the country-pack
 * number with its preposition, or a generic phrase when the country is not
 * listed). `{crisisLine}` is replaced with `SAFETY_CRISIS_LINE` when the country
 * has a national crisis line, and removed otherwise. Formal address (usted)
 * throughout: health is where over-familiarity costs most.
 */
export const SAFETY_TEMPLATES: Readonly<Record<SafetyTemplateKey, Readonly<Record<SafetyLanguage, string>>>> = Object.freeze({
    'urgency.dental': Object.freeze({
        es: 'Por lo que me cuenta, esto puede necesitar atención urgente y no debería esperar a una cita normal. Por favor no se automedique. Si tiene dificultad para respirar o para tragar, o la hinchazón crece rápido o llega al ojo o al cuello, llame {emergencyLine} o vaya ya a un servicio de urgencias. Si no, busque hoy mismo atención odontológica de urgencia.',
        en: 'From what you describe, this may need urgent care and should not wait for a regular appointment. Please do not self-medicate. If you have trouble breathing or swallowing, or the swelling grows quickly or reaches your eye or neck, call {emergencyLine} or go to an emergency department now. Otherwise, please get urgent dental care today.',
        pt: 'Pelo que você conta, isso pode precisar de atendimento urgente e não deveria esperar uma consulta normal. Por favor, não se automedique. Se tiver dificuldade para respirar ou engolir, ou se o inchaço crescer rápido ou chegar ao olho ou ao pescoço, ligue para {emergencyLine} ou vá agora a um pronto-socorro. Caso contrário, procure atendimento odontológico de urgência ainda hoje.',
        fr: "D'après ce que vous décrivez, cela peut nécessiter des soins urgents et ne devrait pas attendre un rendez-vous ordinaire. Merci de ne pas vous automédiquer. Si vous avez du mal à respirer ou à avaler, ou si le gonflement augmente vite ou atteint l'œil ou le cou, appelez {emergencyLine} ou rendez-vous immédiatement aux urgences. Sinon, consultez un dentiste en urgence dès aujourd'hui.",
    }),
    'urgency.medical': Object.freeze({
        es: 'Lo que describe puede ser una urgencia médica y no debería esperar a una cita. Llame {emergencyLine} o acuda de inmediato al servicio de urgencias más cercano. No se automedique y, si se siente mal, no maneje usted.',
        en: 'What you describe may be a medical emergency and should not wait for an appointment. Call {emergencyLine} or go to the nearest emergency department right away. Do not self-medicate and, if you feel unwell, do not drive yourself.',
        pt: 'O que você descreve pode ser uma emergência médica e não deveria esperar uma consulta. Ligue para {emergencyLine} ou vá imediatamente ao pronto-socorro mais próximo. Não se automedique e, se estiver se sentindo mal, não dirija.',
        fr: "Ce que vous décrivez peut être une urgence médicale et ne devrait pas attendre un rendez-vous. Appelez {emergencyLine} ou rendez-vous immédiatement aux urgences les plus proches. Ne vous automédiquez pas et, si vous vous sentez mal, ne conduisez pas vous-même.",
    }),
    'urgency.aesthetic': Object.freeze({
        es: 'Lo que describe después del tratamiento puede ser una complicación que necesita atención urgente; no debería esperar a una cita ni aplicarse nada por su cuenta. Si la piel se pone blanca, morada u oscura, nota cambios en la visión, le cuesta respirar o tiene fiebre, llame {emergencyLine} o acuda ya a un servicio de urgencias.',
        en: 'What you describe after the treatment may be a complication that needs urgent care; please do not wait for an appointment or apply anything yourself. If the skin turns white, purple or dark, your vision changes, you have trouble breathing or you have a fever, call {emergencyLine} or go to an emergency department now.',
        pt: 'O que você descreve depois do procedimento pode ser uma complicação que precisa de atendimento urgente; não espere uma consulta nem aplique nada por conta própria. Se a pele ficar branca, roxa ou escura, se a visão mudar, se tiver dificuldade para respirar ou febre, ligue para {emergencyLine} ou vá agora a um pronto-socorro.',
        fr: "Ce que vous décrivez après le soin peut être une complication qui nécessite une prise en charge urgente ; n'attendez pas un rendez-vous et n'appliquez rien vous-même. Si la peau devient blanche, violette ou foncée, si votre vision change, si vous avez du mal à respirer ou de la fièvre, appelez {emergencyLine} ou rendez-vous immédiatement aux urgences.",
    }),
    'urgency.mental_health': Object.freeze({
        es: 'Gracias por contármelo. Lo que siente importa y no tiene que pasarlo a solas. Si está en peligro o piensa hacerse daño, llame {emergencyLine} ahora o vaya a la sala de urgencias más cercana. {crisisLine}',
        en: 'Thank you for telling me. What you are feeling matters and you do not have to go through it alone. If you are in danger or thinking about hurting yourself, call {emergencyLine} now or go to the nearest emergency department. {crisisLine}',
        pt: 'Obrigado por me contar. O que você sente importa e você não precisa passar por isso sozinho. Se estiver em perigo ou pensando em se machucar, ligue para {emergencyLine} agora ou vá ao pronto-socorro mais próximo. {crisisLine}',
        fr: "Merci de me l'avoir dit. Ce que vous ressentez compte et vous n'avez pas à le traverser seul. Si vous êtes en danger ou pensez à vous faire du mal, appelez {emergencyLine} maintenant ou rendez-vous aux urgences les plus proches. {crisisLine}",
    }),
    'urgency.pet': Object.freeze({
        es: 'Lo que describe puede ser una urgencia para su mascota y no debería esperar a una cita. No le dé medicamentos para personas ni intente provocarle el vómito sin indicación veterinaria. Llévela de inmediato a la clínica veterinaria de urgencias abierta más cercana.',
        en: 'What you describe may be an emergency for your pet and should not wait for an appointment. Do not give it human medicines or try to make it vomit without a vet telling you to. Take it right away to the nearest open emergency veterinary clinic.',
        pt: 'O que você descreve pode ser uma emergência para o seu animal e não deveria esperar uma consulta. Não dê remédios de uso humano nem tente fazê-lo vomitar sem orientação veterinária. Leve-o imediatamente à clínica veterinária de emergência aberta mais próxima.',
        fr: "Ce que vous décrivez peut être une urgence pour votre animal et ne devrait pas attendre un rendez-vous. Ne lui donnez pas de médicaments pour humains et n'essayez pas de le faire vomir sans avis vétérinaire. Emmenez-le immédiatement à la clinique vétérinaire d'urgence ouverte la plus proche.",
    }),
    'footer.human_health': Object.freeze({
        es: 'Importante: si sus síntomas son intensos o empeoran (dificultad para respirar, dolor en el pecho, hinchazón que avanza, fiebre alta o un sangrado que no para), llame {emergencyLine} o acuda a urgencias; no espere a una cita.',
        en: 'Important: if your symptoms are severe or getting worse (trouble breathing, chest pain, spreading swelling, high fever or bleeding that will not stop), call {emergencyLine} or go to an emergency department; do not wait for an appointment.',
        pt: 'Importante: se os sintomas forem intensos ou piorarem (dificuldade para respirar, dor no peito, inchaço que aumenta, febre alta ou sangramento que não para), ligue para {emergencyLine} ou vá a um pronto-socorro; não espere uma consulta.',
        fr: "Important : si vos symptômes sont intenses ou s'aggravent (difficulté à respirer, douleur à la poitrine, gonflement qui s'étend, forte fièvre ou saignement qui ne s'arrête pas), appelez {emergencyLine} ou rendez-vous aux urgences ; n'attendez pas un rendez-vous.",
    }),
    'footer.animal_health': Object.freeze({
        es: 'Importante: si su mascota respira con dificultad, convulsiona, no se puede levantar, sangra mucho o pudo comer algo tóxico, llévela de inmediato a una clínica veterinaria de urgencias; no espere a una cita.',
        en: 'Important: if your pet struggles to breathe, has a seizure, cannot stand, is bleeding heavily or may have eaten something toxic, take it to an emergency veterinary clinic right away; do not wait for an appointment.',
        pt: 'Importante: se o seu animal respira com dificuldade, tem convulsões, não consegue se levantar, sangra muito ou pode ter comido algo tóxico, leve-o imediatamente a uma clínica veterinária de emergência; não espere uma consulta.',
        fr: "Important : si votre animal a du mal à respirer, convulse, ne peut plus se lever, saigne beaucoup ou a pu manger quelque chose de toxique, emmenez-le immédiatement dans une clinique vétérinaire d'urgence ; n'attendez pas un rendez-vous.",
    }),
    'handoff.priority_notice': Object.freeze({
        es: 'Ya avisé a nuestro equipo con prioridad para que una persona le contacte lo antes posible.',
        en: 'I have already alerted our team as a priority so that a person contacts you as soon as possible.',
        pt: 'Já avisei nossa equipe com prioridade para que uma pessoa entre em contato com você o quanto antes.',
        fr: 'J’ai déjà prévenu notre équipe en priorité pour qu’une personne vous contacte au plus vite.',
    }),
});

/** The emergency line as it reads inside the templates, with its preposition. */
export const SAFETY_EMERGENCY_LINE: Readonly<Record<SafetyLanguage, (number: string | null) => string>> = Object.freeze({
    es: (number: string | null) => number ? `al ${number}` : 'al número de emergencias de su país',
    en: (number: string | null) => number ? number : 'your local emergency number',
    pt: (number: string | null) => number ? `o ${number}` : 'o número de emergência do seu país',
    fr: (number: string | null) => number ? `le ${number}` : "le numéro d'urgence de votre pays",
});

/** The national crisis line sentence (mental health), only when the country pack lists one. */
export const SAFETY_CRISIS_LINE: Readonly<Record<SafetyLanguage, (number: string) => string>> = Object.freeze({
    es: (number: string) => `También puede llamar a la línea de apoyo en crisis ${number}.`,
    en: (number: string) => `You can also call the crisis support line at ${number}.`,
    pt: (number: string) => `Você também pode ligar para a linha de apoio em crise ${number}.`,
    fr: (number: string) => `Vous pouvez aussi appeler la ligne d'écoute de crise au ${number}.`,
});

export function safetyLanguageOf(language?: string | null): SafetyLanguage {
    const code = String(language || '').slice(0, 2).toLowerCase();
    return (SAFETY_LANGUAGES as readonly string[]).includes(code) ? code as SafetyLanguage : 'es';
}

export interface RenderedSafetyText {
    readonly text: string;
    readonly emergencyNumber: string | null;
    readonly crisisLine: string | null;
    readonly emergencyReviewStatus: 'unreviewed' | 'reviewed' | 'not_listed' | 'not_applicable';
}

/** A template with its regional placeholders filled from the country pack. */
export function renderSafetyTemplate(key: SafetyTemplateKey, safetyClass: SafetyClassDefinition, language?: string | null, country?: string | null): RenderedSafetyText {
    const lang = safetyLanguageOf(language);
    const contacts = safetyClass.emergencyContactSource === 'none' ? null : emergencyContactsFor(country);
    const emergencyNumber = contacts?.medical || null;
    const crisisLine = safetyClass.emergencyContactSource === 'country_pack.medical_and_crisis' ? contacts?.crisisLine || null : null;
    const text = SAFETY_TEMPLATES[key][lang]
        .split('{emergencyLine}').join(SAFETY_EMERGENCY_LINE[lang](emergencyNumber))
        .split('{crisisLine}').join(crisisLine ? SAFETY_CRISIS_LINE[lang](crisisLine) : '')
        .replace(/[ \t]+$/g, '').trim();
    return Object.freeze({
        text, emergencyNumber, crisisLine,
        emergencyReviewStatus: safetyClass.emergencyContactSource === 'none' ? 'not_applicable' : contacts ? contacts.reviewStatus : 'not_listed',
    });
}

// ── Backstop matching ───────────────────────────────────────────────────────

/**
 * Markers that place a symptom clearly in the past, and markers that say it is
 * happening now. Only the BACKSTOP reads them (see
 * `backstopHistoricalSuppression`): «hace un año se me hinchó la cara» does not
 * fire it, «desde hace 3 días» does.
 */
export const SAFETY_HISTORICAL_MARKERS: Readonly<Record<SafetyLanguage, readonly string[]>> = Object.freeze({
    es: Object.freeze(['hace un año', 'hace años', 'hace unos años', 'hace varios años', 'hace meses', 'hace unos meses', 'el año pasado', 'hace tiempo', 'hace mucho', 'de niño', 'de niña', 'en el pasado']),
    en: Object.freeze(['a year ago', 'years ago', 'months ago', 'last year', 'long ago', 'in the past', 'as a kid', 'as a child']),
    pt: Object.freeze(['há um ano', 'faz um ano', 'há anos', 'faz anos', 'há meses', 'ano passado', 'há muito tempo', 'quando era criança']),
    fr: Object.freeze(['il y a un an', 'il y a des années', 'il y a quelques années', 'il y a des mois', "l'année dernière", "l'an dernier", 'il y a longtemps', "quand j'étais petit"]),
});

export const SAFETY_ONGOING_MARKERS: Readonly<Record<SafetyLanguage, readonly string[]>> = Object.freeze({
    es: Object.freeze(['ahora', 'hoy', 'ayer', 'anoche', 'todavía', 'aún', 'sigue', 'sigo', 'desde hace', 'desde ayer', 'desde anoche', 'esta mañana', 'en este momento', 'otra vez', 'de nuevo']),
    en: Object.freeze(['now', 'today', 'yesterday', 'last night', 'still', 'since yesterday', 'this morning', 'right now', 'currently', 'again']),
    pt: Object.freeze(['agora', 'hoje', 'ontem', 'ainda', 'desde ontem', 'esta manhã', 'hoje de manhã', 'neste momento', 'de novo', 'outra vez']),
    fr: Object.freeze(['maintenant', "aujourd'hui", 'hier', 'encore', 'depuis hier', 'ce matin', 'en ce moment', 'de nouveau']),
});

/** Lower case, no accents, every non-alphanumeric as one space, padded so a term can be matched at a word start. */
export function normalizeSafetyText(text: string): string {
    const folded = String(text || '').toLowerCase()
        .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9*]+/g, ' ')
        .trim();
    return ` ${folded} `;
}

const containsTerm = (normalizedText: string, term: string): boolean => {
    const needle = normalizeSafetyText(term).trimEnd();
    return needle.trim().length > 0 && normalizedText.includes(needle);
};

const familyMatches = (normalizedText: string, family: SafetyTermFamily): boolean =>
    family.allOf.length > 0 && family.allOf.every(group => group.some(term => containsTerm(normalizedText, term)));

export interface SafetyBackstopMatch {
    /** Red-flag keys whose term families matched. */
    readonly flags: readonly string[];
    /** Matches that were ignored because the message places them in the past. */
    readonly suppressedByHistory: boolean;
}

/**
 * The term backstop. Every language is checked on every message (customers mix
 * languages and the detector can be wrong on a short message). Its result may
 * only ESCALATE a classifier verdict, never lower one.
 */
export function matchSafetyBackstop(text: string, safetyClass: SafetyClassDefinition): SafetyBackstopMatch {
    const normalized = normalizeSafetyText(text);
    const flags = safetyClass.redFlags
        .filter(redFlag => SAFETY_LANGUAGES.some(lang => redFlag.terms[lang].some(family => familyMatches(normalized, family))))
        .map(redFlag => redFlag.key);
    if (!flags.length || !safetyClass.backstopHistoricalSuppression) return Object.freeze({ flags: Object.freeze(flags), suppressedByHistory: false });
    const historical = SAFETY_LANGUAGES.some(lang => SAFETY_HISTORICAL_MARKERS[lang].some(term => containsTerm(normalized, term)));
    const ongoing = SAFETY_LANGUAGES.some(lang => SAFETY_ONGOING_MARKERS[lang].some(term => containsTerm(normalized, term)));
    if (historical && !ongoing) return Object.freeze({ flags: Object.freeze([]), suppressedByHistory: true });
    return Object.freeze({ flags: Object.freeze(flags), suppressedByHistory: false });
}
