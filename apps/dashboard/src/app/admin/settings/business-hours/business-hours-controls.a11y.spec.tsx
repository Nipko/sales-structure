import * as fs from 'fs';
import * as path from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import axe from 'axe-core';
import { AGENT_ACCOUNT_DAYS, isAgentAccountBusinessHours, type AgentAccountBusinessHours } from '@parallext/shared';
import { interact, type RenderedScreen } from '@/test/a11y';
import BusinessHoursPage from './page';

/**
 * PREPARED ONLY. Future destination:
 * apps/dashboard/src/app/admin/settings/business-hours/business-hours-controls.a11y.spec.tsx
 *
 * PLAN: 16 cases, ES/EN/PT/FR x two product criteria + two controls.
 * Product 1: the 24/7 and seven weekday buttons expose a translated name,
 * switch role and current checked state.
 * Product 2: timezone, 14 time fields and the after-hours message have names
 * associated with the controls; each time name identifies weekday + open/close.
 * Controls: toggling Tuesday saves only that state change; a 24/7 on/off roundtrip
 * preserves every daily interval, timezone and message in the mocked save.
 *
 * Independent of the valid-non-curated-zone roundtrip and historical guardado:
 * this uses a curated zone and ALL SEVEN DAYS ENABLED (14 visible time inputs).
 * Prior registry/source audit found hours consumers, CAS and timezone coverage,
 * but no BusinessHoursPage switch/naming coverage. Catalog scope AGT-04/SET-01.
 * Source/data translation preflight, before any Jest: 13 existing nonempty
 * strings per locale were read successfully (Save, 24/7, timezone, message,
 * opening, closing, seven weekdays). No invented message key is required.
 *
 * This is local DOM + real NextIntl, not real assistive technology, focus/layout,
 * a browser keyboard path, production, SQL, LLM or global acceptance.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const MESSAGE = 'Synthetic QA: no confirmed information; request team help if needed.';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
type Locale = typeof LOCALES[number];
const MESSAGES = Object.fromEntries(LOCALES.map(locale => [
    locale, JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')),
])) as Record<Locale, any>;
const mockUnexpectedCalls: string[] = [];
let timersEnabled = false;

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

function initialHours(): AgentAccountBusinessHours {
    return {
        is247: false, timezone: 'America/Bogota', afterHoursMessage: MESSAGE,
        schedule: Object.fromEntries(AGENT_ACCOUNT_DAYS.map(day => [
            day, { enabled: true, open: '08:15', close: '17:45' },
        ])) as AgentAccountBusinessHours['schedule'],
    };
}
function unexpected(method: string): never {
    mockUnexpectedCalls.push(method);
    throw new Error('Unexpected API call: ' + method);
}
function configureApi() {
    for (const [method, mock] of Object.entries(api)) mock.mockReset().mockImplementation(() => unexpected(method));
    api.getTenant.mockImplementation(async (tenantId: string) => {
        if (tenantId !== TENANT) return unexpected('getTenant:' + tenantId);
        return { success: true, data: { id: TENANT, settings: { businessHours: initialHours() } } };
    });
    api.updateTenant.mockImplementation(async (tenantId: string, input: any) => {
        if (tenantId !== TENANT) return unexpected('updateTenant:' + tenantId);
        return { success: true, data: { id: TENANT,
            settings: { businessHours: structuredClone(input.settings.businessHours) } } };
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
    expect(api.getTenant.mock.calls).toEqual([[TENANT]]);
    return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}
function required<T extends Element>(container: HTMLElement, selector: string): T {
    const element = container.querySelector<T>(selector);
    if (!element) throw new Error('Real business-hours control was not rendered: ' + selector);
    return element;
}
function switch247(screen: RenderedScreen): HTMLButtonElement {
    return required(screen.container, '#tour-target-hours-247 button');
}
function dayButtons(screen: RenderedScreen): HTMLButtonElement[] {
    return Array.from(screen.container.querySelectorAll<HTMLButtonElement>('#tour-target-hours-days button'));
}
function saveButton(screen: RenderedScreen): HTMLButtonElement {
    return required(screen.container, '#tour-target-hours-save');
}
function canonicalText(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
/**
 * Explicit naming associations for these controls: aria-labelledby, aria-label,
 * native labels, and button text. This is not a replacement for the complete
 * accessible-name algorithm; axe independently checks label/select rules below.
 * A placeholder does not associate the visible heading with its control.
 */
function associatedName(control: HTMLElement): string {
    const references = (control.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    if (references.length) return references.map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
    const ariaLabel = control.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    const labels = (control as HTMLInputElement).labels;
    if (labels?.length) return Array.from(labels).map(label => label.textContent || '').join(' ').trim();
    return control.tagName === 'BUTTON' ? control.textContent?.trim() || '' : '';
}
function nameContains(control: HTMLElement, ...parts: string[]): boolean {
    const name = canonicalText(associatedName(control));
    return parts.every(part => name.includes(canonicalText(part)));
}
function useSaveBadgeTimers() {
    // No axe case uses fake timers; only the saved-badge timeout is isolated
    // in the two operational controls to avoid callbacks after unmount.
    jest.useFakeTimers();
    timersEnabled = true;
}

describe.each(LOCALES)('business-hours functional control names and state (%s)', locale => {
    beforeEach(() => {
        mockUnexpectedCalls.length = 0;
        timersEnabled = false;
        const t = MESSAGES[locale].settings.businessHoursPage;
        const clockLabels = MESSAGES[locale].setupWizard.customize;
        const strings = [MESSAGES[locale].common.saveChanges, t.is247, t.timezone, t.outOfHoursTitle,
            clockLabels.openTime, clockLabels.closeTime, ...AGENT_ACCOUNT_DAYS.map(day => t.days[day])];
        expect(strings.every(value => typeof value === 'string' && value.trim().length > 0)).toBe(true);
        expect(isAgentAccountBusinessHours(initialHours())).toBe(true);
        configureApi();
    });
    afterEach(() => {
        if (timersEnabled) { jest.clearAllTimers(); jest.useRealTimers(); }
        expect(mockUnexpectedCalls).toEqual([]);
    });

    it('product: 24/7 and all seven weekdays expose translated names, switch roles and checked states', async () => {
        const screen = await openPage(locale);
        try {
            const t = MESSAGES[locale].settings.businessHoursPage;
            const days = dayButtons(screen);
            expect(days).toHaveLength(7);
            const controls = [switch247(screen), ...days];
            const expectedNames = [t.is247, ...AGENT_ACCOUNT_DAYS.map(day => t.days[day])];
            const observed = controls.map((control, index) => ({
                namedForVisibleSetting: nameContains(control, expectedNames[index]),
                role: control.getAttribute('role'),
                checked: control.getAttribute('aria-checked'),
            }));
            expect(observed).toEqual(expectedNames.map((_label, index) => ({
                namedForVisibleSetting: true, role: 'switch', checked: index === 0 ? 'false' : 'true',
            })));
            expect(api.updateTenant).not.toHaveBeenCalled();
        } finally { screen.unmount(); }
    });

    it('product: timezone, fourteen day/time fields and message have associated translated names', async () => {
        const screen = await openPage(locale);
        try {
            const t = MESSAGES[locale].settings.businessHoursPage;
            const clockLabels = MESSAGES[locale].setupWizard.customize;
            const timezone = required<HTMLSelectElement>(screen.container, '#tour-target-hours-timezone select');
            const message = required<HTMLTextAreaElement>(screen.container, '#tour-target-hours-message textarea');
            const times = Array.from(screen.container.querySelectorAll<HTMLInputElement>('#tour-target-hours-days input[type="time"]'));
            expect(times).toHaveLength(14);
            const names = {
                timezone: nameContains(timezone, t.timezone),
                message: nameContains(message, t.outOfHoursTitle),
                dayTimes: times.map((input, index) => nameContains(input,
                    t.days[AGENT_ACCOUNT_DAYS[Math.floor(index / 2)]],
                    index % 2 === 0 ? clockLabels.openTime : clockLabels.closeTime)),
            };
            const violations = (await axe.run(screen.container, {
                runOnly: { type: 'rule', values: ['label', 'select-name'] },
            })).violations.map(finding => ({ id: finding.id, nodes: finding.nodes.length }));
            expect({ names, violations }).toEqual({
                names: { timezone: true, message: true, dayTimes: Array(14).fill(true) },
                violations: [],
            });
            expect(api.updateTenant).not.toHaveBeenCalled();
        } finally { screen.unmount(); }
    });

    it('control: switching Tuesday off saves only that day flag and preserves all other fields', async () => {
        useSaveBadgeTimers();
        const screen = await openPage(locale);
        try {
            expect(dayButtons(screen)).toHaveLength(7);
            await interact(() => dayButtons(screen)[1].click());
            const expected = initialHours();
            expected.schedule.tuesday.enabled = false;
            expect(screen.container.querySelectorAll('input[type="time"]')).toHaveLength(12);
            await interact(() => saveButton(screen).click());
            expect(api.updateTenant.mock.calls).toEqual([[TENANT, {
                expectedBusinessHours: initialHours(), settings: { businessHours: expected },
            }]]);
            expect(isAgentAccountBusinessHours(api.updateTenant.mock.calls[0][1].settings.businessHours)).toBe(true);
        } finally { screen.unmount(); }
    });

    it('control: 24/7 on/save then off/save retains the daily schedule, timezone and after-hours message', async () => {
        useSaveBadgeTimers();
        const screen = await openPage(locale);
        try {
            await interact(() => switch247(screen).click());
            expect(dayButtons(screen)).toHaveLength(0);
            expect(screen.container.querySelectorAll('input[type="time"]')).toHaveLength(0);
            await interact(() => saveButton(screen).click());
            const always = { ...initialHours(), is247: true };
            expect(api.updateTenant.mock.calls).toEqual([[TENANT, {
                expectedBusinessHours: initialHours(), settings: { businessHours: always },
            }]]);
            await interact(() => switch247(screen).click());
            expect(dayButtons(screen)).toHaveLength(7);
            expect(Array.from(screen.container.querySelectorAll<HTMLInputElement>('input[type="time"]')).map(input => input.value))
                .toEqual(AGENT_ACCOUNT_DAYS.flatMap(() => ['08:15', '17:45']));
            await interact(() => saveButton(screen).click());
            expect(api.updateTenant.mock.calls).toEqual([
                [TENANT, { expectedBusinessHours: initialHours(), settings: { businessHours: always } }],
                [TENANT, { expectedBusinessHours: always, settings: { businessHours: initialHours() } }],
            ]);
        } finally { screen.unmount(); }
    });
});

