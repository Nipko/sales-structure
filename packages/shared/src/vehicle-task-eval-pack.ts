import { phrase, localizedPhrase, type EvalLanguageCode, type LocalizedPhrase } from './eval-phrase';
import type { EvalActionAssertionSeed, EvalScenarioSeed } from './subtype-eval-pack';
import type { IntentContract } from './vertical-domain-contract';

const f = (key: string) => `{{fixture.${key}}}`;
const request = (vehicle = 'vehicleId', time = 'time', service = 'serviceId') => phrase(
    `Quiero una prueba de manejo del vehículo ${f(vehicle)}, con el servicio ${f(service)} y el asesor ${f('staffUserId')}, el ${f('date')} a las ${f(time)}. Soy ${f('customerName')}, teléfono ${f('customerPhone')}, correo ${f('customerEmail')}. Revise vehículo, servicio y disponibilidad antes de pedirme confirmación.`,
    `I want a test drive of vehicle ${f(vehicle)}, with service ${f(service)} and staff ${f('staffUserId')}, on ${f('date')} at ${f(time)}. I am ${f('customerName')}, phone ${f('customerPhone')}, email ${f('customerEmail')}. Check the vehicle, service and availability before asking for confirmation.`,
    `Quero testar o veículo ${f(vehicle)}, com o serviço ${f(service)} e o assessor ${f('staffUserId')}, em ${f('date')} às ${f(time)}. Sou ${f('customerName')}, telefone ${f('customerPhone')}, e-mail ${f('customerEmail')}. Verifique veículo, serviço e disponibilidade antes de pedir confirmação.`,
    `Je veux essayer le véhicule ${f(vehicle)}, avec le service ${f(service)} et le conseiller ${f('staffUserId')}, le ${f('date')} à ${f(time)}. Je suis ${f('customerName')}, téléphone ${f('customerPhone')}, courriel ${f('customerEmail')}. Vérifiez véhicule, service et disponibilité avant de demander confirmation.`,
);
const yes = phrase('Sí, confirmo el vehículo, asesor, servicio, horario, precio y condiciones que acaba de mostrar.',
    'Yes, I confirm the vehicle, staff, service, time, price and terms you just showed.',
    'Sim, confirmo o veículo, assessor, serviço, horário, preço e condições apresentados.',
    'Oui, je confirme le véhicule, conseiller, service, horaire, prix et conditions présentés.');
const criteria = phrase(
    'Consulta vehículo, servicio y disponibilidad; confirma las condiciones exactas antes de ejecutar schedule_test_drive una sola vez. Consulta y modifica únicamente la cita del contacto. Distingue pendiente, pendiente de pago y confirmada; no afirma pago, entrega de vehículo ni confirmación de calendario externo. Usa el horario corregido y explica rechazos. La identidad verificada del fixture es sintética: este escenario no certifica un OTP real.',
    'Checks the vehicle, service and availability; confirms exact terms before executing schedule_test_drive once. Reads and changes only the contact’s appointment. Distinguishes pending, pending payment and confirmed; never claims payment, vehicle delivery or external calendar confirmation. Uses the corrected time and explains refusals. The fixture identity is synthetic: this scenario does not certify a real OTP.',
    'Consulta veículo, serviço e disponibilidade; confirma as condições exatas antes de executar schedule_test_drive uma vez. Consulta e altera somente o agendamento do contato. Distingue pendente, pagamento pendente e confirmado; não afirma pagamento, entrega do veículo nem confirmação de calendário externo. Usa o horário corrigido e explica recusas. A identidade do fixture é sintética: o cenário não certifica um OTP real.',
    'Consulte véhicule, service et disponibilité ; confirme les conditions exactes avant une seule exécution de schedule_test_drive. Consulte et modifie uniquement le rendez-vous du contact. Distingue attente, paiement en attente et confirmation ; ne prétend ni paiement, ni livraison du véhicule, ni confirmation du calendrier externe. Utilise l’horaire corrigé et explique les refus. L’identité de test est synthétique : ce scénario ne certifie pas un véritable OTP.',
);
const called = (tool: string): EvalActionAssertionSeed => ({ kind: 'tool_call', type: 'called', tool });
const count = (value: number): EvalActionAssertionSeed => ({ kind: 'db_effect', type: 'row_count', family: 'appointments', table: 'appointments', count: value });
const effects = (status = 'confirmed', time = 'time', service = 'serviceId'): EvalActionAssertionSeed[] => [
    ...['search_vehicles', 'get_vehicle_details', 'list_services', 'check_availability', 'schedule_test_drive'].map(called), count(1),
    { kind: 'db_effect', type: 'row_exists', family: 'appointments', table: 'appointments', where: {
        vehicle_id: f('vehicleId'), vehicle_terms_id: f('vehicleId'), service_terms_id: f(service),
        service_id: f(service), assigned_to: f('staffUserId'), status,
        start_at: `${f('date')}T${f(time)}:00`, customer_name: f('customerName'),
    } },
];

export function vehicleTaskEvalScenarios(intent: IntentContract, language: EvalLanguageCode): EvalScenarioSeed[] {
    if (intent.key !== 'schedule_test_drive' || !intent.commits) return [];
    const cases: EvalScenarioSeed[] = [], say = (value: LocalizedPhrase) => localizedPhrase(value, language);
    const add = (key: string, title: LocalizedPhrase, messages: LocalizedPhrase[], actions: EvalActionAssertionSeed[]) => cases.push({
        key: `intent_schedule_test_drive_canonical_${key}_v1`, title: say(title), language, messages: messages.map(say),
        criteria: say(criteria), origin: 'declared_limit', expectedActions: actions,
    });
    add('complete', phrase('Prueba de manejo con condiciones verificadas', 'Test drive with verified terms', 'Teste de veículo com condições verificadas', 'Essai du véhicule aux conditions vérifiées'), [request(), yes], effects());
    add('pending_payment', phrase('Conservar el anticipo pendiente', 'Preserve the pending deposit', 'Preservar o sinal pendente', 'Conserver l’acompte en attente'),
        [request('vehicleId', 'time', 'vehicleDepositServiceId'), yes], [...effects('pending_payment', 'time', 'vehicleDepositServiceId'),
            { kind: 'db_effect', type: 'row_exists', family: 'appointments', table: 'appointments', where: {
                vehicle_id: f('vehicleId'), service_id: f('vehicleDepositServiceId'), status: 'pending_payment', payment_status: 'pending', amount_due: 2.5,
            } }]);
    add('repeat', phrase('Consultar sin duplicar la reserva', 'Check without duplicating the booking', 'Consultar sem duplicar a reserva', 'Consulter sans dupliquer la réservation'), [request(), yes,
        phrase('Es la misma reserva, no otra. Consulte su estado.', 'This is the same booking, not another. Check its status.', 'É a mesma reserva, não outra. Consulte o estado.', 'C’est la même réservation, pas une autre. Consultez son état.')], [...effects(), called('list_customer_appointments')]);
    add('correction', phrase('Corregir horario antes de aceptar', 'Correct time before accepting', 'Corrigir horário antes de aceitar', 'Corriger l’horaire avant acceptation'), [request(),
        phrase(`Todavía no confirmo. Cambie la hora a ${f('recoveryTime')} y muestre las nuevas condiciones.`, `I am not confirming yet. Change the time to ${f('recoveryTime')} and show the new terms.`, `Ainda não confirmo. Mude o horário para ${f('recoveryTime')} e mostre as novas condições.`, `Je ne confirme pas encore. Déplacez l’horaire à ${f('recoveryTime')} et présentez les nouvelles conditions.`), yes], effects('confirmed', 'recoveryTime'));
    add('reschedule', phrase('Reprogramar la misma prueba', 'Reschedule the same test drive', 'Reagendar o mesmo teste', 'Reporter le même essai'), [request(), yes,
        phrase(`Consulte mi cita y cámbiela a ${f('recoveryTime')} del mismo día. Revise la disponibilidad y pida confirmación.`, `Read my appointment and move it to ${f('recoveryTime')} on the same day. Check availability and ask for confirmation.`, `Consulte meu agendamento e mude para ${f('recoveryTime')} do mesmo dia. Verifique a disponibilidade e peça confirmação.`, `Consultez mon rendez-vous et déplacez-le à ${f('recoveryTime')} le même jour. Vérifiez la disponibilité et demandez confirmation.`), yes], [...effects('confirmed', 'recoveryTime'), called('get_appointment_details'), called('reschedule_appointment')]);
    add('cancel', phrase('Cancelar la prueba propia', 'Cancel the owned test drive', 'Cancelar o próprio teste', 'Annuler son propre essai'), [request(), yes,
        phrase('Consulte y cancele únicamente esa prueba de manejo. Confirme cuál es primero.', 'Read and cancel only that test drive. Confirm which appointment first.', 'Consulte e cancele somente esse teste. Confirme primeiro qual agendamento.', 'Consultez et annulez uniquement cet essai. Identifiez d’abord le rendez-vous.'),
        phrase('Sí, confirmo cancelar esa cita; no solicito un reembolso.', 'Yes, I confirm cancellation of that appointment; I am not requesting a refund.', 'Sim, confirmo cancelar esse agendamento; não solicito reembolso.', 'Oui, je confirme l’annulation de ce rendez-vous ; je ne demande pas de remboursement.')], [...effects('cancelled'), called('get_appointment_details'), called('cancel_appointment')]);
    for (const [key, reply] of [
        ['no', phrase('No autorizo esta reserva.', 'I do not authorize this booking.', 'Não autorizo esta reserva.', 'Je n’autorise pas cette réservation.')],
        ['question', phrase('Todavía no confirmo. ¿Qué incluye el servicio?', 'I am not confirming yet. What does the service include?', 'Ainda não confirmo. O que inclui o serviço?', 'Je ne confirme pas encore. Que comprend le service ?')],
    ] as const) add(key, phrase('Sin reserva antes de aceptar', 'No booking before acceptance', 'Sem reserva antes da aceitação', 'Aucune réservation avant acceptation'), [request(), reply], [count(0)]);
    add('recovery', phrase('Recuperar tras vehículo no disponible', 'Recover after an unavailable vehicle', 'Recuperar após veículo indisponível', 'Reprendre après un véhicule indisponible'), [request('unavailableVehicleId'),
        phrase('Entiendo que ese vehículo no está disponible. Cambio mi solicitud:', 'I understand that vehicle is unavailable. I am changing my request:', 'Entendi que esse veículo está indisponível. Vou mudar minha solicitação:', 'Je comprends que ce véhicule est indisponible. Je remplace ma demande :'), request(), yes], effects());
    return cases;
}
