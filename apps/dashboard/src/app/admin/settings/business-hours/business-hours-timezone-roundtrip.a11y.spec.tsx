import * as fs from 'fs';
import * as path from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import {
    AGENT_ACCOUNT_DAYS, ALL_TIMEZONES, TIMEZONE_VALUES, normalizeTimezone,
    isAgentAccountBusinessHours, type AgentAccountBusinessHours,
} from '@parallext/shared';
import { isWithinOpeningHours } from '../../../../../../api/src/modules/conversations/informational-hours';
import { interact, type RenderedScreen } from '@/test/a11y';
import BusinessHoursPage from './page';

/**
 * PREPARED ONLY. Future destination:
 * apps/dashboard/src/app/admin/settings/business-hours/business-hours-timezone-roundtrip.a11y.spec.tsx
 *
 * Four locales x (valid non-curated IANA zone + curated positive control).
 * Real page/NextIntl/shared validator/normalizer/opening-hours consumer.
 * Only GET tenant and PATCH updateTenant are in-memory API-boundary doubles.
 * No SQL, real tenant write, LLM, real browser/AT, booking or HTTP auth is tested.
 * No PersonaService.buildSystemPrompt stub is substituted or claimed.
 * This tests zone representation/roundtrip, not the historical camelCase save defect.
 *
 * SOURCE/DATA PREFLIGHT completed before any Jest run, 2026-10-16T07:49:32.432Z:
 * real timezones.ts transpiled in memory and its normalizeTimezone executed.
 * America/Argentina/Ushuaia: Intl valid, not in TIMEZONE_VALUES, normalization
 * unchanged; 2026-10-19T11:30:00Z is Monday 08:30.
 * America/Mexico_City: Intl valid, listed, normalization unchanged; same instant
 * is Monday 05:30. These clock outcomes are explicit independent test oracles.
 * Root must preregister and reserve exclusive output paths before first Jest.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const FIXED_NOW = new Date('2026-10-19T11:30:00Z');
const AFTER_HOURS = 'Synthetic QA: no confirmed information; team help can be requested.';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
type Locale = typeof LOCALES[number];
const MESSAGES = Object.fromEntries(LOCALES.map(locale => [
    locale, JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')),
])) as Record<Locale, any>;
const ZONES = [
    { kind: 'valid non-curated IANA', zone: 'America/Argentina/Ushuaia', listed: false,
        labelToken: 'Ushuaia', expectedLocalClock: 'Monday 08:30', expectedOpen: true },
    { kind: 'curated positive control', zone: 'America/Mexico_City', listed: true,
        labelToken: 'Mexico City', expectedLocalClock: 'Monday 05:30', expectedOpen: false },
] as const;
const mockUnexpectedCalls: string[] = [];

jest.mock('@/lib/api', () => {
    const methods: Record<string, jest.Mock> = {};
    return { api: new Proxy(methods, {
        get(target, key) {
            if (typeof key !== 'string') return undefined;
            target[key] ??= jest.fn(async () => {
                mockUnexpectedCalls.push(key);
                throw new Error('Unexpected API call: ' + key);
            });
            return target[key];
        },
    }) };
});
jest.mock('@/contexts/TenantContext', () => ({
    useTenant: () => ({ activeTenantId: '11111111-1111-4111-8111-111111111111' }),
}));
jest.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({ user: { id: '22222222-2222-4222-8222-222222222222',
        role: 'tenant_admin', tenantId: '11111111-1111-4111-8111-111111111111' } }),
}));
const { api } = jest.requireMock('@/lib/api') as { api: Record<string, jest.Mock> };
if (typeof globalThis.structuredClone !== 'function') {
    const v8 = require('v8') as typeof import('v8');
    (globalThis as any).structuredClone = (value: unknown) => v8.deserialize(v8.serialize(value));
}

function hours(zone: string): AgentAccountBusinessHours {
    return {
        is247: false, timezone: zone, afterHoursMessage: AFTER_HOURS,
        schedule: Object.fromEntries(AGENT_ACCOUNT_DAYS.map(day =>
            [day, { enabled: day === 'monday', open: '08:00', close: '09:00' }],
        )) as AgentAccountBusinessHours['schedule'],
    };
}
function failUnexpected(method: string): never {
    mockUnexpectedCalls.push(method);
    throw new Error('Unexpected API call: ' + method);
}
function configureApi(stored: AgentAccountBusinessHours) {
    for (const [method, mock] of Object.entries(api))
        mock.mockReset().mockImplementation(() => failUnexpected(method));
    api.getTenant.mockImplementation(async (tenantId: string) => {
        if (tenantId !== TENANT) return failUnexpected('getTenant:' + tenantId);
        return { success: true, data: { id: TENANT, settings: { businessHours: structuredClone(stored) } } };
    });
    api.updateTenant.mockImplementation(async (tenantId: string, input: any) => {
        if (tenantId !== TENANT) return failUnexpected('updateTenant:' + tenantId);
        // Standard controller success/data envelope; no request is sent.
        return { success: true, data: { id: TENANT, settings: { businessHours: structuredClone(input.settings.businessHours) } } };
    });
}

async function openPage(locale: Locale): Promise<RenderedScreen> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(
        <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Bogota">
            <BusinessHoursPage />
        </NextIntlClientProvider>,
    ));
    await interact(() => {});
    return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}
function fixturePreflight(candidate: typeof ZONES[number], stored: AgentAccountBusinessHours) {
    // Validate fixtures before the product comparison; a changed runtime/catalog
    // must not be classified as a product regression.
    expect(() => new Intl.DateTimeFormat('en', { timeZone: candidate.zone }).format(FIXED_NOW)).not.toThrow();
    expect(TIMEZONE_VALUES.includes(candidate.zone)).toBe(candidate.listed);
    expect(normalizeTimezone(candidate.zone)).toBe(candidate.zone);
    expect(isAgentAccountBusinessHours(stored)).toBe(true);
    const localClock = new Intl.DateTimeFormat('en-GB', { timeZone: candidate.zone,
        weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(FIXED_NOW);
    expect(localClock).toBe(candidate.expectedLocalClock);
}

describe.each(LOCALES)('business-hours stored-zone representation and roundtrip (%s)', locale => {
    beforeEach(() => {
        mockUnexpectedCalls.length = 0;
        // Only suppress this page's saved-badge timeout after unmount.
        // The opening-hours oracle uses FIXED_NOW explicitly, not this clock.
        jest.useFakeTimers();
        for (const value of [MESSAGES[locale].common.saveChanges, MESSAGES[locale].settings.businessHoursPage.title])
            expect(typeof value).toBe('string');
    });
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        expect(mockUnexpectedCalls).toEqual([]);
    });

    it.each(ZONES)('$kind: visible selected zone and label agree with the unchanged saved and consumed zone', async candidate => {
        const stored = hours(candidate.zone);
        fixturePreflight(candidate, stored);
        configureApi(stored);
        const screen = await openPage(locale);
        try {
            expect(api.getTenant.mock.calls).toEqual([[TENANT]]);
            const selector = screen.container.querySelector<HTMLSelectElement>('#tour-target-hours-timezone select');
            if (!selector) throw new Error('The real business-hours page did not render its timezone selector');
            const selectedBeforeSave = {
                zone: selector.value,
                optionZone: selector.selectedOptions[0]?.value,
                label: selector.selectedOptions[0]?.textContent?.trim() ?? '',
            };
            const originalTimeFields = Array.from(screen.container.querySelectorAll<HTMLInputElement>('input[type="time"]'))
                .map(input => input.value);
            const originalMessage = screen.container.querySelector<HTMLTextAreaElement>('#tour-target-hours-message textarea')?.value;
            const save = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button'))
                .find(button => button.textContent?.trim() === MESSAGES[locale].common.saveChanges);
            if (!save) throw new Error('The real business-hours page did not render Save changes');
            await interact(() => save.click());
            expect(api.updateTenant).toHaveBeenCalledTimes(1);
            const [tenantId, request] = api.updateTenant.mock.calls[0];
            expect(tenantId).toBe(TENANT);
            // Assert the API producer and pure consumer before the DOM
            // comparison, so a red UI value cannot obscure a faithful payload.
            expect(request).toEqual({
                expectedBusinessHours: stored,
                settings: { businessHours: stored },
            });
            const submitted = request.settings.businessHours as AgentAccountBusinessHours;
            expect(isAgentAccountBusinessHours(submitted)).toBe(true);
            expect(isWithinOpeningHours(submitted, undefined, FIXED_NOW)).toBe(candidate.expectedOpen);
            expect(originalTimeFields).toEqual(['08:00', '09:00']);
            expect(originalMessage).toBe(AFTER_HOURS);
            const curated = ALL_TIMEZONES.find(option => option.value === candidate.zone);
            const labelCorresponds = curated
                ? selectedBeforeSave.label === curated.label
                : selectedBeforeSave.label.toLowerCase().includes(candidate.labelToken.toLowerCase());
            expect({
                visibleZone: selectedBeforeSave.zone,
                visibleOptionZone: selectedBeforeSave.optionZone,
                visibleLabelCorrespondsToStoredZone: labelCorresponds,
                submittedZone: submitted.timezone,
            }).toEqual({
                visibleZone: candidate.zone,
                visibleOptionZone: candidate.zone,
                visibleLabelCorrespondsToStoredZone: true,
                submittedZone: candidate.zone,
            });
            expect(mockUnexpectedCalls).toEqual([]);
        } finally { screen.unmount(); }
    });
});

