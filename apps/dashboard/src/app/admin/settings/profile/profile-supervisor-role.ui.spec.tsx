/** @jest-environment node */
// PREPARED ONLY: context hydration and display of the existing tenant_supervisor role.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

const OUT = process.env.PROFILE_ROLE_EVIDENCE_DIR;
if (!OUT || !path.isAbsolute(OUT)) throw new Error('Exclusive evidence directory required');
const dump = (name: string, value: unknown) => fs.writeFileSync(path.join(OUT!, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const user = Object.freeze({ id: '11111111-1111-4111-8111-111111111111', role: 'tenant_supervisor', firstName: 'Synthetic', lastName: 'Supervisor', email: 'operator@example.invalid', phone: '+570000000000', jobTitle: 'Synthetic operator' });
const boundaryErrors: string[] = [], apiCalls: string[] = [];
function unexpected(message: string): never { boundaryErrors.push(message); throw new Error(message); }
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
    // Product graph loads only after owned DOM globals exist; no axe run in this criterion.
    ({ createRoot } = await import('react-dom/client'));
    ({ NextIntlClientProvider } = await import('next-intl'));
    const pageSpecifier = './' + 'page'; Page = (await import(pageSpecifier)).default;
});
afterAll(() => {
    dom?.window.close();
    for (const key of globalKeys) { const old = prior.get(key); if (old) Object.defineProperty(globalThis, key, old); else delete (globalThis as any)[key]; }
});

for (const locale of ['es', 'en', 'pt', 'fr']) it(locale + ' profile supervisor role uses existing translated label', async () => {
    const observed: any = { locale, source: 'real_ProfilePage_NextIntl_HelpPanel_synthetic_supervisor_context_only', apiCalls: [], inputs: null, firstVisibleLabel: null, roleDisplay: null, html: null, boundaryErrors: [], controlsPassedBeforeOracle: false, error: null };
    const startBoundary = boundaryErrors.length, startApi = apiCalls.length;
    let root: any, container: HTMLDivElement | undefined;
    const activations: string[] = [];
    const recordActivation = (event: Event) => activations.push(event.type);
    for (const type of ['click', 'input', 'change', 'submit']) dom.window.document.addEventListener(type, recordActivation, true);
    try {
        const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8'));
        container = dom.window.document.createElement('div'); container.dataset.caseOwned = locale; dom.window.document.body.appendChild(container); root = createRoot(container);
        await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages, timeZone: 'America/Bogota' }, createElement(Page))));
        const inputs = Array.from(container.querySelectorAll('input'));
        const firstLabel = container.querySelector('label');
        observed.inputs = inputs.map(input => ({ type: input.type, value: input.value, disabled: input.disabled, id: input.id, ariaLabel: input.getAttribute('aria-label'), ariaLabelledby: input.getAttribute('aria-labelledby'), html: input.outerHTML }));
        observed.firstVisibleLabel = firstLabel?.textContent?.trim();
        observed.apiCalls = apiCalls.slice(startApi); observed.boundaryErrors = boundaryErrors.slice(startBoundary);
        // Prerequisites, before the first product oracle: hydration, own first field, translated visible label, zero actions/requests.
        if (inputs.length !== 5 || JSON.stringify(inputs.map(input => input.type)) !== JSON.stringify(['text', 'text', 'email', 'tel', 'text'])) throw new Error('Prerequisite: five expected input types');
        if (JSON.stringify(inputs.map(input => input.value)) !== JSON.stringify([user.firstName, user.lastName, user.email, user.phone, user.jobTitle])) throw new Error('Prerequisite: synthetic context values hydrated');
        if (!inputs[2].disabled || inputs[0].disabled || observed.firstVisibleLabel !== messages.settings.profilePage.firstName) throw new Error('Prerequisite: email disabled and translated visible first-name label');
        if (!container.contains(inputs[0]) || container.querySelectorAll('img').length || observed.apiCalls.length || observed.boundaryErrors.length || activations.length) throw new Error('Prerequisite: own input, no image/request/boundary/action');
        const names = Array.from(container.querySelectorAll('p')).filter(node => node.textContent?.trim() === 'Synthetic Supervisor');
        if (names.length !== 1 || container.querySelector('h1')?.textContent?.trim() !== messages.settings.profilePage.title) throw new Error('Prerequisite: unique own full name and translated H1');
        const roleParagraph = names[0].nextElementSibling;
        if (!roleParagraph || roleParagraph.tagName !== 'P' || !container.contains(roleParagraph)) throw new Error('Prerequisite: own role paragraph identity');
        observed.controlsPassedBeforeOracle = true;
        observed.roleDisplay = { syntheticRole: user.role, fullName: names[0].textContent?.trim(), displayedRole: roleParagraph.textContent?.trim(), expectedRole: messages.roles.supervisor, ownRoleParagraph: roleParagraph.outerHTML, nameParagraph: names[0].outerHTML };
        observed.html = container.innerHTML; observed.apiCalls = apiCalls.slice(startApi); observed.boundaryErrors = boundaryErrors.slice(startBoundary); observed.activations = [...activations];
        dump(locale + '-observed.json', observed);
        if (observed.apiCalls.length || observed.boundaryErrors.length || activations.length) throw new Error('Prerequisite: zero effects before first role display oracle');
        // FIRST product oracle. This is presentation of a valid synthetic role, not authorization.
        expect(observed.roleDisplay.displayedRole).toEqual(messages.roles.supervisor);
    } catch (error) {
        observed.error = String((error as Error).stack || error);
        if (!fs.existsSync(path.join(OUT!, locale + '-observed.json'))) dump(locale + '-observed.json', observed);
        throw error;
    } finally {
        if (root) await act(async () => root.unmount()); if (container) container.remove();
        for (const type of ['click', 'input', 'change', 'submit']) dom.window.document.removeEventListener(type, recordActivation, true);
        dump(locale + '-cleanup.json', { ownContainerRemoved: !container?.isConnected, remainingOwnedContainers: dom.window.document.querySelectorAll('[data-case-owned]').length, apiCalls: apiCalls.slice(startApi), boundaryErrors: boundaryErrors.slice(startBoundary), activations, timerInventoryMeasured: false });
    }
}, 15000);
