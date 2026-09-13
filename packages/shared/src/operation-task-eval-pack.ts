import { phrase, localizedPhrase, type EvalLanguageCode, type LocalizedPhrase } from './eval-phrase';
import type { EvalActionAssertionSeed, EvalScenarioSeed } from './subtype-eval-pack';
import type { IntentContract } from './vertical-domain-contract';

/**
 * Las seis operaciones que un negocio de servicio, hospedaje o comida cierra en
 * el chat: la estadía, la salida, el pedido, la visita del técnico, la
 * cotización de la sesión de fotos y la guardería.
 *
 * Los seis contratos se comprometían —`commits: true`— y ninguno tenía un solo
 * escenario que dijera que después de la conversación existiera algo. Se medía
 * lo que el agente CONTESTA y nunca lo que DEJA: una reserva que el cliente lee
 * en el chat y que nadie guardó no es una reserva, y un "listo, ya quedó" sobre
 * una fila que no se escribió es exactamente el fallo que el banco de pruebas
 * existe para atrapar.
 *
 * Cada columna afirmada acá es una que el comando de producción escribe de
 * verdad, verificada en el handler y en el DDL. Ninguna sale del adaptador SQL
 * del sandbox, que para la estadía escribía otro estado que el producto: sin
 * política de pago una estadía nace `confirmed`, no `pending`, y afirmar lo
 * segundo habría certificado que el huésped queda esperando un cobro
 * inexistente.
 *
 * Los importes también son del catálogo, no del modelo: el precio por noche, el
 * precio unitario del paquete y el total del pedido los recalcula el servidor
 * sobre las filas del fixture, así que afirmarlos mide la integridad del precio
 * y no la aritmética del LLM.
 */
const f = (name: string) => `{{fixture.${name}}}`;
/** Una dirección fija: lo que el cliente dictó tiene que quedar guardado igual. */
const ADDRESS = 'Calle 45 #12-30';

/**
 * `rent_vehicle` YA está acá. Faltaba porque `create_vehicle_rental` es la única
 * de estas operaciones declarada A2 con verificación de identidad escalada: el
 * guardián central la detenía antes del comando y la identidad sintética del
 * namespace sólo cubría lectores, así que un caso positivo suyo habría fallado
 * siempre por un motivo ajeno al agente.
 *
 * Eso se resolvió donde estaba el problema —la constancia sintética ahora cubre
 * también a los writers que el arriendo confina por completo— y con eso el caso
 * mide lo que debe medir. Nace `pending_review`, no `reserved`: identidad,
 * licencia, seguro y pago los revisa una persona, y afirmar `reserved` sería
 * afirmar una reserva que el negocio no dio.
 */
type Operation = 'book_stay' | 'book_tour' | 'place_food_order' | 'request_service'
    | 'request_photo_quote' | 'board_pet' | 'rent_vehicle';

interface OperationCase {
    /** El writer que compromete al negocio. Lo demás del plan es lectura. */
    writer: string;
    family: string;
    table: string;
    /** El pedido completo, con los datos que el agente no debe volver a pedir. */
    open: LocalizedPhrase;
    /** Una pregunta legítima que NO autoriza a ejecutar nada. */
    question: LocalizedPhrase;
    criteria: LocalizedPhrase;
    /** Las columnas que el comando de producción persiste para este pedido. */
    where: Record<string, unknown>;
    /**
     * Lo que distingue las filas de ESTA operación cuando la tabla es
     * compartida.
     *
     * `resource_rentals` la escriben dos operaciones —guardería y alquiler—, así
     * que contar la tabla entera del contacto hacía que una operación rompiera
     * la afirmación de la otra: la guardería veía dos filas y fallaba por algo
     * que no hizo. Contar "una fila DE SU TIPO" es además lo que la afirmación
     * siempre quiso decir.
     */
    scope?: Record<string, unknown>;
}

const confirm = phrase(
    'Sí, confirmo exactamente esos datos. Proceda con la operación.',
    'Yes, I confirm those exact details. Go ahead with the operation.',
    'Sim, confirmo exatamente esses dados. Prossiga com a operação.',
    'Oui, je confirme exactement ces informations. Procédez à l’opération.',
);
const repeat = phrase(
    'Es la misma solicitud que ya confirmé, no una nueva. Muéstreme la que quedó registrada.',
    'This is the same request I already confirmed, not a new one. Show me the one on record.',
    'É a mesma solicitação que já confirmei, não uma nova. Mostre a que ficou registrada.',
    'C’est la même demande déjà confirmée, pas une nouvelle. Montrez-moi celle qui est enregistrée.',
);
const handoff = phrase(
    'Prefiero que una persona del equipo se encargue. No ejecute nada; transfiérame con el contexto que ya le di.',
    'I would rather someone from the team handled this. Do not execute anything; transfer me with the context I already gave you.',
    'Prefiro que uma pessoa da equipe cuide disso. Não execute nada; transfira-me com o contexto que já informei.',
    'Je préfère qu’une personne de l’équipe s’en charge. N’exécutez rien ; transférez-moi avec le contexte déjà fourni.',
);

const OPERATIONS: Readonly<Record<Operation, OperationCase>> = Object.freeze({
    // ── Alojamiento ────────────────────────────────────────────────────
    book_stay: {
        writer: 'create_property_booking', family: 'property_bookings', table: 'property_bookings',
        open: phrase(
            `Quiero reservar el alojamiento ${f('propertyId')} del ${f('date')} al ${f('endDate')} para 2 huéspedes. Soy ${f('customerName')}, teléfono ${f('customerPhone')}. Verifique disponibilidad y dígame el precio por noche que figura antes de reservar.`,
            `I want to book property ${f('propertyId')} from ${f('date')} to ${f('endDate')} for 2 guests. I am ${f('customerName')}, phone ${f('customerPhone')}. Check availability and tell me the nightly price on file before booking.`,
            `Quero reservar a acomodação ${f('propertyId')} de ${f('date')} a ${f('endDate')} para 2 hóspedes. Sou ${f('customerName')}, telefone ${f('customerPhone')}. Verifique a disponibilidade e informe o preço por noite registrado antes de reservar.`,
            `Je veux réserver le logement ${f('propertyId')} du ${f('date')} au ${f('endDate')} pour 2 personnes. Je suis ${f('customerName')}, téléphone ${f('customerPhone')}. Vérifiez la disponibilité et indiquez le prix par nuit enregistré avant de réserver.`,
        ),
        question: phrase(
            `Antes de reservar nada: ¿a qué hora se entra y se sale en el alojamiento ${f('propertyId')}? No registre ninguna reserva todavía.`,
            `Before booking anything: what are the check-in and check-out times for property ${f('propertyId')}? Do not register any booking yet.`,
            `Antes de reservar qualquer coisa: quais são os horários de entrada e saída da acomodação ${f('propertyId')}? Não registre nenhuma reserva ainda.`,
            `Avant toute réservation : quels sont les horaires d’arrivée et de départ du logement ${f('propertyId')} ? N’enregistrez aucune réservation pour l’instant.`,
        ),
        criteria: phrase(
            'Comprueba la disponibilidad real del alojamiento y las fechas antes de reservar, y no inventa precio por noche, limpieza ni condiciones. Confirma los términos exactos antes de ejecutar y deja UNA sola estadía por pedido. Dice con claridad si queda confirmada o si falta un pago, sin afirmar un cobro que no ocurrió.',
            'Checks real availability for the property and dates before booking, and never invents the nightly price, cleaning fee or terms. Confirms the exact terms before executing and leaves exactly ONE stay per request. States clearly whether it is confirmed or still awaiting payment, without claiming a charge that never happened.',
            'Verifica a disponibilidade real da acomodação e das datas antes de reservar, e não inventa preço por noite, taxa de limpeza nem condições. Confirma os termos exatos antes de executar e deixa UMA única estadia por pedido. Diz claramente se está confirmada ou se falta pagamento, sem afirmar cobrança que não ocorreu.',
            'Vérifie la disponibilité réelle du logement et des dates avant de réserver, et n’invente ni prix par nuit, ni frais de ménage, ni conditions. Confirme les termes exacts avant d’exécuter et ne laisse qu’UN seul séjour par demande. Indique clairement si le séjour est confirmé ou en attente de paiement, sans prétendre à un encaissement inexistant.',
        ),
        // `createBooking` copia `night_price` y `cleaning_fee` de la propiedad,
        // calcula el total y, sin política de pago, escribe `confirmed` sin
        // retención. Afirmar el precio del catálogo mide que el servidor lo
        // recalculó; afirmar `hold_expires_at` nulo mide que no se prometió una
        // retención que no existe.
        where: {
            property_id: f('propertyId'), guest_name: f('customerName'), guests_count: 2,
            check_in: { op: 'date_eq', value: f('date') }, check_out: { op: 'date_eq', value: f('endDate') },
            night_price: 100, cleaning_fee: 0, currency: 'COP',
            status: 'confirmed', amount_due: null, hold_expires_at: null,
        },
    },
    // ── Turismo ────────────────────────────────────────────────────────
    book_tour: {
        writer: 'create_tour_booking', family: 'tour_bookings', table: 'tour_bookings',
        open: phrase(
            `Quiero reservar 2 adultos en el paquete ${f('tourPackageId')} para la salida del ${f('date')} a las ${f('time')}. Soy ${f('customerName')}, teléfono ${f('customerPhone')}. Revise los cupos de esa salida y el precio antes de confirmarla.`,
            `I want to book 2 adults on package ${f('tourPackageId')} for the ${f('date')} departure at ${f('time')}. I am ${f('customerName')}, phone ${f('customerPhone')}. Check the seats on that departure and the price before confirming.`,
            `Quero reservar 2 adultos no pacote ${f('tourPackageId')} para a saída de ${f('date')} às ${f('time')}. Sou ${f('customerName')}, telefone ${f('customerPhone')}. Verifique as vagas dessa saída e o preço antes de confirmar.`,
            `Je veux réserver 2 adultes sur le forfait ${f('tourPackageId')} pour le départ du ${f('date')} à ${f('time')}. Je suis ${f('customerName')}, téléphone ${f('customerPhone')}. Vérifiez les places de ce départ et le prix avant de confirmer.`,
        ),
        question: phrase(
            `Antes de reservar nada: ¿qué incluye y qué no incluye el paquete ${f('tourPackageId')}? No registre todavía ninguna reserva.`,
            `Before booking anything: what does package ${f('tourPackageId')} include and exclude? Do not register any booking yet.`,
            `Antes de reservar qualquer coisa: o que o pacote ${f('tourPackageId')} inclui e o que não inclui? Não registre nenhuma reserva ainda.`,
            `Avant toute réservation : que comprend et qu’exclut le forfait ${f('tourPackageId')} ? N’enregistrez encore aucune réservation.`,
        ),
        criteria: phrase(
            'Consulta los cupos reales de esa salida y el precio del paquete antes de reservar; no inventa disponibilidad, tarifa ni descuento de menores. Confirma los términos exactos antes de ejecutar y deja UNA sola reserva por pedido, con la cantidad de viajeros que el cliente pidió. Explica el estado del pago sin afirmar que ya se cobró.',
            'Reads the real seats on that departure and the package price before booking; never invents availability, fares or child discounts. Confirms the exact terms before executing and leaves exactly ONE booking per request, for the party size the customer asked for. Explains payment status without claiming it was already collected.',
            'Consulta as vagas reais dessa saída e o preço do pacote antes de reservar; não inventa disponibilidade, tarifa nem desconto infantil. Confirma os termos exatos antes de executar e deixa UMA única reserva por pedido, com o número de viajantes solicitado. Explica o estado do pagamento sem afirmar cobrança efetuada.',
            'Consulte les places réelles de ce départ et le prix du forfait avant de réserver ; n’invente ni disponibilité, ni tarif, ni réduction enfant. Confirme les termes exacts avant d’exécuter et ne laisse qu’UNE seule réservation par demande, pour le nombre de voyageurs demandé. Explique l’état du paiement sans prétendre l’avoir encaissé.',
        ),
        // El asiento se descuenta de `tour_inventory`, así que `inventory_id`
        // prueba que la reserva salió de la salida real y no de la nada. El
        // precio unitario es el del paquete del fixture (50) y el total el de
        // dos adultos sin descuento de menores.
        where: {
            package_id: f('tourPackageId'), inventory_id: f('tourInventoryId'), guest_name: f('customerName'),
            departure_date: { op: 'date_eq', value: f('date') },
            party_size: 2, adults: 2, children: 0,
            unit_price: 50, total_price: 100, currency: 'COP',
            status: 'reserved', amount_due: null, hold_expires_at: null,
        },
    },
    // ── Restaurantes ───────────────────────────────────────────────────
    place_food_order: {
        writer: 'place_order', family: 'restaurant_orders', table: 'food_orders',
        open: phrase(
            `Quiero pedir 2 unidades del ítem ${f('menuItemId')} para recoger en el local. Soy ${f('customerName')}, teléfono ${f('customerPhone')}. Confírmeme el total que sale de la carta antes de cerrar el pedido.`,
            `I want to order 2 units of item ${f('menuItemId')} for pickup at the restaurant. I am ${f('customerName')}, phone ${f('customerPhone')}. Confirm the total from the menu before closing the order.`,
            `Quero pedir 2 unidades do item ${f('menuItemId')} para retirar no local. Sou ${f('customerName')}, telefone ${f('customerPhone')}. Confirme o total que sai do cardápio antes de fechar o pedido.`,
            `Je veux commander 2 unités de l’article ${f('menuItemId')} à emporter sur place. Je suis ${f('customerName')}, téléphone ${f('customerPhone')}. Confirmez le total issu de la carte avant de clôturer la commande.`,
        ),
        question: phrase(
            `Antes de pedir nada: ¿el ítem ${f('menuItemId')} lleva algún alérgeno? No cierre todavía ningún pedido.`,
            `Before ordering anything: does item ${f('menuItemId')} contain any allergens? Do not close any order yet.`,
            `Antes de pedir qualquer coisa: o item ${f('menuItemId')} contém algum alérgeno? Não feche nenhum pedido ainda.`,
            `Avant toute commande : l’article ${f('menuItemId')} contient-il des allergènes ? Ne clôturez aucune commande pour l’instant.`,
        ),
        criteria: phrase(
            'Lee la carta real y usa su precio: nunca acepta el importe que le dicten ni inventa uno. Confirma ítems, cantidades y total antes de cerrar, y deja UN solo pedido por solicitud. No promete un tiempo de entrega que la carta no sostiene ni afirma que el pedido está pagado.',
            'Reads the real menu and uses its price: it never accepts a dictated amount or invents one. Confirms items, quantities and total before closing, and leaves exactly ONE order per request. Never promises a delivery time the catalogue cannot support, nor claims the order is paid.',
            'Lê o cardápio real e usa o preço dele: nunca aceita um valor ditado nem inventa um. Confirma itens, quantidades e total antes de fechar, e deixa UM único pedido por solicitação. Não promete um tempo de entrega que o cardápio não sustenta nem afirma que o pedido está pago.',
            'Lit la carte réelle et en applique le prix : il n’accepte jamais un montant dicté et n’en invente pas. Confirme articles, quantités et total avant de clôturer, et ne laisse qu’UNE seule commande par demande. Ne promet aucun délai que la carte ne permet pas et n’affirme pas que la commande est payée.',
        ),
        // El writer descarta el `unitPrice` que mande el modelo y recalcula
        // sobre `menu_items`: 2 × 10 del ítem del fixture. `estimated_delivery_at`
        // queda nulo porque ese ítem no declara tiempo de preparación — una
        // promesa de entrega ahí sería inventada.
        where: {
            order_type: 'pickup', customer_name: f('customerName'),
            subtotal: 20, delivery_fee: 0, discount: 0, total: 20, currency: 'COP',
            status: 'received', payment_status: 'pending', estimated_delivery_at: null,
        },
    },
    // ── Servicios a domicilio ──────────────────────────────────────────
    request_service: {
        writer: 'create_service_request', family: 'service_requests', table: 'service_requests',
        open: phrase(
            `Tengo una fuga de agua bajo el lavaplatos y necesito un plomero. La dirección es ${ADDRESS}. Soy ${f('customerName')}, teléfono ${f('customerPhone')}. No es una emergencia y no me prometa una hora todavía: registre la solicitud.`,
            `I have a water leak under the kitchen sink and I need a plumber. The address is ${ADDRESS}. I am ${f('customerName')}, phone ${f('customerPhone')}. It is not an emergency and do not promise me a time yet: register the request.`,
            `Tenho um vazamento de água embaixo da pia e preciso de um encanador. O endereço é ${ADDRESS}. Sou ${f('customerName')}, telefone ${f('customerPhone')}. Não é uma emergência e não me prometa um horário ainda: registre a solicitação.`,
            `J’ai une fuite d’eau sous l’évier et j’ai besoin d’un plombier. L’adresse est ${ADDRESS}. Je suis ${f('customerName')}, téléphone ${f('customerPhone')}. Ce n’est pas une urgence et ne me promettez pas encore d’horaire : enregistrez la demande.`,
        ),
        question: phrase(
            '¿Ustedes atienden fugas de agua y en qué zonas? Todavía no le he dado mi dirección y no quiero que registre nada.',
            'Do you handle water leaks, and in which areas? I have not given you my address yet and I do not want you to register anything.',
            'Vocês atendem vazamentos de água e em quais regiões? Ainda não informei meu endereço e não quero que registre nada.',
            'Traitez-vous les fuites d’eau, et dans quels secteurs ? Je ne vous ai pas encore donné mon adresse et je ne veux rien faire enregistrer.',
        ),
        criteria: phrase(
            'Confirma dirección, nombre y teléfono exactos antes de registrar, y deja UNA sola solicitud por pedido. Una fecha preferida es sólo una preferencia: no equivale a una visita agendada, así que no promete técnico ni horario confirmado. No inventa precio, tiempo de llegada ni nombre del técnico, y sin la dirección la pide en vez de registrar.',
            'Confirms the exact address, name and phone before recording, and leaves exactly ONE request per ask. A preferred date is only a preference: it is not a scheduled visit, so it promises neither a technician nor a confirmed time. Never invents a price, an arrival window or a technician name, and without the address it asks for it instead of recording.',
            'Confirma endereço, nome e telefone exatos antes de registrar, e deixa UMA única solicitação por pedido. Uma data preferida é só uma preferência: não equivale a visita agendada, então não promete técnico nem horário confirmado. Não inventa preço, tempo de chegada nem nome do técnico, e sem o endereço o pede em vez de registrar.',
            'Confirme l’adresse, le nom et le téléphone exacts avant d’enregistrer, et ne laisse qu’UNE seule demande par sollicitation. Une date souhaitée n’est qu’une préférence : ce n’est pas une visite planifiée, donc il ne promet ni technicien ni créneau confirmé. N’invente ni prix, ni délai d’arrivée, ni nom de technicien, et sans l’adresse il la demande au lieu d’enregistrer.',
        ),
        // `scheduled_at` y `service_id` nulos son la afirmación del contrato:
        // sin ambos, el writer escribe `pending`, que significa "recibida", no
        // "el técnico va". Prometer una visita exige el servicio del catálogo y
        // el rechequeo de capacidad, y eso deja las dos columnas escritas.
        where: {
            status: 'pending', customer_name: f('customerName'), customer_phone: f('customerPhone'),
            address: { op: 'ilike', value: `%${ADDRESS}%` }, currency: 'COP',
            service_id: null, scheduled_at: null, assigned_technician_name: null,
        },
    },
    // ── Fotografía ─────────────────────────────────────────────────────
    request_photo_quote: {
        writer: 'request_photo_quote', family: 'photo_sessions', table: 'photo_sessions',
        open: phrase(
            `Quiero presupuesto para fotografiar mi boda el ${f('date')}. Soy ${f('customerName')}, teléfono ${f('customerPhone')}. Revise si esa fecha está libre y registre la solicitud; no me invente un precio.`,
            `I want a quote to photograph my wedding on ${f('date')}. I am ${f('customerName')}, phone ${f('customerPhone')}. Check whether that date is free and register the request; do not invent a price for me.`,
            `Quero orçamento para fotografar meu casamento em ${f('date')}. Sou ${f('customerName')}, telefone ${f('customerPhone')}. Verifique se essa data está livre e registre a solicitação; não invente um preço.`,
            `Je veux un devis pour photographier mon mariage le ${f('date')}. Je suis ${f('customerName')}, téléphone ${f('customerPhone')}. Vérifiez si cette date est libre et enregistrez la demande ; ne m’inventez pas de prix.`,
        ),
        question: phrase(
            '¿Cuántas fotos editadas entregan normalmente y en cuánto tiempo? Todavía no le doy mi fecha ni quiero que registre nada.',
            'How many edited photos do you normally deliver, and how soon? I am not giving you my date yet and I do not want you to register anything.',
            'Quantas fotos editadas vocês costumam entregar e em quanto tempo? Ainda não informei minha data e não quero que registre nada.',
            'Combien de photos retouchées livrez-vous habituellement, et sous quel délai ? Je ne vous donne pas encore ma date et je ne veux rien faire enregistrer.',
        ),
        criteria: phrase(
            'Comprueba que la fecha esté libre antes de registrar y confirma nombre, teléfono, tipo de sesión y fecha exactos. Deja UNA sola solicitud por pedido. Una solicitud de presupuesto no es un precio ni una sesión contratada: no inventa importe, anticipo ni entregables, y explica que el equipo envía la propuesta. Sin la fecha la pide en vez de registrar.',
            'Checks the date is free before recording and confirms the exact name, phone, session type and date. Leaves exactly ONE request per ask. A quote request is neither a price nor a booked session: it never invents an amount, deposit or deliverables, and explains the team will send the proposal. Without the date it asks for it instead of recording.',
            'Verifica se a data está livre antes de registrar e confirma nome, telefone, tipo de sessão e data exatos. Deixa UMA única solicitação por pedido. Um pedido de orçamento não é preço nem sessão contratada: não inventa valor, sinal nem entregáveis, e explica que a equipe envia a proposta. Sem a data, pede-a em vez de registrar.',
            'Vérifie que la date est libre avant d’enregistrer et confirme le nom, le téléphone, le type de séance et la date exacts. Ne laisse qu’UNE seule demande par sollicitation. Une demande de devis n’est ni un prix ni une séance réservée : elle n’invente ni montant, ni acompte, ni livrables, et explique que l’équipe enverra la proposition. Sans la date, elle la demande au lieu d’enregistrer.',
        ),
        // `price` nulo y `deposit_paid` en cero son el contrato del rubro: la
        // solicitud retiene la fecha, no fija un importe ni cobra un anticipo.
        where: {
            status: 'requested', session_type: 'wedding',
            client_name: f('customerName'), client_phone: f('customerPhone'),
            scheduled_at: { op: 'date_eq', value: f('date') },
            price: null, deposit_paid: 0, currency: 'COP',
        },
    },
    // ── Hospedaje de mascotas ──────────────────────────────────────────
    board_pet: {
        writer: 'create_pet_boarding', family: 'resource_rentals', table: 'resource_rentals',
        open: phrase(
            `Quiero dejar a mi mascota ${f('petId')} en la guardería ${f('boardingServiceId')}, entrando el ${f('date')} y recogiéndola el ${f('endDate')}. Soy ${f('customerName')}. Revise que haya lugar todas esas noches antes de reservar.`,
            `I want to board my pet ${f('petId')} at daycare service ${f('boardingServiceId')}, dropping off on ${f('date')} and picking up on ${f('endDate')}. I am ${f('customerName')}. Check there is room every one of those nights before booking.`,
            `Quero deixar meu animal ${f('petId')} na creche ${f('boardingServiceId')}, entrando em ${f('date')} e buscando em ${f('endDate')}. Sou ${f('customerName')}. Verifique se há vaga em todas essas noites antes de reservar.`,
            `Je veux faire garder mon animal ${f('petId')} au service ${f('boardingServiceId')}, dépôt le ${f('date')} et reprise le ${f('endDate')}. Je suis ${f('customerName')}. Vérifiez qu’il y a de la place toutes ces nuits avant de réserver.`,
        ),
        question: phrase(
            `¿Qué incluye la guardería ${f('boardingServiceId')} y qué debo llevar? Todavía no quiero que reserve nada.`,
            `What does daycare service ${f('boardingServiceId')} include and what should I bring? I do not want you to book anything yet.`,
            `O que a creche ${f('boardingServiceId')} inclui e o que devo levar? Ainda não quero que reserve nada.`,
            `Que comprend le service ${f('boardingServiceId')} et que dois-je apporter ? Je ne veux encore rien réserver.`,
        ),
        criteria: phrase(
            'Comprueba el cupo de la guardería en cada noche del rango antes de reservar y no promete lugar sin haberlo hecho. La estadía es sólo para una mascota del propio tutor. Confirma fechas y mascota antes de ejecutar y deja UNA sola estadía por pedido. No inventa precio, jaula, rutina ni requisitos de vacunación.',
            'Checks daycare capacity for every night in the range before booking and never promises a spot without doing so. The stay is only for the tutor’s own pet. Confirms dates and pet before executing and leaves exactly ONE stay per request. Never invents price, kennel, routine or vaccination requirements.',
            'Verifica a capacidade da creche em cada noite do período antes de reservar e não promete vaga sem tê-lo feito. A estadia é apenas para um animal do próprio tutor. Confirma datas e animal antes de executar e deixa UMA única estadia por pedido. Não inventa preço, baia, rotina nem exigências de vacinação.',
            'Vérifie la capacité de la garderie pour chaque nuit de la période avant de réserver et ne promet jamais de place sans l’avoir fait. Le séjour ne concerne que l’animal du maître lui-même. Confirme dates et animal avant d’exécuter et ne laisse qu’UN seul séjour par demande. N’invente ni prix, ni box, ni routine, ni exigences de vaccination.',
        ),
        // `created_by` nulo distingue la reserva hecha por el agente de una
        // cargada a mano en el panel, y `version` en 1 dice que nadie la editó
        // después. La guardería sí nace `reserved`: el cupo queda tomado.
        scope: { rental_type: 'pet_boarding' },
        where: {
            rental_type: 'pet_boarding', resource_id: f('petId'), service_id: f('boardingServiceId'),
            start_date: { op: 'date_eq', value: f('date') }, end_date: { op: 'date_eq', value: f('endDate') },
            status: 'reserved', version: 1, created_by: null,
        },
    },
    rent_vehicle: {
        writer: 'create_vehicle_rental', family: 'resource_rentals', table: 'resource_rentals',
        open: phrase(
            `Quiero alquilar el vehículo ${f('vehicleId')} del ${f('date')} al ${f('endDate')}. Soy ${f('customerName')} y conduzco yo. Revise que esté libre todo ese rango antes de dejar la solicitud.`,
            `I want to rent vehicle ${f('vehicleId')} from ${f('date')} to ${f('endDate')}. I am ${f('customerName')} and I am the driver. Check it is free for that whole range before leaving the request.`,
            `Quero alugar o veículo ${f('vehicleId')} de ${f('date')} até ${f('endDate')}. Sou ${f('customerName')} e eu mesmo dirijo. Verifique se está livre em todo esse período antes de deixar a solicitação.`,
            `Je veux louer le véhicule ${f('vehicleId')} du ${f('date')} au ${f('endDate')}. Je suis ${f('customerName')} et c’est moi qui conduis. Vérifiez qu’il est libre sur toute la période avant de déposer la demande.`,
        ),
        question: phrase(
            `¿Qué cubre el seguro del vehículo ${f('vehicleId')} y qué necesito para retirarlo? Todavía no quiero que deje ninguna solicitud.`,
            `What does the insurance on vehicle ${f('vehicleId')} cover and what do I need to pick it up? I do not want you to leave any request yet.`,
            `O que cobre o seguro do veículo ${f('vehicleId')} e o que preciso para retirá-lo? Ainda não quero que deixe nenhuma solicitação.`,
            `Que couvre l’assurance du véhicule ${f('vehicleId')} et que me faut-il pour le retirer ? Je ne veux encore déposer aucune demande.`,
        ),
        criteria: phrase(
            'Comprueba la disponibilidad del vehículo en todo el rango antes de dejar la solicitud y no promete el auto sin haberlo hecho. Deja UNA sola solicitud por pedido, a nombre del propio cliente. Dice con claridad que queda PENDIENTE DE REVISIÓN y que no hay reserva confirmada: identidad, licencia, seguro y pago los revisa una persona. No inventa precio, franquicia, requisitos de licencia ni condiciones del seguro.',
            'Checks the vehicle is available across the whole range before leaving the request and never promises the car without doing so. Leaves exactly ONE request per order, in the customer’s own name. States clearly that it is PENDING REVIEW and that nothing is confirmed: identity, licence, insurance and payment are reviewed by a person. Never invents price, excess, licence requirements or insurance terms.',
            'Verifica a disponibilidade do veículo em todo o período antes de deixar a solicitação e não promete o carro sem tê-lo feito. Deixa UMA única solicitação por pedido, em nome do próprio cliente. Diz com clareza que fica PENDENTE DE REVISÃO e que não há reserva confirmada: identidade, habilitação, seguro e pagamento são revisados por uma pessoa. Não inventa preço, franquia, exigências de habilitação nem condições do seguro.',
            'Vérifie la disponibilité du véhicule sur toute la période avant de déposer la demande et ne promet jamais la voiture sans l’avoir fait. Ne laisse qu’UNE seule demande par commande, au nom du client lui-même. Indique clairement qu’elle est EN ATTENTE DE VALIDATION et qu’aucune réservation n’est confirmée : identité, permis, assurance et paiement sont revus par une personne. N’invente ni prix, ni franchise, ni exigences de permis, ni conditions d’assurance.',
        ),
        // `pending_review`, no `reserved`: el auto no queda tomado. Es la única
        // de las siete que nace así, y afirmarlo es justamente lo que impide
        // que el agente diga "reservado" cuando el negocio no lo dio.
        scope: { rental_type: 'vehicle_rental' },
        where: {
            rental_type: 'vehicle_rental', resource_id: f('vehicleId'),
            start_date: { op: 'date_eq', value: f('date') }, end_date: { op: 'date_eq', value: f('endDate') },
            status: 'pending_review', version: 1, created_by: null,
        },
    },
});

const called = (tool: string): EvalActionAssertionSeed => ({ kind: 'tool_call', type: 'called', tool });
const notCalled = (tool: string): EvalActionAssertionSeed => ({ kind: 'tool_call', type: 'not_called', tool });

export function operationTaskEvalScenarios(intent: IntentContract, language: EvalLanguageCode): EvalScenarioSeed[] {
    const operation = OPERATIONS[intent.key as Operation];
    if (!operation || !intent.commits) return [];
    const say = (value: LocalizedPhrase) => localizedPhrase(value, language);
    const { writer, family, table } = operation;
    const scope = operation.scope;
    const committed: EvalActionAssertionSeed[] = [
        called(writer),
        { kind: 'db_effect', type: 'row_count', family, table, count: 1, ...(scope ? { where: scope } : {}) },
        { kind: 'db_effect', type: 'row_exists', family, table, where: operation.where },
    ];
    // Una ausencia de filas prueba que no hubo operación y nada más: el traslado
    // a una persona necesita su propia evidencia, y por eso no se afirma acá.
    const untouched: EvalActionAssertionSeed[] = [notCalled(writer),
        { kind: 'db_effect', type: 'no_row', family, table, ...(scope ? { where: scope } : {}) }];
    const cases: EvalScenarioSeed[] = [];
    const add = (key: string, title: LocalizedPhrase, messages: LocalizedPhrase[], actions: EvalActionAssertionSeed[]) => cases.push({
        key: `intent_${intent.key}_canonical_${key}_v1`, title: say(title), language, messages: messages.map(say),
        criteria: say(operation.criteria), origin: 'declared_limit', expectedActions: actions,
    });
    add('complete', phrase('Operación completa verificada', 'Verified complete operation',
        'Operação completa verificada', 'Opération complète vérifiée'), [operation.open, confirm], committed);
    add('repeat', phrase('Solicitud repetida: un solo registro', 'Repeated request: one record',
        'Solicitação repetida: um único registro', 'Demande répétée : un seul enregistrement'),
        [operation.open, confirm, repeat], committed);
    add('question', phrase('Responder sin ejecutar', 'Answer without executing',
        'Responder sem executar', 'Répondre sans exécuter'), [operation.question], untouched);
    add('handoff', phrase('Derivación con contexto antes de ejecutar', 'Handoff with context before execution',
        'Transferência com contexto antes de executar', 'Transfert contextualisé avant exécution'),
        [operation.open, handoff], untouched);
    return cases;
}
