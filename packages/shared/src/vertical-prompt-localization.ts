export type VerticalPromptLanguage = 'es' | 'en' | 'pt' | 'fr';

type LocalizedPhrase = Readonly<Record<VerticalPromptLanguage, string>>;

const phrase = (es: string, en: string, pt: string, fr: string): LocalizedPhrase =>
    Object.freeze({ es, en, pt, fr });

/**
 * Reviewed vocabulary shared by every subtype. Source registries keep stable
 * Spanish keys for audit; live prompts receive the equivalent phrase in the
 * customer's language. A missing key is omitted and reported, never silently
 * injected in Spanish.
 */
export const VERTICAL_PROMPT_PHRASES: Readonly<Record<string, LocalizedPhrase>> = Object.freeze({
    'puede tomar el interés y pasarlo a una persona': phrase('puede tomar el interés y pasarlo a una persona', 'can capture the customer’s interest and hand it to a person', 'pode registrar o interesse do cliente e encaminhá-lo a uma pessoa', 'peut recueillir l’intérêt du client et le transmettre à une personne'),
    'puede preguntar lo que el negocio declaró como criterio': phrase('puede preguntar lo que el negocio declaró como criterio', 'can ask for the criteria declared by the business', 'pode perguntar os critérios declarados pela empresa', 'peut demander les critères déclarés par l’entreprise'),
    'puede informar precios que el negocio cargó': phrase('puede informar precios que el negocio cargó', 'can provide prices entered by the business', 'pode informar os preços cadastrados pela empresa', 'peut communiquer les prix saisis par l’entreprise'),
    'puede coordinar el siguiente paso usando los registros que el negocio conectó': phrase(
        'puede coordinar el siguiente paso usando los registros que el negocio conectó',
        'can coordinate the next step using records from systems connected by the business',
        'pode coordenar a próxima etapa usando registros dos sistemas conectados pela empresa',
        'peut coordonner l’étape suivante à partir des données des systèmes connectés par l’entreprise',
    ),
    'puede ejecutar operaciones nativas que el contrato efectivo autorizó': phrase(
        'puede ejecutar operaciones nativas que el contrato efectivo autorizó',
        'can perform native operations authorised by the effective contract',
        'pode executar operações nativas autorizadas pelo contrato efetivo',
        'peut exécuter les opérations natives autorisées par le contrat effectif',
    ),
    'puede ejecutar operaciones que el sistema conectado confirmó y el contrato efectivo autorizó': phrase(
        'puede ejecutar operaciones que el sistema conectado confirmó y el contrato efectivo autorizó',
        'can perform operations confirmed by the connected system and authorised by the effective contract',
        'pode executar operações confirmadas pelo sistema conectado e autorizadas pelo contrato efetivo',
        'peut exécuter les opérations confirmées par le système connecté et autorisées par le contrat effectif',
    ),

    'expediente clinico': phrase('expediente clinico', 'medical record', 'prontuário clínico', 'dossier médical'),
    'diagnostico': phrase('diagnostico', 'diagnosis', 'diagnóstico', 'diagnostic'),
    'prescripcion': phrase('prescripcion', 'prescription', 'prescrição', 'prescription'),
    'promesa de resultado': phrase('promesa de resultado', 'promise of an outcome', 'promessa de resultado', 'promesse de résultat'),
    'avaluo': phrase('avaluo', 'appraisal', 'avaliação', 'évaluation'),
    'cierre de escritura': phrase('cierre de escritura', 'deed closing', 'assinatura da escritura', 'signature de l’acte'),
    'obra como contratista': phrase('obra como contratista', 'construction work as a contractor', 'obra como empreiteiro', 'travaux en tant qu’entrepreneur'),
    'venta de unidades': phrase('venta de unidades', 'unit sales', 'venda de unidades', 'vente de lots'),
    'diseño firmado': phrase('diseño firmado', 'signed design', 'projeto assinado', 'conception signée'),
    'licenciamiento automatico': phrase('licenciamiento automatico', 'automatic licensing', 'licenciamento automático', 'délivrance automatique de licences'),
    'POS/KDS propio': phrase('POS/KDS propio', 'its own POS/KDS', 'POS/KDS próprio', 'son propre POS/KDS'),
    'contabilidad': phrase('contabilidad', 'accounting', 'contabilidade', 'comptabilité'),
    'DMS propio': phrase('DMS propio', 'its own DMS', 'DMS próprio', 'son propre DMS'),
    'diagnostico mecanico': phrase('diagnostico mecanico', 'mechanical diagnosis', 'diagnóstico mecânico', 'diagnostic mécanique'),
    'PMS hotelero propio': phrase('PMS hotelero propio', 'its own hotel PMS', 'PMS hoteleiro próprio', 'son propre PMS hôtelier'),
    'emision de tiquetes': phrase('emision de tiquetes', 'ticket issuance', 'emissão de bilhetes', 'émission de billets'),
    'LMS propio': phrase('LMS propio', 'its own LMS', 'LMS próprio', 'son propre LMS'),
    'decision de admision': phrase('decision de admision', 'admission decision', 'decisão de admissão', 'décision d’admission'),
    'asesoria de inversion': phrase('asesoria de inversion', 'investment advice', 'assessoria de investimento', 'conseil en investissement'),
    'decision crediticia': phrase('decision crediticia', 'credit decision', 'decisão de crédito', 'décision de crédit'),
    'core financiero': phrase('core financiero', 'core financial system', 'sistema financeiro central', 'système financier central'),
    'wallet': phrase('wallet', 'digital wallet', 'carteira digital', 'portefeuille numérique'),
    'inversion': phrase('inversion', 'investment', 'investimento', 'investissement'),
    'credito': phrase('credito', 'credit', 'crédito', 'crédit'),
    'remesas': phrase('remesas', 'money transfers', 'remessas', 'transferts de fonds'),
    'custodia de fondos': phrase('custodia de fondos', 'custody of funds', 'custódia de fundos', 'conservation de fonds'),
    'asesoria juridica': phrase('asesoria juridica', 'legal advice', 'assessoria jurídica', 'conseil juridique'),
    'representacion': phrase('representacion', 'legal representation', 'representação jurídica', 'représentation juridique'),
    'declaracion fiscal': phrase('declaracion fiscal', 'tax return', 'declaração fiscal', 'déclaration fiscale'),
    'ERP propio': phrase('ERP propio', 'its own ERP', 'ERP próprio', 'son propre ERP'),
    'ticketing propio': phrase('ticketing propio', 'its own ticketing system', 'sistema de tickets próprio', 'son propre système de tickets'),
    'entrega de software': phrase('entrega de software', 'software delivery', 'entrega de software', 'livraison de logiciel'),
    'entrega de proyectos': phrase('entrega de proyectos', 'project delivery', 'entrega de projetos', 'livraison de projets'),
    'acceso remoto no autorizado': phrase('acceso remoto no autorizado', 'unauthorized remote access', 'acesso remoto não autorizado', 'accès à distance non autorisé'),
    'RMM propio': phrase('RMM propio', 'its own RMM', 'RMM próprio', 'son propre RMM'),
    'historia clinica': phrase('historia clinica', 'medical record', 'prontuário clínico', 'dossier médical'),
    'diagnostico veterinario': phrase('diagnostico veterinario', 'veterinary diagnosis', 'diagnóstico veterinário', 'diagnostic vétérinaire'),
    'garantia de conducta': phrase('garantia de conducta', 'behaviour guarantee', 'garantia de comportamento', 'garantie de comportement'),
    'prescripcion de ejercicio': phrase('prescripcion de ejercicio', 'exercise prescription', 'prescrição de exercícios', 'prescription d’exercice'),
    'promesa de resultado fisico': phrase('promesa de resultado fisico', 'promise of a physical result', 'promessa de resultado físico', 'promesse de résultat physique'),
    'suscripcion': phrase('suscripcion', 'subscription', 'assinatura', 'abonnement'),
    'ajuste de siniestro': phrase('ajuste de siniestro', 'claim adjustment', 'regulação de sinistro', 'règlement de sinistre'),
    'cobertura vinculante': phrase('cobertura vinculante', 'binding coverage', 'cobertura vinculante', 'couverture engageante'),
    'garantia de obra': phrase('garantia de obra', 'workmanship guarantee', 'garantia da obra', 'garantie des travaux'),
    'permisos': phrase('permisos', 'permits', 'licenças', 'autorisations'),
    'DAM propio': phrase('DAM propio', 'its own DAM', 'DAM próprio', 'son propre DAM'),
    'cesion de derechos': phrase('cesion de derechos', 'rights assignment', 'cessão de direitos', 'cession de droits'),
    'servicio fotografico implicito': phrase('servicio fotografico implicito', 'implied photography service', 'serviço fotográfico implícito', 'service photographique implicite'),
    'pagos sin proveedor': phrase('pagos sin proveedor', 'payments without a provider', 'pagamentos sem provedor', 'paiements sans prestataire'),
    'contrato legal': phrase('contrato legal', 'legal contract', 'contrato jurídico', 'contrat juridique'),
    'tienda automatica': phrase('tienda automatica', 'automatic storefront', 'loja automática', 'boutique automatique'),
    'cualquier objeto no declarado': phrase('cualquier objeto no declarado', 'any undeclared object', 'qualquer objeto não declarado', 'tout objet non déclaré'),

    'paciente': phrase('paciente', 'patient', 'paciente', 'patient'),
    'consulta médica': phrase('consulta médica', 'medical consultation', 'consulta médica', 'consultation médicale'),
    'diagnóstico': phrase('diagnóstico', 'diagnosis', 'diagnóstico', 'diagnostic'),
    'dosis recomendada': phrase('dosis recomendada', 'recommended dose', 'dose recomendada', 'dose recommandée'),
    'financiación': phrase('financiación', 'financing', 'financiamento', 'financement'),
    'crédito hipotecario': phrase('crédito hipotecario', 'mortgage loan', 'crédito imobiliário', 'crédit immobilier'),
    'reserva de mesa': phrase('reserva de mesa', 'table reservation', 'reserva de mesa', 'réservation de table'),
    'salón': phrase('salón', 'dining room', 'salão', 'salle'),
    'mesa para': phrase('mesa para', 'table for', 'mesa para', 'table pour'),
    'prueba de manejo': phrase('prueba de manejo', 'test drive', 'test drive', 'essai routier'),
    'financiación del vehículo': phrase('financiación del vehículo', 'vehicle financing', 'financiamento do veículo', 'financement du véhicule'),
    'compra del vehículo': phrase('compra del vehículo', 'vehicle purchase', 'compra do veículo', 'achat du véhicule'),
    'propiedad': phrase('propiedad', 'property', 'propriedade', 'bien immobilier'),
    'propiedades': phrase('propiedades', 'properties', 'propriedades', 'biens immobiliers'),
    'inmueble': phrase('inmueble', 'real estate property', 'imóvel', 'bien immobilier'),
    'propiedad en venta': phrase('propiedad en venta', 'property for sale', 'imóvel à venda', 'bien à vendre'),
    'solución': phrase('solución', 'solution', 'solução', 'solution'),
    'deal': phrase('deal', 'deal', 'deal', 'deal'),
    'licencia': phrase('licencia', 'licence', 'licença', 'licence'),
    'suscripción': phrase('suscripción', 'subscription', 'assinatura', 'abonnement'),
    'tratamiento': phrase('tratamiento', 'treatment', 'tratamento', 'traitement'),
    'consulta': phrase('consulta', 'consultation', 'consulta', 'consultation'),
});

export function localizeVerticalPromptPhrases(
    source: readonly string[],
    language: VerticalPromptLanguage,
): { values: string[]; missing: string[] } {
    if (language === 'es') return { values: [...source], missing: [] };
    const values: string[] = [];
    const missing: string[] = [];
    for (const item of source) {
        const translated = VERTICAL_PROMPT_PHRASES[item]?.[language];
        if (translated) values.push(translated);
        else missing.push(item);
    }
    return { values, missing };
}
