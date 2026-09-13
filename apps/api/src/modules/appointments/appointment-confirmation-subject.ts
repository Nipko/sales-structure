import type { ConfirmationFamilies } from '../../common/utils/served-confirmation-policy.util';

/**
 * ═══ WHICH FAMILY'S SWITCH DECIDES *THIS* APPOINTMENT'S CONFIRMATION ═══
 *
 * `appointments` is not the only family that books an appointment. Four of the
 * business-profile contract's families describe an operation whose row lands in
 * `appointments` and nowhere else:
 *
 *   · a test drive        — `vehicles`, asked for by `schedule_test_drive`
 *   · a property visit    — `realEstate`, asked for by `create_appointment`
 *                           carrying the listing it is about
 *   · a veterinary visit  — `pets`, asked for by `create_appointment` carrying
 *                           the pet it is for
 *   · a treatment session — `treatments`, asked for by `create_appointment`
 *                           carrying the plan it belongs to
 *
 * Only the first of the four had a consumer. `realEstate.emailConfirmations`
 * and `pets.emailConfirmations` were declared by the contract, rendered as a
 * switch by the agent editor (which even names the template each of them
 * promises), and read by nothing: an estate agency could switch visit
 * confirmations off and the screen would say it had, while every visit went on
 * being confirmed by email under the `appointments` switch.
 *
 * ── WHY THE MARKER ON THE ROW IS THE AUTHORITY, AND NOT THE TENANT'S VERTICAL ─
 *
 * The tempting shortcut is "this is an estate agency, so every appointment is a
 * visit". It is wrong in both directions: an agency also books a valuation call
 * that is not a visit, and a pet-services tenant carries BOTH the veterinary
 * family and the pet-care one in its manifest, so the vertical cannot say which
 * of the two switches an appointment belongs to. (The pet-care family is NOT
 * resolved here — it has no marker of its own, and inventing one from the
 * tenant's vertical is the guess this paragraph is refusing.)
 *
 * `metadata.listingId` / `metadata.petId` do say. They are written by
 * `resolveAppointmentSubject` in the tool executor, which VALIDATES the id
 * against `real_estate_listings` / `pets` before storing it and drops it
 * otherwise — so the marker is a fact about the operation, on the same footing
 * as the `testDrive` marker `AppointmentsService.create` writes when a signed
 * vehicle command is present. An appointment entered by hand carries no marker
 * and keeps following `appointments`, unchanged.
 *
 * ── WHY `vehicleId` ALONE IS NOT A `vehicles` OPERATION ─────────────────────
 *
 * A workshop service appointment also carries `metadata.vehicleId`; it is not a
 * test drive, and `vehicles.emailConfirmations` must not reach it. The trigger
 * stays `testDrive`, which only the vehicle-command path writes. There is a
 * test pinning exactly that, and this file does not widen it.
 */

/** The four families whose operation is written into `appointments`. */
export type AppointmentSubjectFamily = 'vehicles' | 'realEstate' | 'pets' | 'treatments';

/**
 * Markers in order of how strong the claim is, most specific first.
 *
 * `testDrive` leads because it is the only one backed by a signed command
 * (`vehicleAppointmentCommandHash`) rather than by a validated id. The other
 * others are validated ids, and a row CAN carry two of them — a veterinary
 * clinic running a treatment plan for a pet — so the order is the answer, not
 * an accident: the nearest family is the one whose tools the tenant operates
 * that object through.
 */
const MARKERS: ReadonlyArray<{
    readonly family: AppointmentSubjectFamily;
    readonly present: (metadata: any) => boolean;
}> = Object.freeze([
    { family: 'vehicles', present: metadata => metadata?.testDrive === true },
    { family: 'realEstate', present: metadata => marked(metadata?.listingId) },
    { family: 'pets', present: metadata => marked(metadata?.petId) },
    // A session of a multi-session plan — orthodontics, physiotherapy, a
    // course of facials. `treatmentPlanId` is validated against
    // `treatment_plans` by the same writer that validates the two above.
    //
    // It comes LAST on purpose: a veterinary clinic running a treatment plan
    // for a pet can carry both markers, and `pets` is the family whose tools
    // the tenant actually operates that animal through.
    { family: 'treatments', present: metadata => marked(metadata?.treatmentPlanId) },
]);

/**
 * A marker is a non-empty string the writer already checked against its table.
 *
 * Not re-validated as a UUID here: the executor's own regular expression is
 * what admitted it, and re-deriving the rule in a second place is how two
 * readings of the same row start to disagree. An empty string is rejected
 * because it is the shape a stripped value leaves behind, and it names nothing.
 */
function marked(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

/**
 * The subject family named by the appointment's own metadata, or `null` for an
 * ordinary appointment.
 *
 * Exported on its own because both consumers — the confirmation and the
 * reminder — have to agree about it, and because the answer is worth logging.
 */
export function appointmentSubjectFamily(metadata: unknown): AppointmentSubjectFamily | null {
    for (const marker of MARKERS) if (marker.present(metadata)) return marker.family;
    return null;
}

/**
 * The families whose `emailConfirmations` govern an appointment with this
 * subject, nearest first, for `servedEmailConfirmationsEnabled`.
 *
 * `appointments` always closes the list: the nearer family decides only when
 * the owner actually set it, so a tenant that never touched `realEstate` keeps
 * following the appointment switch it already set, and a tenant that touched
 * neither keeps being confirmed.
 */
export function confirmationFamiliesForSubject(
    subject: AppointmentSubjectFamily | null,
): ConfirmationFamilies {
    return subject ? [subject, 'appointments'] : ['appointments'];
}

/** Both halves, for a caller that holds the row's metadata and nothing else. */
export function appointmentConfirmationFamilies(metadata: unknown): ConfirmationFamilies {
    return confirmationFamiliesForSubject(appointmentSubjectFamily(metadata));
}
