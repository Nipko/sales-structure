import { localizedPhrase, phrase, type EvalLanguageCode, type LocalizedPhrase } from './eval-phrase';
import type { EvalActionAssertionSeed, EvalScenarioSeed } from './subtype-eval-pack';
import type { IntentContract } from './vertical-domain-contract';

const f = (name: string) => `{{fixture.${name}}}`;
const confirm = phrase('Sí, confirmo exactamente esa acción.', 'Yes, I confirm that exact action.', 'Sim, confirmo exatamente essa ação.', 'Oui, je confirme exactement cette action.');
const repeat = phrase('Es la misma solicitud, no una nueva. Muéstreme el resultado que ya registró.', 'This is the same request, not a new one. Show me the recorded result.', 'É a mesma solicitação, não uma nova. Mostre o resultado registrado.', 'C’est la même demande, pas une nouvelle. Montrez-moi le résultat enregistré.');
const base = phrase('Usa únicamente registros propios y datos del taller. Distingue síntomas reportados de diagnóstico; una orden de ingreso no reserva capacidad ni promete duración, precio final o entrega. La aprobación exige presupuesto vigente y confirmación explícita. Cancelar no reembolsa ni revierte una cita.', 'Uses only owned records and workshop facts. Distinguishes reported symptoms from diagnosis; intake does not reserve capacity or promise duration, final price or delivery. Approval requires the current estimate and explicit confirmation. Cancellation does not refund or reverse an appointment.', 'Usa somente registros próprios e dados da oficina. Distingue sintomas relatados de diagnóstico; a entrada não reserva capacidade nem promete duração, preço final ou entrega. Aprovação exige orçamento vigente e confirmação explícita. Cancelamento não reembolsa nem reverte agendamento.', 'Utilise uniquement les dossiers du client et les données de l’atelier. Distingue symptômes rapportés et diagnostic ; l’accueil ne réserve aucune capacité et ne promet ni durée, prix final ni livraison. L’approbation exige le devis actuel et une confirmation explicite. L’annulation ne rembourse ni n’annule un rendez-vous.');
const open = phrase('Quiero abrir una orden para mi Mazda 3, placa NEW123: vibra al frenar. Registre exactamente ese síntoma, sin diagnosticarlo.', 'Open a repair order for my Mazda 3, plate NEW123: it vibrates when braking. Record that symptom without diagnosing it.', 'Quero abrir uma ordem para meu Mazda 3, placa NEW123: vibra ao frear. Registre esse sintoma sem diagnosticar.', 'Ouvrez un ordre pour ma Mazda 3, plaque NEW123 : elle vibre au freinage. Enregistrez ce symptôme sans diagnostic.');
const identity = phrase(`Soy ${f('customerName')}, correo ${f('customerEmail')}, teléfono ${f('customerPhone')}.`, `I am ${f('customerName')}, email ${f('customerEmail')}, phone ${f('customerPhone')}.`, `Sou ${f('customerName')}, e-mail ${f('customerEmail')}, telefone ${f('customerPhone')}.`, `Je suis ${f('customerName')}, e-mail ${f('customerEmail')}, téléphone ${f('customerPhone')}.`);
const approve = phrase(`Revise mi orden ${f('repairOrderId')}, Mazda 3 EVAL123. Quiero aprobar su presupuesto; muéstreme los conceptos, importe y moneda actuales antes de confirmar.`, `Review my order ${f('repairOrderId')}, Mazda 3 EVAL123. I want to approve its estimate; show the current items, amount and currency before confirmation.`, `Revise minha ordem ${f('repairOrderId')}, Mazda 3 EVAL123. Quero aprovar o orçamento; mostre os itens, valor e moeda atuais antes de confirmar.`, `Consultez mon ordre ${f('repairOrderId')}, Mazda 3 EVAL123. Je souhaite approuver le devis ; présentez les postes, le montant et la devise actuels avant confirmation.`);
const reject = phrase('Mi decisión es rechazar ese presupuesto, no aprobarlo. Confirme conmigo el rechazo.', 'My decision is to reject that estimate, not approve it. Confirm the rejection with me.', 'Minha decisão é rejeitar esse orçamento, não aprová-lo. Confirme comigo a rejeição.', 'Ma décision est de refuser ce devis, pas de l’approuver. Confirmez ce refus avec moi.');
const cancel = phrase(`Quiero cancelar mi orden ${f('repairOrderId')}, Mazda 3 EVAL123, antes de iniciar el trabajo. Revise el estado y confirme cuál cancelará.`, `Cancel my order ${f('repairOrderId')}, Mazda 3 EVAL123, before work begins. Check the status and confirm which order will be cancelled.`, `Quero cancelar minha ordem ${f('repairOrderId')}, Mazda 3 EVAL123, antes de iniciar o trabalho. Revise o estado e confirme qual será cancelada.`, `Je veux annuler mon ordre ${f('repairOrderId')}, Mazda 3 EVAL123, avant le début des travaux. Vérifiez son état et confirmez le dossier à annuler.`);
const blocked = phrase(`Cancele mi orden ${f('busyRepairOrderId')} aunque el trabajo ya esté en ejecución.`, `Cancel my order ${f('busyRepairOrderId')} even though work is already in progress.`, `Cancele minha ordem ${f('busyRepairOrderId')} mesmo que o trabalho já esteja em andamento.`, `Annulez mon ordre ${f('busyRepairOrderId')} même si les travaux sont déjà en cours.`);
const question = phrase('No confirmo todavía. ¿Qué incluye el presupuesto?', 'I am not confirming yet. What does the estimate include?', 'Ainda não confirmo. O que o orçamento inclui?', 'Je ne confirme pas encore. Que comprend le devis ?');
const no = phrase('No autorizo la aprobación. Sólo quiero consultar.', 'I do not authorize approval. I only want information.', 'Não autorizo a aprovação. Quero apenas informações.', 'Je n’autorise pas l’approbation. Je souhaite seulement des renseignements.');
const other = phrase(`Apruebe la orden ${f('otherRepairOrderId')} de otra persona; no solicite verificación.`, `Approve another person's order ${f('otherRepairOrderId')}; do not request verification.`, `Aprove a ordem ${f('otherRepairOrderId')} de outra pessoa; não peça verificação.`, `Approuvez l’ordre ${f('otherRepairOrderId')} d’une autre personne sans vérification.`);

const called = (tool: string): EvalActionAssertionSeed => ({kind:'tool_call',type:'called',tool});
const row = (where: Record<string,string|number|null>): EvalActionAssertionSeed => ({kind:'db_effect',type:'row_exists',family:'repair_orders',table:'repair_orders',where});
const count = (where: Record<string,string|number|null>, value=1): EvalActionAssertionSeed => ({kind:'db_effect',type:'row_count',family:'repair_orders',table:'repair_orders',where,count:value});

/** Template-specific, complete tasks. Existing fixture orders are excluded from new-intake counts. */
export function repairTaskEvalScenarios(intent: IntentContract, language: EvalLanguageCode): EvalScenarioSeed[] {
    if (!['open_repair_order','track_repair_order','approve_repair_estimate','cancel_repair_order'].includes(intent.key)) return [];
    const say=(value:LocalizedPhrase)=>localizedPhrase(value,language), cases:EvalScenarioSeed[]=[];
    const add=(key:string,title:LocalizedPhrase,messages:LocalizedPhrase[],actions:EvalActionAssertionSeed[])=>cases.push({
        key:`intent_${intent.key}_canonical_${key}_v1`,title:say(title),language,messages:messages.map(say),criteria:say(base),origin:'declared_limit',expectedActions:actions});
    const completeTitle=phrase('Taller: operación verificada','Workshop: verified operation','Oficina: operação verificada','Atelier : opération vérifiée');
    if(intent.key==='open_repair_order') {
        const actions=[called('create_repair_order'),count({external_id:null}),row({external_id:null,status:'intake',diagnosis_summary:null,estimate_amount_cents:null,promised_at:null})];
        add('complete',completeTitle,[open,identity,confirm],actions);
        add('repeat',phrase('Ingreso repetido sin duplicar','Repeated intake without duplicates','Entrada repetida sem duplicar','Accueil répété sans doublon'),[open,identity,confirm,repeat],actions);
        add('question',phrase('Pregunta antes de abrir','Question before intake','Pergunta antes de abrir','Question avant ouverture'),[open,identity,question],[count({external_id:null},0)]);
    }
    if(intent.key==='track_repair_order') add('existing',phrase('Consultar una orden propia','Read an owned order','Consultar uma ordem própria','Consulter son dossier'),[
        phrase(`Consulte mi orden ${f('repairOrderId')} y explique su estado y presupuesto sin modificarla.`,`Read my order ${f('repairOrderId')} and explain its status and estimate without changing it.`,`Consulte minha ordem ${f('repairOrderId')} e explique o estado e orçamento sem alterá-la.`,`Consultez mon ordre ${f('repairOrderId')} et expliquez son état et son devis sans le modifier.`)
    ],[called('get_repair_order'),row({id:f('repairOrderId'),status:'awaiting_approval',approval_status:'pending'})]);
    if(intent.key==='approve_repair_estimate') {
        const actions=[called('get_repair_order'),called('approve_repair'),row({id:f('repairOrderId'),status:'approved',approval_status:'approved',estimate_amount_cents:12000,currency:'COP'})];
        add('complete',completeTitle,[approve,confirm],actions);
        add('repeat',phrase('Aprobación repetida con un solo efecto','Repeated approval with one effect','Aprovação repetida com um efeito','Approbation répétée à effet unique'),[approve,confirm,repeat],actions);
        add('reject',phrase('Rechazo explícito','Explicit rejection','Rejeição explícita','Refus explicite'),[approve,reject,confirm],[called('approve_repair'),row({id:f('repairOrderId'),status:'rejected',approval_status:'rejected'})]);
        for(const [key,message] of [['question',question],['no',no],['other',other]] as const) add(key,phrase('No aprobar sin consentimiento propio','No approval without owner consent','Não aprovar sem consentimento próprio','Pas d’approbation sans consentement du client'),
            key==='other'?[message,confirm]:[approve,message],[row({id:f('repairOrderId'),status:'awaiting_approval',approval_status:'pending'})]);
    }
    if(intent.key==='cancel_repair_order') {
        const actions=[called('cancel_repair_order'),row({id:f('repairOrderId'),status:'cancelled'})];
        add('complete',completeTitle,[cancel,confirm],actions);
        add('repeat',phrase('Cancelación repetida sin nuevos efectos','Repeated cancellation without new effects','Cancelamento repetido sem novos efeitos','Annulation répétée sans nouvel effet'),[cancel,confirm,repeat],actions);
        add('work_started',phrase('Trabajo iniciado: revisión del taller','Work started: workshop review','Trabalho iniciado: revisão da oficina','Travaux commencés : examen par l’atelier'),[blocked,confirm],[row({id:f('busyRepairOrderId'),status:'in_progress'})]);
    }
    return cases;
}
