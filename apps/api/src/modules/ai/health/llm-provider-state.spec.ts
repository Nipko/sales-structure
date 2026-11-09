import {
    alertForTransition, DOWN_AFTER_CONSECUTIVE_FAILURES, fallbackIsSignificant, INITIAL_PROVIDER_STATE,
    nextProviderState, ProviderObservation, ProviderState,
} from './llm-provider-state';
import { ProviderErrorKind } from './llm-provider-error';

const fail = (kind: ProviderErrorKind, at = 1000): ProviderObservation => ({ ok: false, at, source: 'traffic', kind, message: kind, model: 'm' });
const ok = (at = 2000): ProviderObservation => ({ ok: true, at, source: 'probe' });

function run(obs: ProviderObservation[], start: ProviderState = INITIAL_PROVIDER_STATE) {
    let state = start;
    const transitions = [];
    for (const o of obs) {
        const r = nextProviderState(state, o);
        state = r.state;
        transitions.push(r.transition);
    }
    return { state, transitions };
}

describe('nextProviderState', () => {
    it('un solo error de credito basta para no_credits, con primer y ultimo error', () => {
        const { state, transitions } = run([fail('quota', 10), fail('quota', 20)]);
        expect(state.status).toBe('no_credits');
        expect(state.firstErrorAt).toBe(10);
        expect(state.lastErrorAt).toBe(20);
        expect(state.since).toBe(10);
        expect(transitions[0]).toEqual({ from: 'unknown', to: 'no_credits' });
        expect(transitions[1]).toBeNull();
    });

    it('clave invalida -> auth_invalid', () => {
        expect(run([fail('auth')]).state.status).toBe('auth_invalid');
    });

    it('caidas: degradado y luego caido al tercer fallo seguido', () => {
        const obs = Array.from({ length: DOWN_AFTER_CONSECUTIVE_FAILURES }, (_, i) => fail('unavailable', i));
        const { state, transitions } = run(obs);
        expect(transitions[0]).toEqual({ from: 'unknown', to: 'degraded' });
        expect(state.status).toBe('down');
    });

    it('rate limit degrada pero no tumba', () => {
        const { state } = run([ok(), fail('rate_limit'), fail('rate_limit'), fail('rate_limit'), fail('rate_limit')]);
        expect(state.status).toBe('degraded');
    });

    it('un timeout no tapa un sin-credito', () => {
        const { state } = run([fail('quota'), fail('unavailable'), fail('unavailable'), fail('unavailable')]);
        expect(state.status).toBe('no_credits');
        expect(state.lastErrorKind).toBe('unavailable');
    });

    it('modelo retirado o peticion mala no cambian la salud del proveedor', () => {
        expect(run([ok(), fail('model_not_found'), fail('bad_request')]).state.status).toBe('healthy');
    });

    it('un exito recupera y limpia la racha', () => {
        const { state, transitions } = run([fail('quota', 10), ok(50)]);
        expect(state.status).toBe('healthy');
        expect(state.firstErrorAt).toBeNull();
        expect(state.consecutiveFailures).toBe(0);
        expect(state.lastErrorAt).toBe(10); // el ultimo error queda a la vista
        expect(transitions[1]).toEqual({ from: 'no_credits', to: 'healthy' });
    });
});

describe('alertForTransition', () => {
    it('avisa al entrar a un estado grave', () => {
        expect(alertForTransition({ from: 'healthy', to: 'no_credits' })).toBe('outage');
        expect(alertForTransition({ from: 'degraded', to: 'down' })).toBe('outage');
        expect(alertForTransition({ from: 'down', to: 'auth_invalid' })).toBe('outage');
    });
    it('avisa al recuperarse de uno grave', () => {
        expect(alertForTransition({ from: 'no_credits', to: 'healthy' })).toBe('recovery');
    });
    it('no avisa por degradaciones ni por volver de degradado', () => {
        expect(alertForTransition({ from: 'healthy', to: 'degraded' })).toBeNull();
        expect(alertForTransition({ from: 'degraded', to: 'healthy' })).toBeNull();
        expect(alertForTransition(null)).toBeNull();
    });
});

describe('fallbackIsSignificant', () => {
    it('requiere volumen minimo y 20%', () => {
        expect(fallbackIsSignificant({ total: 5, fallback: 5 })).toBe(false);
        expect(fallbackIsSignificant({ total: 100, fallback: 19 })).toBe(false);
        expect(fallbackIsSignificant({ total: 100, fallback: 20 })).toBe(true);
    });
});
