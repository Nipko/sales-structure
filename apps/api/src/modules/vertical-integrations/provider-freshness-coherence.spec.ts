import {
    PROVIDER_FRESHNESS,
    VERTICAL_INTEGRATION_SYNC_CRON,
    VERTICAL_INTEGRATION_SYNC_INTERVAL_SECONDS,
    isMirrorBackedProviderTool,
    providerFreshnessContradictions,
    providerFreshnessFor,
} from '@parallext/shared';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { materializeIntegrationHealth, type StoredIntegrationHealth } from './integration-health';
import { PROVIDER_INTEGRATION_POLICIES } from '../conversations/effective-capability.service';
import { VerticalIntegrationsService } from './vertical-integrations.service';

/**
 * ═══ TRES NÚMEROS QUE DECIDÍAN LO MISMO Y NO SE HABLABAN ═══
 *
 * El cron de re-sync corre **una vez por día**. El contrato efectivo tenía un
 * presupuesto de frescura de **900 segundos** para Mindbody y Cliniko. La
 * salud que ve el dueño marcaba `stale` a las **36 horas**.
 *
 * Cada número era defendible solo. Juntos significaban que esas integraciones
 * quedaban despublicadas **23 horas y 45 minutos de cada día**, con el panel en
 * verde todo ese tiempo: "sincronizado hace 2 horas, sano" mientras el agente
 * contesta que no puede consultar la grilla. Nadie puede reconciliar eso
 * mirando la pantalla.
 */

describe('el presupuesto de frescura no puede contradecir a su propio cron', () => {
    it('ningún proveedor tiene un presupuesto menor o igual a su cadencia', () => {
        // Un presupuesto más chico que la cadencia apaga la integración la
        // mayor parte del día **por diseño**. Ese era exactamente el estado
        // anterior, y no lo detectaba nada porque los dos números vivían en
        // archivos distintos.
        expect(providerFreshnessContradictions()).toEqual([]);
    });

    it('y deja margen real: un sync fallido no apaga la integración al minuto', () => {
        for (const [provider, policy] of Object.entries(PROVIDER_FRESHNESS)) {
            const marginSeconds = policy.mirrorMaxAgeSeconds - policy.mirrorSyncIntervalSeconds;
            expect({ provider, marginSeconds: marginSeconds > 0 })
                .toEqual({ provider, marginSeconds: true });
            // Con un solo sync diario, el margen tiene que aguantar que un día
            // falle sin apagar nada. Dos días seguidos sí apagan, que es lo
            // correcto: a esa altura el dato ya no sirve.
            expect(marginSeconds).toBeGreaterThanOrEqual(6 * 3600);
        }
    });

    it('la cadencia declarada es la del cron que efectivamente corre', () => {
        const cronMetadata = Reflect.getMetadata(
            SCHEDULE_CRON_OPTIONS,
            VerticalIntegrationsService.prototype.resyncAllCron,
        );

        expect(cronMetadata?.cronTime).toBe(VERTICAL_INTEGRATION_SYNC_CRON);
        expect(VERTICAL_INTEGRATION_SYNC_CRON).toBe('0 5 * * *');
        expect(VERTICAL_INTEGRATION_SYNC_INTERVAL_SECONDS).toBe(24 * 60 * 60);
        for (const policy of Object.values(PROVIDER_FRESHNESS)) {
            expect(policy.mirrorSyncIntervalSeconds)
                .toBe(VERTICAL_INTEGRATION_SYNC_INTERVAL_SECONDS);
        }
    });
});

describe('la salud que ve el dueño usa el mismo número que decide publicar', () => {
    const stored = (lastSyncedMinutesAgo: number): StoredIntegrationHealth => ({
        version: 1,
        provider: 'mindbody',
        credentialValidated: true,
        requiredScopes: [],
        grantedScopes: [],
        scopeStatus: 'satisfied',
        lastCheckedAt: new Date().toISOString(),
        lastSuccessfulSyncAt: new Date(Date.now() - lastSyncedMinutesAgo * 60_000).toISOString(),
        consecutiveFailures: 0,
        circuitState: 'closed',
        lastError: null,
    });

    it('el panel declara el mismo presupuesto que aplica el contrato', () => {
        const health = materializeIntegrationHealth('mindbody', true, stored(30));
        expect(health.freshness.maxAgeSeconds)
            .toBe(providerFreshnessFor('mindbody')!.mirrorMaxAgeSeconds);
    });

    it('un sync de hace 2 horas es sano — y antes ya estaba despublicado', () => {
        // Éste es el caso exacto que producía la contradicción: verde en la
        // pantalla, tool ausente en la conversación.
        const health = materializeIntegrationHealth('mindbody', true, stored(120));
        expect(health.status).toBe('healthy');
        expect(health.freshness.stale).toBe(false);
        const budget = providerFreshnessFor('mindbody')!.mirrorMaxAgeSeconds;
        expect(120 * 60).toBeLessThan(budget);
    });

    it('pasado el presupuesto, el panel dice `stale` y el contrato despublica', () => {
        const budget = providerFreshnessFor('mindbody')!.mirrorMaxAgeSeconds;
        const health = materializeIntegrationHealth(
            'mindbody', true, stored(budget / 60 + 60),
        );
        expect(health.status).toBe('stale');
        expect(health.freshness.stale).toBe(true);
    });
});

describe('una lectura en vivo no tiene edad de espejo que medir', () => {
    it('`check_clinic_availability` va al proveedor, no al espejo', () => {
        // Aplicarle el presupuesto del espejo era medirle la edad a un dato que
        // se acababa de traer de Cliniko.
        expect(providerFreshnessFor('cliniko')!.liveTools)
            .toContain('check_clinic_availability');
        expect(isMirrorBackedProviderTool('check_clinic_availability')).toBe(false);
    });

    it('las otras tres sí salen del espejo', () => {
        for (const tool of ['get_restaurant_menu', 'get_fitness_schedule', 'list_clinic_services']) {
            expect(isMirrorBackedProviderTool(tool)).toBe(true);
        }
    });

    it('las dos listas cubren exactamente las tools que el contrato publica', () => {
        // Una tool nueva que quede fuera de las dos no tendría regla de
        // frescura, y el default silencioso volvería a ser el problema.
        for (const [provider, policy] of Object.entries(PROVIDER_INTEGRATION_POLICIES)) {
            const freshness = providerFreshnessFor(provider)!;
            const covered = [...freshness.mirrorBackedTools, ...freshness.liveTools].sort();
            expect({ provider, covered }).toEqual({ provider, covered: [...policy.tools].sort() });
        }
    });
});

describe('la pantalla puede explicar por qué el agente no la usa', () => {
    const healthy = (provider: 'toast' | 'mindbody' | 'cliniko'): StoredIntegrationHealth => ({
        version: 1,
        provider,
        credentialValidated: true,
        requiredScopes: [],
        grantedScopes: [],
        scopeStatus: 'satisfied',
        lastCheckedAt: new Date().toISOString(),
        lastSuccessfulSyncAt: new Date().toISOString(),
        consecutiveFailures: 0,
        circuitState: 'closed',
        lastError: null,
    });

    it('una integración impecable fuera de su rubro NO se muestra sana', () => {
        // Es el estado que la pantalla no podía explicar: credencial validada,
        // scopes completos, sync de hace un segundo — y el contrato no publica
        // ni una de sus tools porque este negocio no es un gimnasio.
        const health = materializeIntegrationHealth(
            'mindbody', true, healthy('mindbody'), new Date(), 'automotriz',
        );
        expect(health.status).toBe('not_applicable');
        expect(health.industryEligible).toBe(false);
    });

    it('la misma integración en su rubro sí', () => {
        const health = materializeIntegrationHealth(
            'mindbody', true, healthy('mindbody'), new Date(), 'gimnasios',
        );
        expect(health.status).toBe('healthy');
        expect(health.industryEligible).toBe(true);
    });

    it('Cliniko sano no se presenta como aplicable a una farmacia', () => {
        const health = materializeIntegrationHealth(
            'cliniko', true, healthy('cliniko'), new Date(), 'salud', 'farmacia',
        );
        expect(health.status).toBe('not_applicable');
        expect(health.industryEligible).toBe(false);
    });

    it('sin industria conocida no se declara inelegible', () => {
        // No saber el rubro no es motivo para apagar una integración que el
        // dueño conectó a mano. La puerta que decide de verdad es la del
        // contrato, que sí resuelve el perfil.
        const health = materializeIntegrationHealth(
            'mindbody', true, healthy('mindbody'), new Date(), null,
        );
        expect(health.industryEligible).toBe(true);
    });

    it('una integración que nadie configuró sigue diciendo `unavailable`', () => {
        // El orden importa: "no la configuraste" no necesita la explicación
        // larga de "no aplica a tu rubro".
        const health = materializeIntegrationHealth(
            'mindbody', false, null, new Date(), 'automotriz',
        );
        expect(health.status).toBe('unavailable');
    });
});
