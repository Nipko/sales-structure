/**
 * Two different objects may never share a label.
 *
 * `/admin/pipeline` is the CRM Kanban — opportunities with stages. Vertical
 * definitions relabelled it with the name of a REAL operational object in eight
 * industries: Turismo called it "Reservas" while the actual stays live in
 * `property_bookings`, Servicios del hogar called it "Solicitudes" while
 * `service_requests` is a different table, Seguros called it "Cotizaciones"
 * next to a real `insurance_quotes`.
 *
 * The cost is not cosmetic. An agent looking for today's reservations opens a
 * sales funnel; the object they need is somewhere else, and often behind a
 * permission they do not have. The audit found this by trying to find a booking
 * in Turismo and failing — which is what prompted the whole review.
 *
 * The rule: the CRM entry must read as COMMERCIAL vocabulary. It may keep
 * vertical flavour (`Negociaciones`, `Ventas`, `Seguimiento`) as long as no
 * operational object in that vertical answers to the same word.
 */

/**
 * Words the CRM funnel may be called, per locale.
 *
 * Deliberately an allowlist, not a denylist of operational nouns: a denylist
 * grows every time a vertical gains an object, and the day it lags is the day a
 * collision ships.
 */
export const CRM_FUNNEL_LABELS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    es: ['Oportunidades', 'Pipeline', 'Embudo', 'Negociaciones', 'Ventas', 'Seguimiento', 'Prospectos'],
    en: ['Opportunities', 'Pipeline', 'Funnel', 'Deals', 'Sales', 'Follow-up', 'Patient Journey', 'Prospects'],
    pt: ['Oportunidades', 'Pipeline', 'Funil', 'Negociações', 'Vendas', 'Acompanhamento', 'Prospectos'],
    fr: ['Opportunités', 'Pipeline', 'Tunnel', 'Négociations', 'Ventes', 'Suivi', 'Prospects'],
});

/**
 * Words that name a real operational object somewhere in the platform.
 *
 * Used by the contract test to prove the allowlist above cannot collide — not
 * to gate at runtime. Kept as evidence of what each word already means.
 */
export const OPERATIONAL_OBJECT_LABELS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    es: ['Reservas', 'Reservaciones', 'Citas', 'Pedidos', 'Órdenes', 'Inscripciones', 'Matrículas',
        'Solicitudes', 'Cotizaciones', 'Casos', 'Sesiones', 'Clases', 'Estadías', 'Alquileres',
        'Trabajos', 'Visitas', 'Pólizas', 'Siniestros'],
    en: ['Reservations', 'Bookings', 'Appointments', 'Orders', 'Enrollments', 'Applications',
        'Quotes', 'Cases', 'Sessions', 'Classes', 'Stays', 'Rentals', 'Jobs', 'Visits',
        'Policies', 'Claims'],
    pt: ['Reservas', 'Agendamentos', 'Pedidos', 'Inscrições', 'Matrículas', 'Solicitações',
        'Cotações', 'Casos', 'Sessões', 'Aulas', 'Estadias', 'Aluguéis', 'Trabalhos', 'Visitas'],
    fr: ['Réservations', 'Rendez-vous', 'Commandes', 'Inscriptions', 'Demandes', 'Devis',
        'Dossiers', 'Séances', 'Cours', 'Séjours', 'Locations', 'Travaux', 'Visites'],
});

/** Whether a proposed CRM label reads as commercial rather than operational. */
export function isCrmFunnelLabel(locale: string, label: string): boolean {
    const allowed = CRM_FUNNEL_LABELS[locale] ?? CRM_FUNNEL_LABELS.es;
    return allowed.some(candidate => candidate.toLowerCase() === String(label || '').trim().toLowerCase());
}

/** Whether a label names an operational object in this locale. */
export function isOperationalObjectLabel(locale: string, label: string): boolean {
    const operational = OPERATIONAL_OBJECT_LABELS[locale] ?? OPERATIONAL_OBJECT_LABELS.es;
    return operational.some(candidate => candidate.toLowerCase() === String(label || '').trim().toLowerCase());
}
