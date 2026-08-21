/**
 * Lo que un alquiler y una estadía necesitan además de las fechas.
 *
 * `resource_rentals.metadata` es un JSONB libre, y ahí es donde terminaban —
 * cuando terminaban— el conductor de un auto, el depósito en garantía, el
 * contrato firmado, la jaula donde duerme el perro y con qué otros perros puede
 * compartir patio. Libre significa que cada llamador lo escribía distinto: el
 * panel guardaba `driverName`, un import ponía `driver_name` y el agente no
 * escribía ninguno. Nadie podía construir una pantalla encima porque no había
 * dos filas con la misma forma.
 *
 * Estos dos contratos son lo mínimo que el rubro necesita **sin depender de
 * ningún proveedor externo**: nada acá pide una API de terceros, una firma
 * digital certificada ni una pasarela. Es información que el negocio ya tiene
 * en un cuaderno.
 *
 * ── Lo que deliberadamente NO está ───────────────────────────────────────
 *
 * - **Cobro del depósito.** Se registra el monto y si se retuvo o devolvió;
 *   mover el dinero es el riel de pagos y tiene sus propias puertas.
 * - **Firma del contrato.** Se registra que existe y dónde está; firmarlo
 *   digitalmente con validez legal necesita un proveedor certificado.
 * - **Medicación de la mascota.** Es dato de salud: vive en el registro
 *   clínico con su nivel de acceso, no en el metadata de una estadía.
 */

export const RESOURCE_RENTAL_DETAILS_VERSION = 1 as const;

// ── Alquiler de vehículo ─────────────────────────────────────────────────

/** En qué estado está la garantía. El dinero lo mueve el riel de pagos. */
export type RentalDepositStatus =
    /** Acordado y todavía no tomado. */
    | 'pending'
    /** Tomado y en poder del negocio. */
    | 'held'
    /** Devuelto al cliente. */
    | 'returned'
    /** Retenido total o parcialmente por un daño. */
    | 'withheld';

export interface RentalDriver {
    /** Quién maneja. Puede no ser quien alquila. */
    name: string;
    /** Número de licencia, tal como figura. */
    licenseNumber?: string;
    /** Vencimiento de la licencia, `YYYY-MM-DD`. */
    licenseExpiresAt?: string;
}

export interface RentalDeposit {
    amountCents: number;
    currency: string;
    status: RentalDepositStatus;
    /** Por qué se retuvo. Obligatorio cuando el estado es `withheld`. */
    withheldReason?: string;
}

export interface RentalContract {
    /** Dónde está el documento. El negocio lo sube o lo enlaza. */
    documentUrl?: string;
    /** Si el cliente ya lo firmó, a mano o donde sea. */
    signed: boolean;
    signedAt?: string;
}

export interface VehicleRentalDetails {
    version: typeof RESOURCE_RENTAL_DETAILS_VERSION;
    driver?: RentalDriver;
    deposit?: RentalDeposit;
    contract?: RentalContract;
    /** Kilometraje al entregar y al recibir: la base de cualquier reclamo. */
    odometerOut?: number;
    odometerIn?: number;
}

// ── Estadía de mascota ───────────────────────────────────────────────────

/**
 * Con quién puede compartir espacio.
 *
 * No es una preferencia: un perro que no tolera a otros y comparte patio es un
 * incidente. El campo existe para que la persona que arma los grupos por la
 * mañana no dependa de acordarse.
 */
export type BoardingCompatibility =
    /** Puede compartir con cualquiera. */
    | 'social'
    /** Sólo con perros de su mismo grupo declarado. */
    | 'group_only'
    /** Solo, siempre. */
    | 'solo';

export interface PetBoardingDetails {
    version: typeof RESOURCE_RENTAL_DETAILS_VERSION;
    /** Dónde duerme: jaula, box, habitación. Como lo llame el negocio. */
    unitLabel?: string;
    compatibility?: BoardingCompatibility;
    /** El grupo con el que sale al patio, cuando `group_only`. */
    groupLabel?: string;
    /** Cuántas comidas por día. La medicación NO va acá: es dato clínico. */
    mealsPerDay?: number;
    /** Qué trajo el dueño, para devolvérselo. */
    belongings?: readonly string[];
}

export type ResourceRentalDetails = VehicleRentalDetails | PetBoardingDetails;

// ── Validación ───────────────────────────────────────────────────────────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const CURRENCY = /^[A-Z]{3}$/;
const DEPOSIT_STATUSES: readonly string[] = ['pending', 'held', 'returned', 'withheld'];
const COMPATIBILITIES: readonly string[] = ['social', 'group_only', 'solo'];

function text(value: unknown, max: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed && trimmed.length <= max ? trimmed : undefined;
}

/**
 * Valida y normaliza los detalles de un alquiler de vehículo.
 *
 * Devuelve los errores, no un booleano: "los datos son inválidos" sin decir
 * cuál es lo que hace que el dueño pruebe cinco veces y se rinda.
 */
export function validateVehicleRentalDetails(input: unknown): {
    details?: VehicleRentalDetails;
    errors: string[];
} {
    const errors: string[] = [];
    if (input === null || input === undefined) return { errors };
    if (typeof input !== 'object' || Array.isArray(input)) {
        return { errors: ['details must be an object'] };
    }
    const raw = input as Record<string, any>;
    const details: VehicleRentalDetails = { version: RESOURCE_RENTAL_DETAILS_VERSION };

    if (raw.driver !== undefined) {
        const name = text(raw.driver?.name, 200);
        if (!name) errors.push('driver.name is required when a driver is provided');
        else {
            const driver: RentalDriver = { name };
            const license = text(raw.driver?.licenseNumber, 60);
            if (license) driver.licenseNumber = license;
            const expires = text(raw.driver?.licenseExpiresAt, 10);
            if (expires && !DATE_ONLY.test(expires)) {
                errors.push('driver.licenseExpiresAt must be YYYY-MM-DD');
            } else if (expires) {
                driver.licenseExpiresAt = expires;
            }
            details.driver = driver;
        }
    }

    if (raw.deposit !== undefined) {
        const amount = Number(raw.deposit?.amountCents);
        const currency = text(raw.deposit?.currency, 3)?.toUpperCase();
        const status = text(raw.deposit?.status, 20);
        if (!Number.isInteger(amount) || amount < 0) {
            errors.push('deposit.amountCents must be a non-negative integer');
        } else if (!currency || !CURRENCY.test(currency)) {
            // Sin moneda no se guarda un monto: un número sin moneda es una
            // cifra que alguien va a cobrar en la que le parezca.
            errors.push('deposit.currency must be a three-letter code');
        } else if (!status || !DEPOSIT_STATUSES.includes(status)) {
            errors.push(`deposit.status must be one of ${DEPOSIT_STATUSES.join(', ')}`);
        } else {
            const deposit: RentalDeposit = { amountCents: amount, currency, status: status as RentalDepositStatus };
            const reason = text(raw.deposit?.withheldReason, 500);
            if (status === 'withheld' && !reason) {
                // Retener plata sin motivo escrito es el reclamo del mes que
                // viene sin nada con qué contestarlo.
                errors.push('deposit.withheldReason is required when the deposit is withheld');
            } else if (reason) {
                deposit.withheldReason = reason;
            }
            details.deposit = deposit;
        }
    }

    if (raw.contract !== undefined) {
        const contract: RentalContract = { signed: raw.contract?.signed === true };
        const url = text(raw.contract?.documentUrl, 2000);
        if (url && !/^https:\/\//i.test(url)) {
            errors.push('contract.documentUrl must be an https URL');
        } else if (url) {
            contract.documentUrl = url;
        }
        const signedAt = text(raw.contract?.signedAt, 40);
        if (signedAt && !ISO_INSTANT.test(signedAt)) {
            errors.push('contract.signedAt must be an ISO timestamp');
        } else if (signedAt) {
            contract.signedAt = signedAt;
        }
        if (contract.signed && !contract.signedAt && !contract.documentUrl) {
            errors.push('contract.signed requires signedAt or documentUrl as evidence');
        }
        details.contract = contract;
    }

    for (const key of ['odometerOut', 'odometerIn'] as const) {
        if (raw[key] === undefined) continue;
        const value = Number(raw[key]);
        if (!Number.isInteger(value) || value < 0) errors.push(`${key} must be a non-negative integer`);
        else details[key] = value;
    }
    if (details.odometerOut !== undefined
        && details.odometerIn !== undefined
        && details.odometerIn < details.odometerOut) {
        errors.push('odometerIn cannot be lower than odometerOut');
    }

    return errors.length ? { errors } : { details, errors };
}

/** Valida y normaliza los detalles de una estadía de mascota. */
export function validatePetBoardingDetails(input: unknown): {
    details?: PetBoardingDetails;
    errors: string[];
} {
    const errors: string[] = [];
    if (input === null || input === undefined) return { errors };
    if (typeof input !== 'object' || Array.isArray(input)) {
        return { errors: ['details must be an object'] };
    }
    const raw = input as Record<string, any>;
    const details: PetBoardingDetails = { version: RESOURCE_RENTAL_DETAILS_VERSION };

    const unit = text(raw.unitLabel, 60);
    if (unit) details.unitLabel = unit;

    if (raw.compatibility !== undefined) {
        const compatibility = text(raw.compatibility, 20);
        if (!compatibility || !COMPATIBILITIES.includes(compatibility)) {
            errors.push(`compatibility must be one of ${COMPATIBILITIES.join(', ')}`);
        } else {
            details.compatibility = compatibility as BoardingCompatibility;
        }
    }

    const group = text(raw.groupLabel, 60);
    if (group) details.groupLabel = group;
    if (details.compatibility === 'group_only' && !details.groupLabel) {
        // "Sólo con su grupo" sin decir cuál es no le sirve a quien arma los
        // grupos por la mañana: es la información que el campo existe para dar.
        errors.push('groupLabel is required when compatibility is group_only');
    }

    if (raw.mealsPerDay !== undefined) {
        const meals = Number(raw.mealsPerDay);
        if (!Number.isInteger(meals) || meals < 0 || meals > 10) {
            errors.push('mealsPerDay must be an integer between 0 and 10');
        } else {
            details.mealsPerDay = meals;
        }
    }

    if (raw.belongings !== undefined) {
        if (!Array.isArray(raw.belongings)) {
            errors.push('belongings must be an array');
        } else {
            const items = raw.belongings
                .map((item: unknown) => text(item, 100))
                .filter((item): item is string => !!item)
                .slice(0, 20);
            if (items.length) details.belongings = Object.freeze(items);
        }
    }

    return errors.length ? { errors } : { details, errors };
}

/** Valida según el tipo, para el llamador que tiene los dos. */
export function validateResourceRentalDetails(
    type: 'vehicle_rental' | 'pet_boarding',
    input: unknown,
): { details?: ResourceRentalDetails; errors: string[] } {
    return type === 'pet_boarding'
        ? validatePetBoardingDetails(input)
        : validateVehicleRentalDetails(input);
}
