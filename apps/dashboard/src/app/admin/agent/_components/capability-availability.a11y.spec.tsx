import { useState } from "react";
import { listVerticalCapabilityConfigurations, VERTICAL_TOOL_GROUPS } from "@parallext/shared";
import { interact, renderScreen } from "@/test/a11y";
import { CapabilitiesSection } from "./CapabilitiesSection";
import { defaultConfig, type PersonaConfig } from "../_types";
import { api } from "@/lib/api";

const context = { verticalConfig: null as any, isVerticalConfigLoading: false, planFeatures: { customerPayments: true } as Record<string, unknown> | null };
const tenantContext = { activeTenantId: "tenant" };
let freshPlan: Record<string, unknown> | null = { customerPayments: true };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => context }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => tenantContext }));
jest.mock("@/lib/api", () => ({ api: {
  getTenantPaymentsConfig: async () => ({ success: false }),
  getPlanFeatures: jest.fn(async () => ({ success: freshPlan !== null, data: freshPlan })),
} }));

const readiness = { loaded: true, services: 1, slots: 1 };
function Editor({ tools = {} }: { tools?: PersonaConfig["tools"] }) {
  // A stale agent-level industry must never override the tenant's subtype.
  const [config, setConfig] = useState<PersonaConfig>({ ...defaultConfig, industry: "inmobiliaria", tools });
  return <CapabilitiesSection config={config} onChange={updates => setConfig(previous => ({ ...previous, ...updates }))} apptReadiness={readiness} />;
}

describe("rendered tools match the business subtype", () => {
  let consoleErrors: jest.SpyInstance;
  beforeEach(() => {
    consoleErrors = jest.spyOn(console, "error");
    context.isVerticalConfigLoading = false;
    context.planFeatures = { customerPayments: true };
    freshPlan = { customerPayments: true };
    tenantContext.activeTenantId = "tenant";
    (api.getPlanFeatures as jest.Mock).mockReset().mockImplementation(async () => ({ success: freshPlan !== null, data: freshPlan }));
  });
  afterEach(() => {
    try { expect(consoleErrors).not.toHaveBeenCalled(); }
    finally { consoleErrors.mockRestore(); }
  });

  it.each(listVerticalCapabilityConfigurations().map(profile => [
    `${profile.industry}/${profile.subtype}`, profile,
  ] as const))("renders the selectable families for %s", async (_name, profile) => {
    context.verticalConfig = profile;
    const screen = await renderScreen(<Editor />);
    try {
      const rendered = Array.from(screen.container.querySelectorAll<HTMLButtonElement>("button[data-tool-family]"))
        .map(button => button.dataset.toolFamily!)
        .filter(family => (VERTICAL_TOOL_GROUPS as readonly string[]).includes(family));
      expect(rendered.sort()).toEqual([...profile.toolGroups].sort());
      for (const family of profile.toolGroups) {
        const button = screen.container.querySelector<HTMLButtonElement>(`button[data-tool-family="${family}"]`)!;
        expect(button.disabled).toBe(false);
        expect(button.getAttribute("aria-label")).toBeTruthy();
        await interact(() => button.click());
        expect(button.getAttribute("aria-checked")).toBe("true");
        await interact(() => button.click());
        expect(button.getAttribute("aria-checked")).toBe("false");
      }
    } finally { screen.unmount(); }
  });

  it("lets an owner remove a saved incompatible family but never re-enable it", async () => {
    context.verticalConfig = { industry: "turismo", subType: "hotel" };
    const screen = await renderScreen(<Editor tools={{ tours: { enabled: true }, appointments: { enabled: true, canBook: true, canCancel: true } }} />);
    try {
      expect(screen.container.textContent).toContain("no corresponde al tipo de negocio actual");
      expect(screen.container.querySelector('a[href="/admin/appointments"]')).toBeNull();
      for (const family of ["tours", "appointments"]) {
        const button = screen.container.querySelector<HTMLButtonElement>(`button[data-tool-family="${family}"]`)!;
        expect(button.disabled).toBe(false);
        await interact(() => button.click());
        expect(screen.container.querySelector(`button[data-tool-family="${family}"]`)).toBeNull();
      }
    } finally { screen.unmount(); }
  });

  it("shows the runtime defaults of omitted subpermissions", async () => {
    context.verticalConfig = { industry: "retail", subType: "hogar" };
    const screen = await renderScreen(<Editor tools={{
      appointments: { enabled: true } as NonNullable<PersonaConfig["tools"]>["appointments"],
      payments: { enabled: true },
    }} />);
    try {
      const inputFor = (title: string) => Array.from(screen.container.querySelectorAll("label"))
        .find(label => label.textContent?.startsWith(title))?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      expect(inputFor("Crear citas")?.checked).toBe(true);
      expect(inputFor("Cancelar citas")?.checked).toBe(true);
      expect(inputFor("Permitir crear enlaces de pago")?.checked).toBe(false);
    } finally { screen.unmount(); }
  });

  it.each([null, { customerPayments: false }])("blocks paid activation when the plan is %j and allows deactivation", async plan => {
    context.verticalConfig = { industry: "turismo", subType: "hotel" };
    context.planFeatures = plan;
    freshPlan = plan;
    const screen = await renderScreen(<Editor tools={{ payments: { enabled: true } }} />);
    try {
      const button = screen.container.querySelector<HTMLButtonElement>('button[data-tool-family="payments"]')!;
      expect(button.disabled).toBe(false);
      await interact(() => button.click());
      expect(button.getAttribute("aria-checked")).toBe("false");
      expect(button.disabled).toBe(true);
    } finally { screen.unmount(); }
  });

  it("shows and persists both ecommerce owner controls", async () => {
    context.verticalConfig = { industry: "retail", subType: "moda" };
    const screen = await renderScreen(<Editor tools={{ ecommerce: { enabled: true } }} />);
    try {
      const inputFor = (title: string) => Array.from(screen.container.querySelectorAll("label"))
        .find(label => label.textContent?.startsWith(title))?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const recommend = inputFor("Permitir recomendaciones")!;
      const discount = inputFor("Permitir descuentos")!;
      expect(recommend.checked).toBe(true);
      expect(discount.checked).toBe(false);
      await interact(() => recommend.click());
      await interact(() => discount.click());
      expect(recommend.checked).toBe(false);
      expect(discount.checked).toBe(true);
    } finally { screen.unmount(); }
  });

  it("loads a fresh plan on mount after an upgrade instead of trusting the session snapshot", async () => {
    context.verticalConfig = { industry: "turismo", subType: "hotel" };
    context.planFeatures = { customerPayments: false };
    freshPlan = { customerPayments: true };
    const screen = await renderScreen(<Editor />);
    try {
      expect(api.getPlanFeatures).toHaveBeenCalledWith("tenant");
      expect(screen.container.querySelector<HTMLButtonElement>('button[data-tool-family="payments"]')!.disabled).toBe(false);
    } finally { screen.unmount(); }
  });

  it("keeps a pending plan lookup unknown and ignores an old tenant response", async () => {
    context.verticalConfig = { industry: "turismo", subType: "hotel" };
    let resolveOld!: (value: any) => void;
    (api.getPlanFeatures as jest.Mock).mockImplementation((tenantId: string) => tenantId === "tenant"
      ? new Promise(resolve => { resolveOld = resolve; })
      : Promise.resolve({ success: true, data: { customerPayments: false } }));
    const screen = await renderScreen(<Editor />);
    try {
      const button = screen.container.querySelector<HTMLButtonElement>('button[data-tool-family="payments"]')!;
      expect(button.disabled).toBe(true);
      tenantContext.activeTenantId = "another-tenant";
      await interact(() => screen.container.querySelector<HTMLButtonElement>('button[data-tool-family="faqs"]')!.click());
      expect(api.getPlanFeatures).toHaveBeenCalledWith("another-tenant");
      await interact(() => resolveOld({ success: true, data: { customerPayments: true } }));
      expect(button.disabled).toBe(true);
    } finally { screen.unmount(); }
  });

  it("drops a granted plan immediately when the active tenant changes", async () => {
    context.verticalConfig = { industry: "turismo", subType: "hotel" };
    (api.getPlanFeatures as jest.Mock).mockImplementation((tenantId: string) => tenantId === "tenant"
      ? Promise.resolve({ success: true, data: { customerPayments: true } })
      : new Promise(() => {}));
    const screen = await renderScreen(<Editor />);
    try {
      const button = screen.container.querySelector<HTMLButtonElement>('button[data-tool-family="payments"]')!;
      expect(button.disabled).toBe(false);
      tenantContext.activeTenantId = "another-tenant";
      await interact(() => screen.container.querySelector<HTMLButtonElement>('button[data-tool-family="faqs"]')!.click());
      expect(button.disabled).toBe(true);
    } finally { screen.unmount(); }
  });
});
