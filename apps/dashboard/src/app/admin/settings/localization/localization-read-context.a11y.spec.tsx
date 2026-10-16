import * as fs from 'fs';
import * as path from 'path';
import { act, type Provider } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { interact, type RenderedScreen } from '@/test/a11y';
import LocalizationPage from './page';

/**
 * PREPARED ONLY: root must preregister before the first Jest execution.
 * Destination: apps/dashboard/src/app/admin/settings/localization/
 * localization-read-context.a11y.spec.tsx
 *
 * 4 real locales x 5 functional criteria. The real page, HelpPanel and
 * RegionalIdentityCard render; all API methods are strict boundary doubles.
 * Tenant/auth contexts use ordinary React providers and matching synthetic
 * tenant_admin sessions. Rerender represents a supplied authorized context
 * transition, NOT a test of impersonation, authentication or backend guards.
 * No HTTP, SQL, production UI, real persistence, LLM or assistive technology.
 * No regional-declare/review/refresh action is activated. No field is edited.
 * No private state/effect/cancellation flag or hidden DOM is inspected.
 * Only public form values, native button activation and boundary payloads.
 * This is independent of CFG01 hours, DEF038 and DEF123 timezone representation.
 */
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
type Locale = typeof LOCALES[number];
type TenantId = typeof TENANT_A | typeof TENANT_B;
type ReadEnvelope = { success: true; data: { id: string; language: string; settings: Record<string, string> } }
    | { success: false; error: string };
type ContextValue = { activeTenantId: TenantId };
type AuthValue = { user: { id: string; role: string; tenantId: TenantId } };
const MESSAGES = Object.fromEntries(LOCALES.map(locale => [locale,
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')),
])) as Record<Locale, any>;
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
jest.mock('@/contexts/TenantContext', () => {
    const React = jest.requireActual('react') as typeof import('react');
    const context = React.createContext<ContextValue>({ activeTenantId: '11111111-1111-4111-8111-111111111111' });
    return { FixtureTenantProvider: context.Provider, useTenant: () => React.useContext(context) };
});
jest.mock('@/contexts/AuthContext', () => {
    const React = jest.requireActual('react') as typeof import('react');
    const context = React.createContext<AuthValue>({ user: {
        id: '33333333-3333-4333-8333-333333333333', role: 'tenant_admin',
        tenantId: '11111111-1111-4111-8111-111111111111',
    } });
    return { FixtureAuthProvider: context.Provider, useAuth: () => React.useContext(context) };
});
const { api } = jest.requireMock('@/lib/api') as { api: Record<string, jest.Mock> };
const { FixtureTenantProvider } = jest.requireMock('@/contexts/TenantContext') as { FixtureTenantProvider: Provider<ContextValue> };
const { FixtureAuthProvider } = jest.requireMock('@/contexts/AuthContext') as { FixtureAuthProvider: Provider<AuthValue> };

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; });
    return { promise, resolve };
}
function regionalBody(id: TenantId) {
    return id === TENANT_A ? {
        language: 'es-CO', settings: {
            timezone: 'America/Bogota', currency: 'COP', dateFormat: 'DD/MM/YYYY', timeFormat: '24h', weekStart: 'monday',
        },
    } : {
        language: 'en-US', settings: {
            timezone: 'America/New_York', currency: 'USD', dateFormat: 'YYYY-MM-DD', timeFormat: '12h', weekStart: 'sunday',
        },
    };
}
function readEnvelope(id: TenantId): ReadEnvelope {
    return { success: true, data: { id, ...regionalBody(id) } };
}
function unexpected(method: string): never {
    mockUnexpectedCalls.push(method);
    throw new Error('Unexpected API call: ' + method);
}
function configureApi(reads: Map<TenantId, Promise<ReadEnvelope>>) {
    for (const [method, mock] of Object.entries(api)) mock.mockReset().mockImplementation(() => unexpected(method));
    api.getTenant.mockImplementation((id: TenantId) => reads.has(id) ? reads.get(id)! : unexpected('getTenant:' + id));
    api.getRegionalProfile.mockImplementation(async (id: TenantId) => reads.has(id)
        ? { success: false, error: 'Synthetic optional regional profile unavailable' } : unexpected('getRegionalProfile:' + id));
    api.getRegionalReviews.mockImplementation(async (id: TenantId) => reads.has(id)
        ? { success: true, data: [] } : unexpected('getRegionalReviews:' + id));
    api.updateTenant.mockImplementation(async (id: TenantId) => {
        if (!reads.has(id)) return unexpected('updateTenant:' + id);
        // Capture a faithful PATCH-boundary call but do not certify backend persistence.
        // Failure envelope also avoids a successful-save timeout obscuring the oracle.
        return { success: false, error: 'Synthetic save result; no persistence was attempted' };
    });
}
interface ContextScreen extends RenderedScreen { rerender: (tenantId: TenantId) => Promise<void> }
async function openPage(locale: Locale, tenantId: TenantId): Promise<ContextScreen> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const rerender = async (currentId: TenantId) => {
        await act(async () => root.render(
            <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Bogota">
                <FixtureAuthProvider value={{ user: {
                    id: '33333333-3333-4333-8333-333333333333', role: 'tenant_admin', tenantId: currentId,
                } }}>
                    <FixtureTenantProvider value={{ activeTenantId: currentId }}>
                        <LocalizationPage />
                    </FixtureTenantProvider>
                </FixtureAuthProvider>
            </NextIntlClientProvider>,
        ));
        await interact(() => {});
    };
    await rerender(tenantId);
    return { container, rerender, unmount: () => { act(() => root.unmount()); container.remove(); } };
}
function saveButton(screen: RenderedScreen, locale: Locale): HTMLButtonElement {
    const matches = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button'))
        .filter(button => button.textContent?.trim() === MESSAGES[locale].common.saveChanges);
    expect(matches).toHaveLength(1);
    return matches[0];
}
function selectContaining(screen: RenderedScreen, optionValue: string): HTMLSelectElement {
    const matches = Array.from(screen.container.querySelectorAll<HTMLSelectElement>('select'))
        .filter(select => Array.from(select.options).some(option => option.value === optionValue));
    expect(matches).toHaveLength(1);
    return matches[0];
}
function visibleForm(screen: RenderedScreen) {
    return {
        language: selectContaining(screen, 'es-CO').value,
        settings: {
            timezone: selectContaining(screen, 'America/Bogota').value,
            currency: selectContaining(screen, 'COP').value,
            dateFormat: selectContaining(screen, 'DD/MM/YYYY').value,
            timeFormat: selectContaining(screen, '24h').value,
            weekStart: selectContaining(screen, 'monday').value,
        },
    };
}
function expectExactReads(tenants: TenantId[]) {
    const expected = tenants.map(id => [id]);
    expect(api.getTenant.mock.calls).toEqual(expected);
    expect(api.getRegionalProfile.mock.calls).toEqual(expected);
    expect(api.getRegionalReviews.mock.calls).toEqual(expected);
}

describe.each(LOCALES)('LocalizationPage read ownership and save eligibility (%s)', locale => {
    beforeEach(() => {
        mockUnexpectedCalls.length = 0;
        expect(typeof MESSAGES[locale].common.saveChanges).toBe('string');
        expect(typeof MESSAGES[locale].settings.localizationPage.title).toBe('string');
    });
    afterEach(() => expect(mockUnexpectedCalls).toEqual([]));

    it('keeps saving unavailable while the initial regional preferences read is pending', async () => {
        const pending = deferred<ReadEnvelope>();
        configureApi(new Map([[TENANT_A, pending.promise]]));
        const screen = await openPage(locale, TENANT_A);
        try {
            const button = saveButton(screen, locale);
            await interact(() => button.click());
            expectExactReads([TENANT_A]);
            expect({ disabled: button.disabled, writes: api.updateTenant.mock.calls }).toEqual({ disabled: true, writes: [] });
        } finally { screen.unmount(); }
    });

    it('keeps saving unavailable after the initial regional preferences read fails', async () => {
        const pending = deferred<ReadEnvelope>();
        configureApi(new Map([[TENANT_A, pending.promise]]));
        const screen = await openPage(locale, TENANT_A);
        try {
            await interact(() => pending.resolve({ success: false, error: 'Synthetic tenant read unavailable' }));
            const button = saveButton(screen, locale);
            await interact(() => button.click());
            expectExactReads([TENANT_A]);
            expect({ disabled: button.disabled, writes: api.updateTenant.mock.calls }).toEqual({ disabled: true, writes: [] });
        } finally { screen.unmount(); }
    });

    it('cannot save A regional values into current context B before B preferences have loaded', async () => {
        const older = deferred<ReadEnvelope>(), current = deferred<ReadEnvelope>();
        configureApi(new Map([[TENANT_A, older.promise], [TENANT_B, current.promise]]));
        const screen = await openPage(locale, TENANT_A);
        try {
            await interact(() => older.resolve(readEnvelope(TENANT_A)));
            expect(visibleForm(screen)).toEqual(regionalBody(TENANT_A));
            await screen.rerender(TENANT_B);
            const button = saveButton(screen, locale);
            await interact(() => button.click());
            expectExactReads([TENANT_A, TENANT_B]);
            expect({ disabled: button.disabled, writes: api.updateTenant.mock.calls }).toEqual({ disabled: true, writes: [] });
        } finally { screen.unmount(); }
    });

    it('late A response cannot replace B visible preferences or supply the later B save payload', async () => {
        const older = deferred<ReadEnvelope>(), current = deferred<ReadEnvelope>();
        configureApi(new Map([[TENANT_A, older.promise], [TENANT_B, current.promise]]));
        const screen = await openPage(locale, TENANT_A);
        try {
            await screen.rerender(TENANT_B);
            await interact(() => current.resolve(readEnvelope(TENANT_B)));
            expect(visibleForm(screen)).toEqual(regionalBody(TENANT_B));
            await interact(() => older.resolve(readEnvelope(TENANT_A)));
            await interact(() => saveButton(screen, locale).click());
            expectExactReads([TENANT_A, TENANT_B]);
            expect({ visible: visibleForm(screen), writes: api.updateTenant.mock.calls }).toEqual({
                visible: regionalBody(TENANT_B), writes: [[TENANT_B, regionalBody(TENANT_B)]],
            });
        } finally { screen.unmount(); }
    });

    it('control: current B response hydrates its own form and unchanged save payload', async () => {
        const current = deferred<ReadEnvelope>();
        configureApi(new Map([[TENANT_B, current.promise]]));
        const screen = await openPage(locale, TENANT_B);
        try {
            await interact(() => current.resolve(readEnvelope(TENANT_B)));
            const button = saveButton(screen, locale);
            expect(button.disabled).toBe(false);
            await interact(() => button.click());
            expectExactReads([TENANT_B]);
            expect({ visible: visibleForm(screen), writes: api.updateTenant.mock.calls }).toEqual({
                visible: regionalBody(TENANT_B), writes: [[TENANT_B, regionalBody(TENANT_B)]],
            });
        } finally { screen.unmount(); }
    });
});
