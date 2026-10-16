/** @jest-environment node */
// PREPARED ONLY: axe button-name on ONLY current-password visibility button, no activation.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

const OUT = process.env.PASSWORD_TOGGLE_EVIDENCE_DIR;
if (!OUT || !path.isAbsolute(OUT)) throw new Error('Exclusive evidence directory required');
const dump = (name: string, value: unknown) => fs.writeFileSync(path.join(OUT!, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const user = Object.freeze({ id: '11111111-1111-4111-8111-111111111111', role: 'tenant_admin', firstName: 'Synthetic', lastName: 'Operator', email: 'operator@example.invalid', hasPassword: true });
const boundaryErrors: string[] = [], apiCalls: string[] = [], navigationCalls: string[] = [];
function unexpected(message: string): never { boundaryErrors.push(message); throw new Error(message); }
jest.mock('next/navigation', () => ({ __esModule: true, useRouter: () => new Proxy({}, { get(_target, key) { return (..._args: unknown[]) => { navigationCalls.push(String(key)); return unexpected('Unapproved navigation ' + String(key)); }; } }) }));
jest.mock('@/contexts/AuthContext', () => ({ __esModule: true, useAuth: () => ({ user }) }));
jest.mock('@/lib/api', () => ({ __esModule: true, api: new Proxy({}, { get(_target, key) { return (..._args: unknown[]) => { apiCalls.push(String(key)); return unexpected('Unapproved API ' + String(key)); }; } }) }));

let dom: JSDOM, Page: any, NextIntlClientProvider: any, createRoot: any, axe: any;
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
    // Load axe and product graph only after the owned DOM globals exist.
    const axeModule = await import('axe-core'); axe = axeModule.default || axeModule;
    ({ createRoot } = await import('react-dom/client'));
    ({ NextIntlClientProvider } = await import('next-intl'));
    const pageSpecifier = './' + 'page'; Page = (await import(pageSpecifier)).default;
});
afterAll(() => {
    dom?.window.close();
    for (const key of globalKeys) { const old = prior.get(key); if (old) Object.defineProperty(globalThis, key, old); else delete (globalThis as any)[key]; }
});

for (const locale of ['es', 'en', 'pt', 'fr']) it(locale + ' current password visibility button has an accessible name', async () => {
    const observed: any = { locale, source: 'real_ChangePasswordPage_NextIntl_HelpPanel_synthetic_hasPassword_context_only', apiCalls: [], inputs: null, currentToggle: null, accessibility: null, html: null, boundaryErrors: [], controlsPassedBeforeOracle: false, error: null };
    const startBoundary = boundaryErrors.length, startApi = apiCalls.length, startNavigation = navigationCalls.length;
    let root: any, container: HTMLDivElement | undefined;
    const activations: string[] = [];
    const recordActivation = (event: Event) => activations.push(event.type);
    for (const type of ['click', 'input', 'change', 'submit']) dom.window.document.addEventListener(type, recordActivation, true);
    try {
        const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8'));
        container = dom.window.document.createElement('div'); container.dataset.caseOwned = locale; dom.window.document.body.appendChild(container); root = createRoot(container);
        await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages, timeZone: 'America/Bogota' }, createElement(Page))));
        const copy = messages.changePassword, form = container.querySelector('form');
        const inputs = Array.from(form?.querySelectorAll('input') || []);
        const labels = Array.from(form?.querySelectorAll('label') || []).map(node => node.textContent?.trim());
        if (container.querySelector('h1')?.textContent?.trim() !== copy.title || !form || inputs.length !== 3 || inputs.some(input => input.type !== 'password' || input.value !== '' || input.disabled)) throw new Error('Prerequisite: translated title/form/three empty enabled password inputs');
        if (JSON.stringify(labels) !== JSON.stringify([copy.currentLabel, copy.newLabel, copy.confirmLabel]) || JSON.stringify(inputs.map(input => input.placeholder)) !== JSON.stringify([copy.currentPlaceholder, copy.newPlaceholder, copy.confirmPlaceholder])) throw new Error('Prerequisite: real translated labels/placeholders');
        const candidates = Array.from(inputs[0].parentElement!.querySelectorAll('button'));
        const button = candidates[0], save = form.querySelector('button[type="submit"]');
        if (candidates.length !== 1 || !button || button.type !== 'button' || button.disabled || !button.querySelector('svg.lucide-eye') || !container.contains(button) || !(save as HTMLButtonElement)?.disabled) throw new Error('Prerequisite: unique native current visibility button/Eye and disabled untouched submit');
        observed.inputs = inputs.map(input => ({ type: input.type, value: input.value, disabled: input.disabled, placeholder: input.placeholder }));
        observed.labels = labels;
        observed.currentToggle = { html: button.outerHTML, type: button.type, disabled: button.disabled, ariaLabel: button.getAttribute('aria-label'), ariaLabelledby: button.getAttribute('aria-labelledby'), title: button.getAttribute('title'), text: button.textContent };
        observed.apiCalls = apiCalls.slice(startApi); observed.navigationCalls = navigationCalls.slice(startNavigation); observed.boundaryErrors = boundaryErrors.slice(startBoundary);
        if (observed.apiCalls.length || observed.navigationCalls.length || observed.boundaryErrors.length || activations.length) throw new Error('Prerequisite: zero API/navigation/boundary/action');
        observed.controlsPassedBeforeOracle = true;
        const result = await axe.run({ include: [button] }, { runOnly: ['button-name'] });
        observed.accessibility = { scope: 'current-password visibility button ONLY', rule: 'button-name', version: axe.version, violations: result.violations, passes: result.passes, incomplete: result.incomplete };
        observed.html = container.innerHTML; observed.apiCalls = apiCalls.slice(startApi); observed.navigationCalls = navigationCalls.slice(startNavigation); observed.boundaryErrors = boundaryErrors.slice(startBoundary); observed.activations = [...activations];
        dump(locale + '-observed.json', observed);
        if (result.incomplete.length || observed.apiCalls.length || observed.navigationCalls.length || observed.boundaryErrors.length || activations.length) throw new Error('Prerequisite: complete scoped axe result and zero effects');
        // FIRST product oracle. Other two toggles, input labels, back navigation, reveal behavior, focus and real AT are not certified.
        expect(result.violations).toEqual([]);
    } catch (error) {
        observed.error = String((error as Error).stack || error);
        if (!fs.existsSync(path.join(OUT!, locale + '-observed.json'))) dump(locale + '-observed.json', observed);
        throw error;
    } finally {
        if (root) await act(async () => root.unmount()); if (container) container.remove();
        for (const type of ['click', 'input', 'change', 'submit']) dom.window.document.removeEventListener(type, recordActivation, true);
        dump(locale + '-cleanup.json', { ownContainerRemoved: !container?.isConnected, remainingOwnedContainers: dom.window.document.querySelectorAll('[data-case-owned]').length, apiCalls: apiCalls.slice(startApi), navigationCalls: navigationCalls.slice(startNavigation), boundaryErrors: boundaryErrors.slice(startBoundary), activations, timerInventoryMeasured: false });
    }
}, 15000);
