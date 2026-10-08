import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import Lead360Page from "./page";

/**
 * "Ver cliente" opened from the inbox carries a CONTACT id; the CRM list carries a LEAD id.
 * Every write on this page is keyed on a lead id, so a note written with a contact id broke the
 * notes -> leads foreign key and a stage update touched no row - and a failed request left a blank page.
 */
const TENANT = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";

let urlId = CONTACT;
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() };

jest.mock("next/navigation", () => ({
    __esModule: true,
    useRouter: () => router,
    usePathname: () => "/admin/contacts",
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ leadId: urlId }),
}));

jest.mock("@/lib/api", () => ({ __esModule: true, api: { fetch: jest.fn() } }));
jest.mock("@/contexts/TenantContext", () => ({ __esModule: true, useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }) }));
jest.mock("@/contexts/AuthContext", () => ({ __esModule: true, useAuth: () => ({ user: { id: "u1", role: "tenant_admin" }, verticalConfig: null }) }));

const { api } = jest.requireMock("@/lib/api") as { api: { fetch: jest.Mock } };
const calls = () => api.fetch.mock.calls.map(([path, options]) => ({ path: String(path), options }));
const paths = () => calls().map(call => call.path);

const lead = { id: LEAD, contact_id: CONTACT, first_name: "Valentina", last_name: "Ríos", stage: "nuevo", score: 3, phone: "+573001112233" };
const contactOnly = { id: null, contact_id: CONTACT, first_name: "Valentina", last_name: "Ríos", stage: null, score: 0, phone: "+573001112233" };

/** A tiny API: what each endpoint answers, per scenario. */
function serve(profile: any, extra: Record<string, any> = {}) {
    api.fetch.mockImplementation(async (path: string) => {
        if (path in extra) { const value = extra[path]; if (value instanceof Error) throw value; return value; }
        if (path.startsWith(`/crm/leads/${TENANT}/`) && !path.endsWith("/score") && !path.endsWith("/insight")) {
            if (profile instanceof Error) throw profile;
            return { success: true, data: profile };
        }
        if (path.startsWith("/crm/timeline/")) return { success: true, data: [{ event_type: "message", description: "Hola", created_at: "2026-10-07T10:00:00Z", actor: "inbound" }] };
        if (path.startsWith("/crm/notes/") || path.startsWith("/crm/tasks/")) return { success: true, data: [] };
        if (path.includes("/score")) return { success: true, data: { factors: {} } };
        return { success: true, data: [] };
    });
}

beforeEach(() => {
    api.fetch.mockReset();
    for (const fn of Object.values(router)) fn.mockClear();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const buttonTitled = (container: HTMLElement, title: string) => container.querySelector(`button[title="${title}"]`);

describe("profile opened with a CONTACT id that has a lead", () => {
    it("continues on the lead's own URL and does not read or write anything with the contact id", async () => {
        urlId = CONTACT;
        serve({ lead, opportunities: [], tags: [], resolved: { kind: "contact_lead", leadId: LEAD, contactId: CONTACT } });
        const screen = await renderScreen(<Lead360Page />);

        expect(router.replace).toHaveBeenCalledWith(`/admin/contacts/${LEAD}`);
        // Only the profile itself was asked with the URL id; notes/tasks/score wait for the lead URL.
        expect(paths()).toEqual([`/crm/leads/${TENANT}/${CONTACT}`]);
        // The spinner stays up (no blank page, no half-profile) until the lead URL loads.
        expect(screen.container.textContent).toContain("Cargando perfil");
        screen.unmount();
    });
});

describe("profile opened with the LEAD id", () => {
    it("is editable and keys every call on the lead id", async () => {
        urlId = LEAD;
        serve({ lead, opportunities: [], tags: [], resolved: { kind: "lead", leadId: LEAD, contactId: CONTACT } });
        const screen = await renderScreen(<Lead360Page />);

        expect(router.replace).not.toHaveBeenCalled();
        expect(paths()).toEqual(expect.arrayContaining([
            `/crm/leads/${TENANT}/${LEAD}`, `/crm/timeline/${TENANT}/${LEAD}`, `/crm/notes/${TENANT}/${LEAD}`,
            `/crm/tasks/${TENANT}?leadId=${LEAD}`, `/crm/leads/${TENANT}/${LEAD}/score`,
        ]));
        expect(buttonTitled(screen.container, "Editar")).not.toBeNull();
        expect(buttonTitled(screen.container, "Archivar")).not.toBeNull();
        expect(screen.container.textContent).not.toContain("todavía no tiene un registro comercial");
        screen.unmount();
    });

    it("an older API without `resolved` still opens the lead", async () => {
        urlId = LEAD;
        serve({ lead, opportunities: [], tags: [] });
        const screen = await renderScreen(<Lead360Page />);

        expect(router.replace).not.toHaveBeenCalled();
        expect(screen.container.textContent).toContain("Valentina Ríos");
        expect(buttonTitled(screen.container, "Editar")).not.toBeNull();
        screen.unmount();
    });
});

describe("profile of a contact with no lead yet", () => {
    it("is read-only: explains why, hides every write action and never calls a lead-keyed endpoint", async () => {
        urlId = CONTACT;
        serve({ lead: contactOnly, opportunities: [], tags: [], resolved: { kind: "contact_only", leadId: null, contactId: CONTACT } });
        const screen = await renderScreen(<Lead360Page />);

        expect(router.replace).not.toHaveBeenCalled();
        expect(screen.container.textContent).toContain("Valentina Ríos");
        const notice = screen.container.querySelector('[role="status"]');
        expect(notice?.textContent).toContain("todavía no tiene un registro comercial");

        expect(buttonTitled(screen.container, "Editar")).toBeNull();
        expect(buttonTitled(screen.container, "Archivar")).toBeNull();
        expect(screen.container.textContent).not.toContain("AI Insights");

        // The timeline is the contact's own; everything lead-keyed is skipped.
        const asked = paths();
        expect(asked).toContain(`/crm/timeline/${TENANT}/${CONTACT}`);
        expect(asked.some(path => path.startsWith("/crm/notes/") || path.startsWith("/crm/tasks/") || path.includes("/score")
            || path.includes("/custom-attribute"))).toBe(false);

        // No composer in the notes / tasks tabs.
        for (const tab of ["Notas", "Tareas"]) {
            const button = Array.from(screen.container.querySelectorAll("button")).find(b => (b.textContent ?? "").includes(tab));
            expect(button).toBeDefined();
            await interact(() => button!.click());
            expect(screen.container.querySelector("textarea")).toBeNull();
            expect(screen.container.querySelector('input[type="datetime-local"]')).toBeNull();
        }
        expect(calls().filter(call => call.options?.method && call.options.method !== "GET")).toEqual([]);

        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });
});

describe("a profile that cannot be opened is never a blank page", () => {
    it("shows an alert with a way out when the request fails, and retry asks again", async () => {
        urlId = LEAD;
        serve(new Error("HTTP error! status: 500"));
        const screen = await renderScreen(<Lead360Page />);

        const alert = screen.container.querySelector('[role="alert"]');
        expect(alert?.textContent).toContain("No pudimos abrir este cliente");
        expect(alert?.textContent).toContain("Reintentar");
        expect(alert?.textContent).toContain("Volver a clientes");

        const before = calls().length;
        const retry = Array.from(screen.container.querySelectorAll("button")).find(b => (b.textContent ?? "").includes("Reintentar"));
        await interact(() => retry!.click());
        expect(calls().length).toBeGreaterThan(before);

        const back = Array.from(screen.container.querySelectorAll("button")).find(b => (b.textContent ?? "").includes("Volver a clientes"));
        await interact(() => back!.click());
        expect(router.push).toHaveBeenCalledWith("/admin/contacts");

        expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        screen.unmount();
    });

    it("an answer without a lead is also an error, not an empty screen", async () => {
        urlId = LEAD;
        serve({ opportunities: [], tags: [] });
        const screen = await renderScreen(<Lead360Page />);
        expect(screen.container.querySelector('[role="alert"]')?.textContent).toContain("No pudimos abrir este cliente");
        screen.unmount();
    });

    it("opens the profile when only the timeline fails, and says so", async () => {
        urlId = LEAD;
        serve({ lead, opportunities: [], tags: [], resolved: { kind: "lead", leadId: LEAD, contactId: CONTACT } },
            { [`/crm/timeline/${TENANT}/${LEAD}`]: new Error("HTTP error! status: 500") });
        const screen = await renderScreen(<Lead360Page />);
        expect(screen.container.textContent).toContain("Valentina Ríos");
        expect(screen.container.textContent).toContain("Algunos datos de la ficha no se pudieron cargar");
        expect(screen.container.querySelector('[role="alert"]')).toBeNull();
        screen.unmount();
    });
});
