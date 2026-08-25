import {
    validatePetBoardingDetails,
    validateResourceRentalDetails,
    validateVehicleRentalDetails,
} from '@parallext/shared';

/**
 * `metadata` era texto libre, y ahí terminaban —cuando terminaban— el conductor
 * de un auto, el depósito en garantía, el contrato, la jaula donde duerme el
 * perro y con qué otros perros puede compartir patio.
 *
 * Libre significa que cada llamador lo escribía distinto: el panel guardaba
 * `driverName`, un import ponía `driver_name` y el agente no escribía ninguno.
 * **Nadie podía construir una pantalla encima porque no había dos filas con la
 * misma forma.**
 *
 * Nada de esto necesita un proveedor externo: es información que el negocio ya
 * tiene en un cuaderno.
 */

describe('alquiler de vehículo', () => {
    it('acepta lo completo y lo normaliza', () => {
        const { details, errors } = validateVehicleRentalDetails({
            driver: { name: '  Ana Pérez ', licenseNumber: 'AB123', licenseExpiresAt: '2028-04-30' },
            deposit: { amountCents: 50000000, currency: 'cop', status: 'held' },
            contract: { documentUrl: 'https://docs.example.com/c/1', signed: true },
            odometerOut: 12000,
            odometerIn: 12450,
        });

        expect(errors).toEqual([]);
        expect(details!.driver!.name).toBe('Ana Pérez');
        expect(details!.deposit!.currency).toBe('COP');
    });

    it('un monto sin moneda no se guarda', () => {
        // Un número sin moneda es una cifra que alguien va a cobrar en la que
        // le parezca.
        const { errors } = validateVehicleRentalDetails({
            deposit: { amountCents: 50000, status: 'held' },
        });
        expect(errors.join(' ')).toMatch(/currency/);
    });

    it('retener el depósito exige decir por qué', () => {
        // Retener plata sin motivo escrito es el reclamo del mes que viene sin
        // nada con qué contestarlo.
        const { errors } = validateVehicleRentalDetails({
            deposit: { amountCents: 50000, currency: 'COP', status: 'withheld' },
        });
        expect(errors.join(' ')).toMatch(/withheldReason/);

        const ok = validateVehicleRentalDetails({
            deposit: {
                amountCents: 50000, currency: 'COP', status: 'withheld',
                withheldReason: 'Rayón en la puerta trasera',
            },
        });
        expect(ok.errors).toEqual([]);
    });

    it('un contrato "firmado" sin evidencia no pasa', () => {
        const { errors } = validateVehicleRentalDetails({ contract: { signed: true } });
        expect(errors.join(' ')).toMatch(/evidence/);
    });

    it('una referencia OTP nunca puede ser el código crudo', () => {
        const { errors } = validateVehicleRentalDetails({
            contract: {
                signed: true,
                signedAt: '2026-08-10T10:00:00Z',
                signatureMethod: 'otp',
                evidenceRef: '123456',
            },
        });
        expect(errors.join(' ')).toMatch(/raw OTP/);
    });

    it('el documento del contrato tiene que ser https', () => {
        const { errors } = validateVehicleRentalDetails({
            contract: { signed: false, documentUrl: 'http://docs.example.com/c/1' },
        });
        expect(errors.join(' ')).toMatch(/https/);
    });

    it('el kilometraje de entrada no puede ser menor que el de salida', () => {
        const { errors } = validateVehicleRentalDetails({ odometerOut: 12000, odometerIn: 11000 });
        expect(errors.join(' ')).toMatch(/odometerIn/);
    });

    it('un conductor sin nombre no es un conductor', () => {
        const { errors } = validateVehicleRentalDetails({ driver: { licenseNumber: 'AB123' } });
        expect(errors.join(' ')).toMatch(/driver.name/);
    });

    it('vacío es válido: no todo alquiler tiene depósito', () => {
        expect(validateVehicleRentalDetails(undefined).errors).toEqual([]);
        expect(validateVehicleRentalDetails({}).errors).toEqual([]);
    });
});

describe('estadía de mascota', () => {
    it('acepta lo completo', () => {
        const { details, errors } = validatePetBoardingDetails({
            unitLabel: 'Box 4',
            compatibility: 'group_only',
            groupLabel: 'Pequeños tranquilos',
            mealsPerDay: 2,
            belongings: ['Manta azul', 'Juguete de goma'],
        });

        expect(errors).toEqual([]);
        expect(details!.belongings).toEqual(['Manta azul', 'Juguete de goma']);
    });

    it('"sólo con su grupo" exige decir cuál', () => {
        // Sin el grupo, el campo no le sirve a quien arma los patios por la
        // mañana: es exactamente la información que existe para dar.
        const { errors } = validatePetBoardingDetails({ compatibility: 'group_only' });
        expect(errors.join(' ')).toMatch(/groupLabel/);
    });

    it('una compatibilidad inventada no pasa', () => {
        const { errors } = validatePetBoardingDetails({ compatibility: 'lo_que_sea' });
        expect(errors.join(' ')).toMatch(/compatibility/);
    });

    it('no hay campo de medicación: eso es dato clínico', () => {
        // Vive en el registro de la mascota con su nivel de acceso, no en el
        // metadata de una estadía que el panel lista sin verificar identidad.
        const { details } = validatePetBoardingDetails({
            unitLabel: 'Box 4',
            medication: 'Antibiótico cada 8 horas',
        } as any);
        expect(JSON.stringify(details)).not.toMatch(/medication|Antibiótico/);
    });

    it('las pertenencias se acotan: no es un campo de notas', () => {
        const { details } = validatePetBoardingDetails({
            belongings: Array.from({ length: 40 }, (_, i) => `Cosa ${i}`),
        });
        expect(details!.belongings!.length).toBe(20);
    });
});

describe('el tipo elige el contrato', () => {
    it('un alquiler no valida como estadía ni al revés', () => {
        // `compatibility` no significa nada para un auto: se ignora, no se
        // guarda como si fuera un campo del vehículo.
        const asVehicle = validateResourceRentalDetails('vehicle_rental', {
            compatibility: 'social',
        });
        expect(asVehicle.errors).toEqual([]);
        expect(JSON.stringify(asVehicle.details)).not.toMatch(/compatibility/);

        const asBoarding = validateResourceRentalDetails('pet_boarding', {
            compatibility: 'social',
        });
        expect(asBoarding.details).toMatchObject({ compatibility: 'social' });
    });

    it('devuelve motivos, no un booleano', () => {
        // "Los datos son inválidos" sin decir cuál es lo que hace que el dueño
        // pruebe cinco veces y se rinda.
        const { errors } = validateResourceRentalDetails('vehicle_rental', {
            deposit: { amountCents: -1, currency: 'XX', status: 'nope' },
        });
        expect(errors.length).toBeGreaterThan(0);
        for (const error of errors) expect(error.length).toBeGreaterThan(10);
    });

    it('algo que no es un objeto se rechaza sin romper', () => {
        expect(validateResourceRentalDetails('vehicle_rental', 'texto').errors.length).toBe(1);
        expect(validateResourceRentalDetails('pet_boarding', []).errors.length).toBe(1);
    });
});
