import type { OperationalNoticeKind } from './operational-notice.contracts';
const TEXT: Record<string, Record<OperationalNoticeKind, string>> = {
    es: {
        'appointment.payment_confirmed': 'Recibimos tu pago y tu cita quedó confirmada.',
        'appointment.payment_review': 'Hay un pago de una cita que requiere revisión de disponibilidad. Revisa la cita antes de reprogramar o devolver el pago.',
        'gym.waitlist_promoted': 'Se liberó un cupo y tu reserva de clase quedó confirmada. Se aplicaron los créditos correspondientes.',
        'education.waitlist_promoted': 'Se liberó un cupo y tu inscripción quedó registrada con las condiciones que aceptaste. Este aviso no confirma un pago.',
        'education.waitlist_review': 'Las condiciones del curso cambiaron mientras estabas en lista de espera. Necesitamos que revises y aceptes las condiciones actuales antes de asignarte un cupo. Este aviso no realiza cobros ni asigna un cupo.',
    },
    en: {
        'appointment.payment_confirmed': 'We received your payment and your appointment is confirmed.',
        'appointment.payment_review': 'An appointment payment needs an availability review. Review the appointment before rescheduling or refunding the payment.',
        'gym.waitlist_promoted': 'A spot became available and your class booking is confirmed. The applicable credits were used.',
        'education.waitlist_promoted': 'A seat became available and your enrollment is registered under the terms you accepted. This notice does not confirm a payment.',
        'education.waitlist_review': 'The course terms changed while you were on the waitlist. Please review and accept the current terms before a seat can be assigned. This notice does not charge you or assign a seat.',
    },
    pt: {
        'appointment.payment_confirmed': 'Recebemos seu pagamento e seu agendamento está confirmado.',
        'appointment.payment_review': 'Um pagamento de agendamento exige revisão de disponibilidade. Revise o agendamento antes de remarcar ou devolver o pagamento.',
        'gym.waitlist_promoted': 'Uma vaga ficou disponível e sua reserva da aula está confirmada. Os créditos correspondentes foram utilizados.',
        'education.waitlist_promoted': 'Uma vaga ficou disponível e sua inscrição foi registrada nas condições aceitas. Este aviso não confirma um pagamento.',
        'education.waitlist_review': 'As condições do curso mudaram enquanto você estava na lista de espera. Revise e aceite as condições atuais antes da atribuição de uma vaga. Este aviso não realiza cobranças nem atribui uma vaga.',
    },
    fr: {
        'appointment.payment_confirmed': 'Nous avons reçu votre paiement et votre rendez-vous est confirmé.',
        'appointment.payment_review': 'Un paiement de rendez-vous nécessite une vérification des disponibilités. Vérifiez le rendez-vous avant de le déplacer ou de rembourser le paiement.',
        'gym.waitlist_promoted': 'Une place est disponible et votre réservation au cours est confirmée. Les crédits correspondants ont été utilisés.',
        'education.waitlist_promoted': 'Une place est disponible et votre inscription est enregistrée selon les conditions acceptées. Cet avis ne confirme pas un paiement.',
        'education.waitlist_review': 'Les conditions du cours ont changé pendant votre attente. Vérifiez et acceptez les conditions actuelles avant l’attribution d’une place. Cet avis ne débite aucun montant et n’attribue aucune place.',
    },
};
export function operationalNoticeText(kind: OperationalNoticeKind, lang: string | undefined, facts: { name?: string; when?: string }): string {
    const text = (TEXT[String(lang || 'es').slice(0, 2).toLowerCase()] || TEXT.es)[kind];
    return [text, facts.name, facts.when].filter(Boolean).join('\n');
}
