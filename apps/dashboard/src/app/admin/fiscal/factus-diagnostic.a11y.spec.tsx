import { interact, renderScreen } from "@/test/a11y";
import { api } from "@/lib/api";
import FiscalAdminPage from "./page";

jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { role: "super_admin" } }) }));
jest.mock("@/lib/api", () => ({ api: {
    getFiscalConfig: jest.fn(), getFactusNumberingRanges: jest.fn(), getFactusHealth: jest.fn(),
    testFiscalInvoice: jest.fn(),
} }));

const config = {
    mode: "CO_LOCAL", coIvaTreatment: "excluido", fiscalGateEnabled: false,
    factusEnvironment: "sandbox", factusNumberingRangeId: "2241", factusCreditNumberingRangeId: null,
    defaultUnitMeasureId: "70", defaultStandardCodeId: "1", defaultProductTributeId: "1",
    defaultMunicipalityId: null, itemDescription: "Suscripción", itemCodeReference: "PLAN", coIssuer: {}, usIssuer: {},
};
const diagnostic = {
    ok: true, authenticated: true, message: "Conexión verificada.",
    apiEnvironment: "sandbox", configuredEnvironment: "sandbox", blockers: [],
    numberingRange: { configuredId: "2241", id: "2241", prefix: "AT", from: 1, to: 1000, current: 12,
        resolutionNumber: "187600000001", startDate: "2026-01-01", endDate: "2027-01-01", isActive: true },
    creditNumberingRange: null,
};

function button(container: HTMLElement, name: string): HTMLButtonElement {
    const result = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === name);
    if (!result) throw new Error(`Missing button: ${name}`);
    return result;
}

describe("Factus test issuance environment guard", () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (api.getFiscalConfig as jest.Mock).mockResolvedValue({ success: true, data: config });
        (api.getFactusNumberingRanges as jest.Mock).mockResolvedValue({ success: true, data: [] });
        (api.getFactusHealth as jest.Mock).mockResolvedValue({ success: true, data: diagnostic });
        (api.testFiscalInvoice as jest.Mock).mockResolvedValue({ success: true, data: { status: "pending" } });
    });

    it.each([
        ["production", "production"],
        ["sandbox", "production"],
        ["production", "sandbox"],
    ])("blocks issuance with saved %s and API %s even if an older diagnostic reports ok", async (configuredEnvironment, apiEnvironment) => {
        (api.getFiscalConfig as jest.Mock).mockResolvedValue({ success: true, data: { ...config, factusEnvironment: configuredEnvironment } });
        (api.getFactusHealth as jest.Mock).mockResolvedValue({ success: true, data: { ...diagnostic, configuredEnvironment, apiEnvironment } });
        const screen = await renderScreen(<FiscalAdminPage />);
        try {
            await interact(() => button(screen.container, "Factus").click());
            await interact(() => button(screen.container, "Probar conexión").click());
            const issue = button(screen.container, "Emitir factura de prueba");
            expect(issue.disabled).toBe(true);
            await interact(() => issue.click());
            expect(api.testFiscalInvoice).not.toHaveBeenCalled();
            expect(screen.container.textContent).toContain("Autenticación confirmada");
        } finally { screen.unmount(); }
    });

    it("requires a successful sandbox diagnostic before enabling a test and displays range evidence", async () => {
        const screen = await renderScreen(<FiscalAdminPage />);
        try {
            await interact(() => button(screen.container, "Factus").click());
            const issue = button(screen.container, "Emitir factura de prueba");
            expect(issue.disabled).toBe(true);
            await interact(() => issue.click());
            expect(api.testFiscalInvoice).not.toHaveBeenCalled();
            await interact(() => button(screen.container, "Probar conexión").click());
            expect(issue.disabled).toBe(false);
            expect(screen.container.textContent).toContain("187600000001");
            expect(screen.container.textContent).toContain("2027-01-01");
            expect(screen.container.textContent).toContain("Consecutivo informado por Factus");
            await interact(() => issue.click());
            expect(api.testFiscalInvoice).toHaveBeenCalledTimes(1);
        } finally { screen.unmount(); }
    });

    it("shows an authenticated connection separately from an invalid range and keeps tests disabled", async () => {
        (api.getFactusHealth as jest.Mock).mockResolvedValue({ success: true, data: {
            ...diagnostic, ok: false, blockers: ["credit_range_not_found"],
            creditNumberingRange: { configuredId: "100", id: null },
        } });
        const screen = await renderScreen(<FiscalAdminPage />);
        try {
            await interact(() => button(screen.container, "Factus").click());
            await interact(() => button(screen.container, "Probar conexión").click());
            expect(button(screen.container, "Emitir factura de prueba").disabled).toBe(true);
            expect(screen.container.textContent).toContain("Autenticación confirmada");
            expect(screen.container.textContent).toContain("Configuración por revisar");
            expect(screen.container.textContent).toContain("Rango de notas crédito: no aparece en la cuenta.");
            expect(screen.container.textContent).not.toContain("fiscalAdmin.");
            expect(api.testFiscalInvoice).not.toHaveBeenCalled();
        } finally { screen.unmount(); }
    });
});
