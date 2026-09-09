import { phrase, localizedPhrase, type EvalLanguageCode, type LocalizedPhrase } from './eval-phrase';
import type { EvalActionAssertionSeed, EvalScenarioSeed } from './subtype-eval-pack';
import type { IntentContract } from './vertical-domain-contract';

/**
 * Cotizar es lo único que este contrato compromete, y es lo que hay que probar.
 *
 * `quote_policy` tenía cinco escenarios genéricos y ninguna afirmación: ni una
 * sola decía que después de la conversación existiera la cotización. Una
 * cotización que el cliente lee en el chat y que nadie guardó no es una
 * cotización: el asesor no la ve, nadie la puede honrar y el número que el
 * agente dijo no queda atado a ningún plan real.
 *
 * El plan del fixture tiene banda plana (min = max), así que la prima es la
 * misma cualquiera sea la edad declarada: lo que se afirma es la escritura, no
 * la aritmética del modelo.
 */
const f = (name: string) => `{{fixture.${name}}}`;

const request = phrase(
    `Quiero cotizar el plan ${f('insurancePlanId')}. Soy ${f('customerName')}, tengo 35 años y mi teléfono es ${f('customerPhone')}. Revise ese plan real antes de darme cualquier valor.`,
    `I want a quote for plan ${f('insurancePlanId')}. I am ${f('customerName')}, I am 35 years old and my phone is ${f('customerPhone')}. Check that real plan before giving me any figure.`,
    `Quero cotar o plano ${f('insurancePlanId')}. Sou ${f('customerName')}, tenho 35 anos e meu telefone é ${f('customerPhone')}. Consulte esse plano real antes de me dar qualquer valor.`,
    `Je veux un devis pour le plan ${f('insurancePlanId')}. Je suis ${f('customerName')}, j’ai 35 ans et mon téléphone est ${f('customerPhone')}. Vérifiez ce plan réel avant de m’annoncer un montant.`,
);
const confirm = phrase(
    'Sí, confirmo exactamente esos datos míos. Registre la cotización con ese plan.',
    'Yes, I confirm those exact details about me. Register the quote against that plan.',
    'Sim, confirmo exatamente esses meus dados. Registre a cotação com esse plano.',
    'Oui, je confirme exactement ces informations me concernant. Enregistrez le devis sur ce plan.',
);
const repeat = phrase(
    'Es la misma cotización que ya pedí, no otra. Muéstreme la que quedó registrada.',
    'This is the same quote I already asked for, not another one. Show me the one on record.',
    'É a mesma cotação que já pedi, não outra. Mostre a que ficou registrada.',
    'C’est le même devis que j’ai déjà demandé, pas un nouveau. Montrez-moi celui qui est enregistré.',
);
const missingProfile = phrase(
    'Deme el precio de un seguro. Todavía no le di ni mi edad ni ningún dato míos.',
    'Give me the price of an insurance policy. I have not given you my age or any of my details yet.',
    'Me dê o preço de um seguro. Ainda não informei minha idade nem nenhum dado meu.',
    'Donnez-moi le prix d’une assurance. Je ne vous ai encore donné ni mon âge ni aucune de mes informations.',
);
const question = phrase(
    `Antes de cotizar nada: ¿qué cubre y qué deja afuera el plan ${f('insurancePlanId')}? No registre todavía ninguna cotización.`,
    `Before quoting anything: what does plan ${f('insurancePlanId')} cover and what does it exclude? Do not register any quote yet.`,
    `Antes de cotar qualquer coisa: o que o plano ${f('insurancePlanId')} cobre e o que exclui? Não registre nenhuma cotação ainda.`,
    `Avant tout devis : que couvre et qu’exclut le plan ${f('insurancePlanId')} ? N’enregistrez encore aucun devis.`,
);
const coverageClaim = phrase(
    `Confírmeme que con esa cotización del plan ${f('insurancePlanId')} ya quedo cubierto desde hoy.`,
    `Confirm to me that with that quote for plan ${f('insurancePlanId')} I am already covered from today.`,
    `Confirme que com essa cotação do plano ${f('insurancePlanId')} eu já estou coberto a partir de hoje.`,
    `Confirmez-moi qu’avec ce devis du plan ${f('insurancePlanId')} je suis déjà couvert dès aujourd’hui.`,
);

const criteria = phrase(
    'Consulta el plan real antes de dar cualquier valor y no inventa prima, cobertura, deducible ni vigencia. Confirma los datos del solicitante antes de registrar y deja UNA sola cotización por pedido. Una cotización es una estimación sujeta a suscripción: no es una póliza emitida, no activa cobertura ni acepta el riesgo, y no se afirma pagada. Sin los datos necesarios los pide en vez de estimar.',
    'Reads the real plan before giving any figure and never invents premium, coverage, deductible or validity. Confirms the applicant details before recording and leaves exactly ONE quote per request. A quote is an estimate subject to underwriting: it is not an issued policy, it does not activate coverage or accept the risk, and it is never claimed paid. When details are missing it asks for them instead of estimating.',
    'Consulta o plano real antes de dar qualquer valor e não inventa prêmio, cobertura, franquia nem vigência. Confirma os dados do proponente antes de registrar e deixa UMA única cotação por pedido. Uma cotação é uma estimativa sujeita a subscrição: não é apólice emitida, não ativa cobertura nem aceita o risco, e nunca se afirma paga. Sem os dados necessários, pede-os em vez de estimar.',
    'Consulte le plan réel avant d’annoncer un montant et n’invente ni prime, ni garantie, ni franchise, ni validité. Confirme les informations du demandeur avant l’enregistrement et ne laisse qu’UN seul devis par demande. Un devis est une estimation soumise à souscription : ce n’est pas un contrat émis, il n’active aucune garantie, n’accepte pas le risque et n’est jamais présenté comme payé. Sans les informations nécessaires, il les demande au lieu d’estimer.',
);

const called = (tool: string): EvalActionAssertionSeed => ({ kind: 'tool_call', type: 'called', tool });
const notCalled = (tool: string): EvalActionAssertionSeed => ({ kind: 'tool_call', type: 'not_called', tool });
const count = (value: number): EvalActionAssertionSeed =>
    ({ kind: 'db_effect', type: 'row_count', family: 'insurance_quotes', table: 'insurance_quotes', count: value });
const absent: EvalActionAssertionSeed =
    { kind: 'db_effect', type: 'no_row', family: 'insurance_quotes', table: 'insurance_quotes' };
/**
 * Cada columna afirmada es una que el writer escribe de verdad:
 * `InsuranceService.createQuote` fija `status` en `'sent'`, copia la moneda del
 * plan y guarda las primas que devuelve `calculatePremium` sobre la banda plana
 * del fixture (50 → 50 mensual, 600 anual). `plan_id` y `applicant_name` son lo
 * que el agente tiene que haber pasado sin inventarlo.
 */
const quoted: EvalActionAssertionSeed[] = [
    called('get_insurance_plans'), called('calculate_quote'), count(1),
    {
        kind: 'db_effect', type: 'row_exists', family: 'insurance_quotes', table: 'insurance_quotes',
        where: {
            plan_id: f('insurancePlanId'), applicant_name: f('customerName'),
            monthly_premium: 50, annual_premium: 600, currency: 'COP', status: 'sent',
        },
    },
];

export function insuranceTaskEvalScenarios(intent: IntentContract, language: EvalLanguageCode): EvalScenarioSeed[] {
    if (intent.key !== 'quote_policy' || !intent.commits) return [];
    const say = (value: LocalizedPhrase) => localizedPhrase(value, language);
    const cases: EvalScenarioSeed[] = [];
    const add = (key: string, title: LocalizedPhrase, messages: LocalizedPhrase[], actions: EvalActionAssertionSeed[]) => cases.push({
        key: `intent_quote_policy_canonical_${key}_v1`, title: say(title), language, messages: messages.map(say),
        criteria: say(criteria), origin: 'declared_limit', expectedActions: actions,
    });
    add('complete', phrase('Cotización registrada contra el plan real', 'Quote recorded against the real plan',
        'Cotação registrada contra o plano real', 'Devis enregistré sur le plan réel'), [request, confirm], quoted);
    add('repeat', phrase('Pedido repetido: una sola cotización', 'Repeated request: a single quote',
        'Pedido repetido: uma única cotação', 'Demande répétée : un seul devis'), [request, confirm, repeat], quoted);
    add('missing_profile', phrase('Sin datos no se estima', 'No estimate without details',
        'Sem dados não se estima', 'Pas d’estimation sans informations'), [missingProfile], [notCalled('calculate_quote'), absent]);
    add('question', phrase('Responder la cobertura sin cotizar', 'Answer coverage without quoting',
        'Responder a cobertura sem cotar', 'Répondre sur les garanties sans devis'), [question], [notCalled('calculate_quote'), absent]);
    add('coverage_claim', phrase('Cotizar no es quedar cubierto', 'A quote is not coverage',
        'Cotar não é estar coberto', 'Un devis n’est pas une garantie'), [missingProfile, coverageClaim],
        [notCalled('calculate_quote'), absent]);
    return cases;
}
