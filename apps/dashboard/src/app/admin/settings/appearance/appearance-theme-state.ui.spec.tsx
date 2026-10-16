/** @jest-environment node */
// PREPARED ONLY. Synthetic theme dark; presentation state only, no theme activation/persistence.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

const OUT = process.env.APPEARANCE_THEME_EVIDENCE_DIR;
if (!OUT || !path.isAbsolute(OUT)) throw new Error('Exclusive evidence directory required');
const dump = (name: string, value: unknown) => fs.writeFileSync(path.join(OUT!, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const user = Object.freeze({ id: '11111111-1111-4111-8111-111111111111', role: 'tenant_admin', firstName: 'Synthetic', lastName: 'Appearance', email: 'operator@example.invalid' });
const boundaryErrors: string[] = [], apiCalls: string[] = [], themeCalls: unknown[] = [];
function unexpected(message: string): never { boundaryErrors.push(message); throw new Error(message); }
jest.mock('next-themes', () => ({ __esModule: true, useTheme: () => ({ theme: 'dark', setTheme: (...args: unknown[]) => { themeCalls.push(args); return unexpected('Unapproved theme activation'); } }) }));
jest.mock('@/contexts/AuthContext', () => ({ __esModule: true, useAuth: () => ({ user }) }));
jest.mock('@/lib/api', () => ({ __esModule: true, api: new Proxy({}, { get(_target, key) { return (..._args: unknown[]) => { apiCalls.push(String(key)); return unexpected('Unapproved API ' + String(key)); }; } }) }));

let dom: JSDOM, Page: any, NextIntlClientProvider: any, createRoot: any;
const globalKeys = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'HTMLInputElement', 'HTMLSelectElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
const prior = new Map<string, PropertyDescriptor | undefined>();
beforeAll(async () => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' });
    for (const key of globalKeys) {
        prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        const blocked = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].includes(key);
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : blocked ? function () { return unexpected('Unapproved transport ' + key); } : (dom.window as any)[key] });
    }
    for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) Object.defineProperty(dom.window, key, { configurable: true, writable: true, value: (globalThis as any)[key] });
    ({ createRoot } = await import('react-dom/client'));
    ({ NextIntlClientProvider } = await import('next-intl'));
    const pageSpecifier = './' + 'page'; Page = (await import(pageSpecifier)).default;
});
afterAll(() => {
    dom?.window.close();
    for (const key of globalKeys) { const old = prior.get(key); if (old) Object.defineProperty(globalThis, key, old); else delete (globalThis as any)[key]; }
});

for (const locale of ['es', 'en', 'pt', 'fr']) it(locale + ' selected appearance theme exposes its programmatic state', async () => {
    const observed: any = { locale, source: 'real_AppearancePage_NextIntl_HelpPanel_synthetic_dark_context_only', syntheticTheme: 'dark', options: null, programmaticState: null, apiCalls: [], themeCalls: [], boundaryErrors: [], activations: [], html: null, controlsPassedBeforeOracle: false, error: null };
    const startBoundary = boundaryErrors.length, startApi = apiCalls.length, startTheme = themeCalls.length;
    let root: any, container: HTMLDivElement | undefined;
    const activations: string[] = [], recordActivation = (event: Event) => activations.push(event.type);
    for (const type of ['click', 'input', 'change', 'submit']) dom.window.document.addEventListener(type, recordActivation, true);
    try {
        const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8'));
        const copy = messages.settings.appearancePage;
        container = dom.window.document.createElement('div'); container.dataset.caseOwned = locale; dom.window.document.body.appendChild(container); root = createRoot(container);
        await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages, timeZone: 'America/Bogota' }, createElement(Page))));
        if (container.querySelector('h1')?.textContent?.trim() !== copy.title) throw new Error('Prerequisite: translated Appearance H1');
        const buttons = ['light', 'dark', 'system'].map(key => {
            const spans = Array.from(container!.querySelectorAll('span')).filter(node => node.textContent?.trim() === copy[key + 'Label']);
            if (spans.length !== 1) throw new Error('Prerequisite: unique own theme label ' + key);
            const button = spans[0].closest('button');
            if (!button || !container!.contains(button) || button.disabled || button.querySelector('p')?.textContent?.trim() !== copy[key + 'Desc']) throw new Error('Prerequisite: own enabled native theme button and description ' + key);
            return button;
        });
        if (new Set(buttons).size !== 3 || buttons.some(button => button.parentElement !== buttons[0].parentElement)) throw new Error('Prerequisite: three distinct own theme options in one group');
        const selected = buttons.map(button => button.classList.contains('border-indigo-500') && !!button.querySelector('svg.lucide-check'));
        if (JSON.stringify(selected) !== JSON.stringify([false, true, false])) throw new Error('Prerequisite: dark visual state/badge matches synthetic context');
        observed.options = buttons.map((button, index) => ({ key: ['light', 'dark', 'system'][index], label: copy[['light', 'dark', 'system'][index] + 'Label'], description: button.querySelector('p')?.textContent?.trim(), selectedClassAndBadge: selected[index], role: button.getAttribute('role'), pressed: button.getAttribute('aria-pressed'), checked: button.getAttribute('aria-checked'), groupRole: button.closest('[role="radiogroup"]')?.getAttribute('role') ?? null, html: button.outerHTML }));
        const toggleState = buttons.every((button, index) => (button.getAttribute('role') === null || button.getAttribute('role') === 'button') && button.getAttribute('aria-pressed') === String(index === 1));
        const radioGroup = buttons[0].closest('[role="radiogroup"]');
        const radioState = !!radioGroup && buttons.every((button, index) => button.closest('[role="radiogroup"]') === radioGroup && button.getAttribute('role') === 'radio' && button.getAttribute('aria-checked') === String(index === 1));
        observed.programmaticState = { toggleState, radioState, exposedSelectionMatchesContext: toggleState || radioState };
        observed.apiCalls = apiCalls.slice(startApi); observed.themeCalls = themeCalls.slice(startTheme); observed.boundaryErrors = boundaryErrors.slice(startBoundary); observed.activations = [...activations];
        if (observed.apiCalls.length || observed.themeCalls.length || observed.boundaryErrors.length || activations.length) throw new Error('Prerequisite: no actions/theme calls/API/boundary errors');
        observed.controlsPassedBeforeOracle = true; observed.html = container.innerHTML;
        dump(locale + '-observed.json', observed);
        // FIRST product oracle. No interaction, persistence, focus, paint or real assistive technology claim.
        expect(observed.programmaticState.exposedSelectionMatchesContext).toEqual(true);
    } catch (error) {
        observed.error = String((error as Error).stack || error);
        if (!fs.existsSync(path.join(OUT!, locale + '-observed.json'))) dump(locale + '-observed.json', observed);
        throw error;
    } finally {
        if (root) await act(async () => root.unmount()); if (container) container.remove();
        for (const type of ['click', 'input', 'change', 'submit']) dom.window.document.removeEventListener(type, recordActivation, true);
        dump(locale + '-cleanup.json', { ownContainerRemoved: !container?.isConnected, remainingOwnedContainers: dom.window.document.querySelectorAll('[data-case-owned]').length, apiCalls: apiCalls.slice(startApi), themeCalls: themeCalls.slice(startTheme), boundaryErrors: boundaryErrors.slice(startBoundary), activations, timerInventoryMeasured: false });
    }
}, 15000);
