import { localizedPhrase, phrase, type EvalLanguageCode, type LocalizedPhrase } from './eval-phrase';
import type { EvalActionAssertionSeed, EvalScenarioSeed } from './subtype-eval-pack';
import type { IntentContract } from './vertical-domain-contract';

const interest = phrase(
    'Me interesa el plan anual para un equipo de diez personas. Regístrelo para que ventas pueda ayudarme.',
    'I am interested in the annual plan for a ten-person team. Record it so sales can help me.',
    'Tenho interesse no plano anual para uma equipe de dez pessoas. Registre para que vendas possa me ajudar.',
    'Le forfait annuel pour une équipe de dix personnes m’intéresse. Consignez-le pour que l’équipe commerciale puisse m’aider.',
);
const followUp = phrase(
    'No puedo seguir ahora. Cree una tarea para que el equipo me llame sobre el plan anual.',
    'I cannot continue now. Create a task for the team to call me about the annual plan.',
    'Não posso continuar agora. Crie uma tarefa para a equipe me ligar sobre o plano anual.',
    'Je ne peux pas continuer maintenant. Créez une tâche pour que l’équipe m’appelle au sujet du forfait annuel.',
);
const repeat = phrase(
    'Es la misma solicitud, no cree otro registro.',
    'It is the same request; do not create another record.',
    'É a mesma solicitação; não crie outro registro.',
    'C’est la même demande ; ne créez pas un autre enregistrement.',
);
const completeTitle = phrase(
    'Escritura CRM verificada', 'Verified CRM write', 'Escrita no CRM verificada', 'Écriture CRM vérifiée',
);
const repeatTitle = phrase(
    'Repetición CRM sin duplicados', 'CRM retry without duplicates', 'Repetição no CRM sem duplicatas', 'Répétition CRM sans doublon',
);
const CRITERIA: Record<'capture_interest' | 'request_follow_up', LocalizedPhrase> = {
    capture_interest: phrase(
        'Crea o reutiliza el lead del contacto actual, registra sólo el interés que el cliente expresó y crea una única oportunidad abierta. No inventa valor, etapa, calificación ni promesa comercial.',
        'Creates or reuses the current contact lead, records only the interest the customer stated and creates one open opportunity. It does not invent value, stage, qualification or a commercial promise.',
        'Cria ou reutiliza o lead do contato atual, registra apenas o interesse declarado pelo cliente e cria uma única oportunidade aberta. Não inventa valor, etapa, qualificação nem promessa comercial.',
        'Crée ou réutilise le prospect du contact actuel, consigne uniquement l’intérêt exprimé et crée une seule opportunité ouverte. Il n’invente ni valeur, ni étape, ni qualification, ni promesse commerciale.',
    ),
    request_follow_up: phrase(
        'Crea o reutiliza el lead del contacto actual y deja una sola tarea pendiente con el motivo solicitado. No inventa fecha, responsable ni resultado del seguimiento.',
        'Creates or reuses the current contact lead and leaves one pending task with the requested reason. It does not invent a date, owner or follow-up outcome.',
        'Cria ou reutiliza o lead do contato atual e deixa uma única tarefa pendente com o motivo solicitado. Não inventa data, responsável nem resultado do acompanhamento.',
        'Crée ou réutilise le prospect du contact actuel et laisse une seule tâche en attente avec le motif demandé. Il n’invente ni date, ni responsable, ni résultat du suivi.',
    ),
};

const called = (tool: string): EvalActionAssertionSeed => ({ kind: 'tool_call', type: 'called', tool });
const row = (family: string, table: string, type: 'row_exists' | 'row_count', count?: number): EvalActionAssertionSeed => ({
    kind: 'db_effect', type, family, table, ...(count === undefined ? {} : { count }),
});

/** Positive operational evidence for the horizontal CRM missions shared by all profiles. */
export function crmTaskEvalScenarios(intent: IntentContract, language: EvalLanguageCode): EvalScenarioSeed[] {
    if (intent.key !== 'capture_interest' && intent.key !== 'request_follow_up') return [];
    const key = intent.key;
    const say = (value: LocalizedPhrase) => localizedPhrase(value, language);
    const writer = key === 'capture_interest' ? 'create_crm_opportunity' : 'create_follow_up_task';
    const family = key === 'capture_interest' ? 'crm_opportunities' : 'crm_tasks';
    const table = key === 'capture_interest' ? 'opportunities' : 'tasks';
    const opener = say(key === 'capture_interest' ? interest : followUp);
    const effects = (type: 'row_exists' | 'row_count'): EvalActionAssertionSeed[] => [
        called('ensure_crm_lead'),
        ...(key === 'capture_interest' ? [called('record_contact_interest')] : []),
        called(writer),
        row('crm_leads', 'leads', 'row_count', 1),
        row(family, table, type, type === 'row_count' ? 1 : undefined),
    ];
    return [
        {
            key: `intent_${key}_canonical_complete_v1`,
            title: `${key} — ${say(completeTitle)}`,
            language,
            messages: [opener],
            criteria: say(CRITERIA[key]),
            origin: 'declared_limit',
            expectedActions: effects('row_exists'),
        },
        {
            key: `intent_${key}_canonical_repeat_v1`,
            title: `${key} — ${say(repeatTitle)}`,
            language,
            messages: [opener, say(repeat)],
            criteria: say(CRITERIA[key]),
            origin: 'declared_limit',
            expectedActions: effects('row_count'),
        },
    ];
}
