import {
    resolveVerticalCapabilityManifest,
    VERTICAL_CAPABILITY_MANIFEST_VERSION,
} from '@parallext/shared';
import {
    resolveVerticalWorkspace,
    resolveVerticalWorkspaceLabel,
    type VerticalWorkspaceInput,
    type VerticalWorkspaceKind,
} from '../verticalWorkspace';

describe('resolveVerticalWorkspace', () => {
    const canonicalIndustries: Array<{
        input: VerticalWorkspaceInput;
        expected: VerticalWorkspaceKind;
    }> = [
        { input: { industry: 'salud', subType: 'dental', bookingEnabled: true }, expected: 'appointments' },
        { input: { industry: 'moda_belleza', subType: 'salon_belleza', bookingEnabled: true }, expected: 'appointments' },
        { input: { industry: 'inmobiliaria', bookingEnabled: true }, expected: 'appointments' },
        { input: { industry: 'restaurantes', bookingEnabled: true }, expected: 'restaurant' },
        { input: { industry: 'automotriz', subType: 'concesionario', bookingEnabled: true }, expected: 'appointments' },
        { input: { industry: 'turismo', subType: 'tours', bookingEnabled: true }, expected: 'tours' },
        { input: { industry: 'education', bookingEnabled: true }, expected: 'education' },
        { input: { industry: 'finanzas', bookingEnabled: true }, expected: 'appointments' },
        { input: { industry: 'servicios_profesionales', bookingEnabled: true }, expected: 'appointments' },
        { input: { industry: 'retail', bookingEnabled: false }, expected: 'orders' },
        { input: { industry: 'technology', subType: 'saas', bookingEnabled: true }, expected: 'appointments' },
        { input: { industry: 'veterinaria', bookingEnabled: true }, expected: 'appointments' },
        { input: { industry: 'gimnasios', bookingEnabled: true }, expected: 'classes' },
        { input: { industry: 'seguros', bookingEnabled: false }, expected: 'insurance' },
        { input: { industry: 'servicios_hogar', bookingEnabled: true }, expected: 'service_requests' },
        { input: { industry: 'pet_services', subType: 'peluqueria', bookingEnabled: true }, expected: 'appointments' },
        { input: { industry: 'fotografia', bookingEnabled: true }, expected: 'photo_sessions' },
        { input: { industry: 'otro', bookingEnabled: false }, expected: 'orders' },
    ];

    const canonicalSubtypeMatrix: Array<{
        industry: string;
        subtypes: readonly string[];
        expected: VerticalWorkspaceKind | ((subtype: string) => VerticalWorkspaceKind);
    }> = [
        { industry: 'salud', subtypes: ['dental', 'medica_general', 'dermatologia', 'psicologia', 'farmacia'], expected: (subtype) => subtype === 'farmacia' ? 'orders' : 'appointments' },
        { industry: 'moda_belleza', subtypes: ['salon_belleza', 'barberia', 'spa', 'estetica'], expected: 'appointments' },
        { industry: 'inmobiliaria', subtypes: ['venta', 'arriendo', 'comercial', 'construccion'], expected: 'appointments' },
        { industry: 'restaurantes', subtypes: ['casual_dining', 'comida_rapida', 'cafeteria', 'dark_kitchen'], expected: 'restaurant' },
        { industry: 'automotriz', subtypes: ['concesionario', 'taller', 'repuestos', 'alquiler'], expected: (subtype) => ({ concesionario: 'appointments', taller: 'appointments', repuestos: 'orders', alquiler: 'vehicle_rentals' } as const)[subtype as 'concesionario' | 'taller' | 'repuestos' | 'alquiler'] },
        { industry: 'turismo', subtypes: ['agencia_viajes', 'hotel', 'tours', 'alquiler_vacacional'], expected: (subtype) => subtype === 'hotel' || subtype === 'alquiler_vacacional' ? 'stays' : 'tours' },
        { industry: 'education', subtypes: ['idiomas', 'universitaria', 'online', 'capacitacion'], expected: 'education' },
        { industry: 'finanzas', subtypes: ['asesoria', 'fintech', 'creditos'], expected: 'appointments' },
        { industry: 'servicios_profesionales', subtypes: ['abogados', 'contadores', 'arquitectos', 'consultores'], expected: 'appointments' },
        { industry: 'retail', subtypes: ['moda', 'electronica', 'hogar', 'marketplace'], expected: 'orders' },
        { industry: 'technology', subtypes: ['saas', 'consultoria_ti', 'desarrollo', 'hardware'], expected: (subtype) => subtype === 'hardware' ? 'orders' : 'appointments' },
        { industry: 'veterinaria', subtypes: ['clinica_general', 'hospital_24h', 'exoticos', 'peluqueria_canina'], expected: 'appointments' },
        { industry: 'gimnasios', subtypes: ['gimnasio_general', 'crossfit', 'yoga_pilates', 'cycling', 'martial_arts'], expected: 'classes' },
        { industry: 'seguros', subtypes: ['broker', 'aseguradora', 'vida', 'auto', 'salud'], expected: 'insurance' },
        { industry: 'servicios_hogar', subtypes: ['plomeria', 'electricidad', 'fumigacion', 'limpieza', 'jardineria', 'cerrajeria', 'pintura'], expected: 'service_requests' },
        { industry: 'pet_services', subtypes: ['peluqueria', 'guarderia', 'hotel', 'paseos', 'adiestramiento'], expected: (subtype) => ['guarderia', 'hotel'].includes(subtype) ? 'pet_boarding' : 'appointments' },
        { industry: 'fotografia', subtypes: ['estudio', 'bodas', 'eventos', 'producto', 'wedding_planner'], expected: 'photo_sessions' },
    ];

    const canonicalConfigurations = canonicalSubtypeMatrix.flatMap((entry) =>
        entry.subtypes.map((subType) => ({
            industry: entry.industry,
            subType,
            expected: typeof entry.expected === 'function' ? entry.expected(subType) : entry.expected,
        })),
    ).concat([{ industry: 'otro', subType: '', expected: 'orders' as VerticalWorkspaceKind }]);

    it.each(canonicalIndustries)(
        'resuelve $input.industry como $expected',
        ({ input, expected }) => {
            const manifest = resolveVerticalCapabilityManifest(input.industry || '', input.subType || null);
            expect(resolveVerticalWorkspace({
                ...input,
                manifestVersion: manifest.manifestVersion,
                effectiveCapabilities: manifest.capabilities,
            }).kind).toBe(expected);
        },
    );

    it.each(canonicalConfigurations)(
        'cubre la configuración canónica $industry/$subType como $expected',
        ({ industry, subType, expected }) => {
            const manifest = resolveVerticalCapabilityManifest(industry, subType || null);
            expect(resolveVerticalWorkspace({
                industry,
                subType: subType || null,
                bookingEnabled: true,
                manifestVersion: manifest.manifestVersion,
                effectiveCapabilities: manifest.capabilities,
            }).kind).toBe(expected);
        },
    );

    it.each([
        ['hotel', 'stays'],
        ['alquiler_vacacional', 'stays'],
        ['tours', 'tours'],
        ['agencia_viajes', 'tours'],
    ] as const)('resuelve turismo/%s como %s', (subType, expected) => {
        expect(resolveVerticalWorkspace({
            industry: 'turismo',
            subType,
            bookingEnabled: true,
        }).kind).toBe(expected);
    });

    it.each([
        ['concesionario', 'test_drives'],
        ['taller', 'appointments'],
        ['repuestos', 'orders'],
        ['alquiler', 'vehicle_rentals'],
    ] as const)('resuelve automotriz/%s como %s', (subType, expected) => {
        expect(resolveVerticalWorkspace({
            industry: 'automotriz',
            subType,
            bookingEnabled: true,
        }).kind).toBe(expected);
    });

    it.each([
        ['peluqueria', 'appointments'],
        ['guarderia', 'pet_boarding'],
        ['hotel', 'pet_boarding'],
        ['paseos', 'appointments'],
        ['adiestramiento', 'appointments'],
    ] as const)('resuelve pet_services/%s como %s', (subType, expected) => {
        expect(resolveVerticalWorkspace({
            industry: 'pet_services',
            subType,
            bookingEnabled: true,
        }).kind).toBe(expected);
    });

    it.each([
        ['saas', 'appointments'],
        ['consultoria_ti', 'appointments'],
        ['desarrollo', 'appointments'],
        ['hardware', 'orders'],
    ] as const)('resuelve technology/%s como %s', (subType, expected) => {
        expect(resolveVerticalWorkspace({
            industry: 'technology',
            subType,
            bookingEnabled: true,
        }).kind).toBe(expected);
    });

    it.each([
        ['salud', 'farmacia'],
        ['moda_belleza', 'boutique'],
    ] as const)('resuelve la excepción %s/%s como pedidos', (industry, subType) => {
        expect(resolveVerticalWorkspace({
            industry,
            subType,
            bookingEnabled: true,
        }).kind).toBe('orders');
    });

    it.each([
        { industry: 'restaurantes', expected: 'restaurant' },
        { industry: 'education', expected: 'education' },
        { industry: 'retail', expected: 'orders' },
        { industry: 'gimnasios', expected: 'classes' },
        { industry: 'seguros', expected: 'insurance' },
        { industry: 'servicios_hogar', expected: 'service_requests' },
        { industry: 'fotografia', expected: 'photo_sessions' },
        { industry: 'otro', expected: 'orders' },
    ] as const)('prioriza el modelo especializado de $industry', ({ industry, expected }) => {
        expect(resolveVerticalWorkspace({ industry, bookingEnabled: false }).kind).toBe(expected);
    });

    it('usa un fallback neutral y nunca inventa citas para una vertical desconocida', () => {
        expect(resolveVerticalWorkspace({ industry: 'vertical_futura' }).kind).toBe('none');
        expect(resolveVerticalWorkspace({ industry: 'vertical_futura', bookingEnabled: true }).kind).toBe('none');
        expect(resolveVerticalWorkspace({ industry: 'vertical_futura', bookingEnabled: null }).kind).toBe('none');
        expect(resolveVerticalWorkspace({ industry: 'vertical_futura', bookingEnabled: false }).kind).toBe('none');
        expect(resolveVerticalWorkspace({ industry: 'finanzas', bookingEnabled: false }).kind).toBe('none');
    });

    it.each([
        ['nightly_booking', 'stays'],
        ['tour_booking', 'tours'],
        ['restaurant_ordering', 'restaurant'],
        ['course_enrollment', 'education'],
        ['membership_management', 'classes'],
        ['insurance_operations', 'insurance'],
        ['service_requests', 'service_requests'],
        ['photo_sessions', 'photo_sessions'],
        ['vehicle_rentals', 'vehicle_rentals'],
        ['pet_boarding', 'pet_boarding'],
        ['catalog_search', 'orders'],
        ['appointment_booking', 'appointments'],
    ] as const)('prioriza la capacidad versionada %s como %s', (capability, expected) => {
        expect(resolveVerticalWorkspace({
            industry: 'vertical_futura',
            effectiveCapabilities: [capability],
        }).kind).toBe(expected);
    });

    it('trata un contrato de capacidades vacío como una decisión explícita de ocultar', () => {
        expect(resolveVerticalWorkspace({
            industry: 'finanzas',
            bookingEnabled: true,
            effectiveCapabilities: [],
        }).kind).toBe('none');
        expect(resolveVerticalWorkspace({
            industry: 'automotriz',
            subType: 'alquiler',
            effectiveCapabilities: [],
        }).kind).toBe('none');
        expect(resolveVerticalWorkspace({
            industry: 'pet_services',
            subType: 'hotel',
            effectiveCapabilities: [],
        }).kind).toBe('none');
        expect(resolveVerticalWorkspace({
            industry: 'turismo',
            subType: 'hotel',
            manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
        }).kind).toBe('none');
    });

    it('mantiene el workspace legado hasta que el manifiesto actual se publica', () => {
        expect(resolveVerticalWorkspace({
            industry: 'automotriz',
            subType: 'alquiler',
            manifestVersion: 1,
            effectiveCapabilities: ['appointment_booking'],
        }).kind).toBe('vehicle_rentals');
        expect(resolveVerticalWorkspace({
            industry: 'automotriz',
            subType: 'concesionario',
            manifestVersion: 1,
            effectiveCapabilities: ['appointment_booking'],
        }).kind).toBe('test_drives');
        expect(resolveVerticalWorkspace({
            industry: 'automotriz',
            subType: 'concesionario',
            manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
            effectiveCapabilities: ['appointment_booking'],
        }).kind).toBe('appointments');
    });

    it('devuelve metadatos de presentación basados en claves de i18n', () => {
        expect(resolveVerticalWorkspace({ industry: 'servicios_hogar' })).toEqual({
            kind: 'service_requests',
            iconName: 'construct-outline',
            labelKey: 'workspace.serviceRequests',
        });
    });

    it('normaliza industria y subtipo antes de resolver', () => {
        expect(resolveVerticalWorkspace({
            industry: ' TURISMO ',
            subType: ' HOTEL ',
            bookingEnabled: false,
        }).kind).toBe('stays');
    });

    it('ningún caso con modelo especializado cae en citas', () => {
        const specializedCases: VerticalWorkspaceInput[] = [
            { industry: 'turismo', subType: 'hotel' },
            { industry: 'turismo', subType: 'alquiler_vacacional' },
            { industry: 'turismo', subType: 'tours' },
            { industry: 'turismo', subType: 'agencia_viajes' },
            { industry: 'restaurantes' },
            { industry: 'gimnasios' },
            { industry: 'education' },
            { industry: 'seguros' },
            { industry: 'servicios_hogar' },
            { industry: 'fotografia' },
            { industry: 'retail' },
            { industry: 'otro' },
            { industry: 'salud', subType: 'farmacia' },
            { industry: 'moda_belleza', subType: 'boutique' },
            { industry: 'automotriz', subType: 'repuestos' },
            { industry: 'automotriz', subType: 'alquiler' },
            { industry: 'pet_services', subType: 'guarderia' },
            { industry: 'pet_services', subType: 'hotel' },
            { industry: 'technology', subType: 'hardware' },
        ];

        for (const input of specializedCases) {
            expect(resolveVerticalWorkspace({ ...input, bookingEnabled: true }).kind)
                .not.toBe('appointments');
        }
    });
});

describe('resolveVerticalWorkspaceLabel', () => {
    // Mirrors the shipped es catalog for the keys this helper touches.
    const CATALOG: Record<string, string> = {
        'workspace.appointments': 'Agenda',
        'workspace.stays': 'Estadías',
        'workspace.orders': 'Pedidos',
        'nav.citas': 'Citas',
    };
    const t = (key: string) => CATALOG[key] ?? key;

    const label = (verticalConfig: unknown) => resolveVerticalWorkspaceLabel({
        verticalConfig: verticalConfig as never,
        workspace: resolveVerticalWorkspace((verticalConfig || {}) as VerticalWorkspaceInput),
        locale: 'es',
        t,
    });

    it('gives the tab and the screen header the same name for a technology tenant', () => {
        // The regression: `technology` ships transactionNoun.es = 'deal' and no
        // label override, so the tab read "Deal" over a header reading "Agenda".
        const config = {
            industry: 'technology',
            subType: 'saas',
            bookingEnabled: true,
            terminology: { transactionNoun: { es: 'deal', en: 'deal', pt: 'deal', fr: 'affaire' } },
        };
        expect(resolveVerticalWorkspace(config).kind).toBe('appointments');
        expect(label(config)).toBe('Deal');
    });

    it('prefers an explicit tenant override over the terminology noun', () => {
        expect(label({
            industry: 'salud',
            subType: 'dental',
            bookingEnabled: true,
            terminology: { transactionNoun: { es: 'cita' } },
            sidebar: { labelOverrides: { appointments: { es: 'turnos' } } },
        })).toBe('Turnos');
    });

    it('capitalizes the tenant vocabulary', () => {
        expect(label({
            industry: 'salud',
            bookingEnabled: true,
            terminology: { transactionNoun: { es: 'consulta' } },
        })).toBe('Consulta');
    });

    it('accepts a plain string as well as a localized map', () => {
        expect(label({
            industry: 'salud',
            bookingEnabled: true,
            terminology: { transactionNoun: 'cita' },
        })).toBe('Cita');
    });

    it('keeps the catalog name on specialized kinds even if an appointments override exists', () => {
        // A stays tenant must stay "Estadías": the override is appointments-shaped
        // and must not rename a workspace that has its own translated label.
        const config = {
            industry: 'turismo',
            subType: 'hotel',
            bookingEnabled: true,
            terminology: { transactionNoun: { es: 'reserva' } },
            sidebar: { labelOverrides: { appointments: { es: 'turnos' } } },
        };
        expect(resolveVerticalWorkspace(config).kind).toBe('stays');
        expect(label(config)).toBe('Estadías');
    });

    it('falls back to tenant vocabulary when the catalog lacks the workspace key', () => {
        const bare = (key: string) => key; // translation bundle older than the kind
        expect(resolveVerticalWorkspaceLabel({
            verticalConfig: { terminology: { transactionNoun: { es: 'póliza' } } } as never,
            workspace: resolveVerticalWorkspace({ industry: 'seguros', bookingEnabled: false }),
            locale: 'es',
            t: bare,
        })).toBe('Póliza');
    });

    it('falls back to the generic label with no tenant config at all', () => {
        expect(label(null)).toBe('Citas');
    });
});
