/** Public service modality/location questions need current service terms. */
export function requiresServiceLocationLookup(query: string): boolean {
    const text = String(query || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/\b(?:inmuebl\w*|propiedad\w*|apartament\w*|listing\w*|property|apartment\w*|imove\w*|appartement\w*|logement\w*|tours?|paquetes?|packages?|pacotes?|forfaits?|hotel\w*|alojamiento\w*)\b/.test(text)) return false;
    if (/\b(?:mis?\s+citas?|my\s+appointments?|minha\s+consulta|mon\s+rendez[\s-]vous)\b/.test(text)) return false;
    if (/\b(?:citas?|appointments?|consultas?|rendez[\s-]vous)\b/.test(text)
        && /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/.test(text)) return false;
    const modality = /\b(?:modalid\w*|modalit\w*|presencial|in[\s-]person|en[\s-]linea|online|remote|virtual|a[\s-]distancia)\b/.test(text);
    const service = /\b(?:servic\w*|citas?|appointments?|atendiment\w*|prestati\w*)\b/.test(text);
    const location = /\b(?:direcci\w*|address\w*|endereco\w*|adresse\w*|ubicaci\w*|location|lieu|domicilio)\b/.test(text);
    return modality || (service && location);
}
