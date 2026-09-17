import { act } from "react";
import { interact, renderScreen, scanScreen, setValue, findAccessibilityViolations } from "@/test/a11y";
import WhatsAppBillingTimeZone from "./WhatsAppBillingTimeZone";
import type { BillingZoneState } from "./billing-time-zone";

const mockSetZone = jest.fn();
jest.mock("@/lib/api", () => ({
  api: { setWhatsappBillingTimeZone: (...args: unknown[]) => mockSetZone(...args) },
}));

/**
 * The card that unblocks a number's replies.
 *
 * What the pure helpers cannot prove on their own: that the suggestion only
 * PRESELECTS (rendering sends nothing), that the request leaves only when
 * somebody presses the button naming the zone, and that a person who may not
 * do it is told who can instead of being handed a form that refuses.
 */

const missing: BillingZoneState = {
  kind: "missing",
  suggestion: "America/Bogota",
  suggestionSource: "common",
  conflictingZones: [],
};

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("WhatsAppBillingTimeZone", () => {
  beforeEach(() => mockSetZone.mockReset());

  it("warns, preselects the suggestion, and sends nothing until the zone is confirmed", async () => {
    mockSetZone.mockResolvedValue({
      success: true,
      data: { phoneNumberId: "111", timeZone: "America/Bogota", alsoApplied: ["222"] },
    });
    const onSaved = jest.fn();
    const screen = await renderScreen(
      <WhatsAppBillingTimeZone phoneNumberId="111" numberLabel="+57 300 000 0001" state={missing}
        access="form" onSaved={onSaved} onRetry={() => {}} />,
    );

    expect(screen.container.textContent).toContain(
      "Tu agente no puede enviar mensajes por este número hasta que confirmes la zona horaria de facturación de WhatsApp");
    expect(screen.container.textContent).toContain("WhatsApp Manager");
    const select = screen.container.querySelector("select")!;
    expect(select.value).toBe("America/Bogota");
    expect(mockSetZone).not.toHaveBeenCalled();

    const button = screen.container.querySelector<HTMLButtonElement>("button[type=submit]")!;
    expect(button.textContent).toBe("Confirmar America/Bogota");
    await interact(() => button.click());
    await settle();

    expect(mockSetZone).toHaveBeenCalledTimes(1);
    expect(mockSetZone).toHaveBeenCalledWith("111", "America/Bogota");
    expect(onSaved).toHaveBeenCalledWith({ phoneNumberId: "111", timeZone: "America/Bogota", alsoApplied: ["222"] });
    screen.unmount();
  });

  it("sends the zone the person picked instead of the suggestion", async () => {
    mockSetZone.mockResolvedValue({ success: true, data: { timeZone: "America/Lima", alsoApplied: [] } });
    const screen = await renderScreen(
      <WhatsAppBillingTimeZone phoneNumberId="111" numberLabel="+57 300 000 0001" state={missing}
        access="form" onSaved={() => {}} onRetry={() => {}} />,
    );
    await interact(() => setValue(screen.container.querySelector("select")!, "America/Lima"));
    await interact(() => screen.container.querySelector<HTMLButtonElement>("button[type=submit]")!.click());
    await settle();

    expect(mockSetZone).toHaveBeenCalledWith("111", "America/Lima");
    screen.unmount();
  });

  it("offers no preselection when two numbers of the account disagree", async () => {
    const screen = await renderScreen(
      <WhatsAppBillingTimeZone phoneNumberId="111" numberLabel="+57 300 000 0001"
        state={{ kind: "missing", suggestion: null, suggestionSource: null, conflictingZones: ["America/Bogota", "America/Lima"] }}
        access="form" onSaved={() => {}} onRetry={() => {}} />,
    );
    // jsdom reports the first option as the value of a listbox with nothing
    // selected (a browser reports ""), so what is asserted is what the form
    // would send: nothing, until somebody chooses.
    const button = screen.container.querySelector<HTMLButtonElement>("button[type=submit]")!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe("Elige una zona horaria para confirmar");
    expect(screen.container.textContent).toContain("tienen zonas horarias distintas (America/Bogota, America/Lima)");
    await interact(() => button.click());
    expect(mockSetZone).not.toHaveBeenCalled();
    screen.unmount();
  });

  it("says who can do it when the save is refused for an unverified email, and does not report success", async () => {
    mockSetZone.mockResolvedValue({ success: false, httpStatus: 403, errorCode: "email_not_verified" });
    const onSaved = jest.fn();
    const screen = await renderScreen(
      <WhatsAppBillingTimeZone phoneNumberId="111" numberLabel="+57 300 000 0001" state={missing}
        access="form" onSaved={onSaved} onRetry={() => {}} />,
    );
    await interact(() => screen.container.querySelector<HTMLButtonElement>("button[type=submit]")!.click());
    await settle();

    const alert = screen.container.querySelector("[role=alert]")!;
    expect(alert.textContent).toContain("verifica tu correo");
    expect(alert.querySelector("a")!.getAttribute("href")).toBe("/verify-email");
    expect(onSaved).not.toHaveBeenCalled();
    screen.unmount();
  });

  it("gives a non-admin the warning and sends them to an administrator, with no form", async () => {
    const screen = await renderScreen(
      <WhatsAppBillingTimeZone phoneNumberId="111" numberLabel="+57 300 000 0001" state={missing}
        access="ask_admin" onSaved={() => {}} onRetry={() => {}} />,
    );
    expect(screen.container.textContent).toContain("pide a un administrador");
    expect(screen.container.querySelector("form")).toBeNull();
    screen.unmount();
  });

  it("does not show the warning for a set zone or a reading that failed", async () => {
    const set = await renderScreen(
      <WhatsAppBillingTimeZone phoneNumberId="111" numberLabel="+57 300 000 0001"
        state={{ kind: "set", zone: "America/Bogota", conflictingZones: [] }}
        access="form" onSaved={() => {}} onRetry={() => {}} />,
    );
    expect(set.container.textContent).toContain("Zona horaria de facturación: America/Bogota");
    expect(set.container.querySelector("form")).toBeNull();
    set.unmount();

    const unknown = await renderScreen(
      <WhatsAppBillingTimeZone phoneNumberId="111" numberLabel="+57 300 000 0001" state={{ kind: "unknown" }}
        access="form" onSaved={() => {}} onRetry={() => {}} />,
    );
    expect(unknown.container.textContent).toContain("No pudimos comprobar");
    expect(unknown.container.textContent).not.toContain("Tu agente no puede enviar");
    unknown.unmount();
  });

  it("never sends the preselected zone when Enter is pressed in the search box", async () => {
    // A browser submits a form when Enter is pressed in a text field of a form
    // with an enabled submit button, and the button IS enabled: the suggestion
    // is preselected. jsdom does not do implicit submission, so what is pinned
    // is that the key never reaches the browser's default action.
    const screen = await renderScreen(
      <WhatsAppBillingTimeZone phoneNumberId="111" numberLabel="+57 300 000 0001" state={missing}
        access="form" onSaved={() => {}} onRetry={() => {}} />,
    );
    const search = screen.container.querySelector<HTMLInputElement>("input[type=search]")!;
    await interact(() => setValue(search, "mexico"));
    let notPrevented = true;
    await interact(() => {
      notPrevented = search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await settle();

    expect(notPrevented).toBe(false);
    expect(mockSetZone).not.toHaveBeenCalled();
    screen.unmount();
  });

  it("lets an administrator change a zone that is already set, still only on explicit confirmation", async () => {
    mockSetZone.mockResolvedValue({ success: true, data: { timeZone: "America/Santiago", alsoApplied: [] } });
    const onSaved = jest.fn();
    const screen = await renderScreen(
      <WhatsAppBillingTimeZone phoneNumberId="111" numberLabel="+57 300 000 0001"
        state={{ kind: "set", zone: "America/Bogota", conflictingZones: [] }}
        access="form" onSaved={onSaved} onRetry={() => {}} />,
    );
    const change = Array.from(screen.container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Cambiar zona horaria");
    expect(change).toBeDefined();
    await interact(() => change!.click());

    const select = screen.container.querySelector("select")!;
    expect(select.value).toBe("America/Bogota");
    expect(mockSetZone).not.toHaveBeenCalled();
    await interact(() => setValue(select, "America/Santiago"));
    await interact(() => screen.container.querySelector<HTMLButtonElement>("button[type=submit]")!.click());
    await settle();

    expect(mockSetZone).toHaveBeenCalledWith("111", "America/Santiago");
    expect(onSaved).toHaveBeenCalledWith({ phoneNumberId: "111", timeZone: "America/Santiago", alsoApplied: [] });
    screen.unmount();
  });

  it("offers no change action to someone who may not set the zone", async () => {
    const screen = await renderScreen(
      <WhatsAppBillingTimeZone phoneNumberId="111" numberLabel="+57 300 000 0001"
        state={{ kind: "set", zone: "America/Bogota", conflictingZones: [] }}
        access="ask_admin" onSaved={() => {}} onRetry={() => {}} />,
    );
    expect(screen.container.querySelector("button")).toBeNull();
    screen.unmount();
  });

  it("has no machine-detectable accessibility violations in its states", async () => {
    for (const access of ["form", "ask_admin", "verify_email"] as const) {
      expect(await scanScreen(
        <WhatsAppBillingTimeZone phoneNumberId="111" numberLabel="+57 300 000 0001" state={missing}
          access={access} onSaved={() => {}} onRetry={() => {}} />,
      )).toEqual([]);
    }
    const conflict = await renderScreen(
      <WhatsAppBillingTimeZone phoneNumberId="111" numberLabel="+57 300 000 0001"
        state={{ kind: "set", zone: "America/Bogota", conflictingZones: ["America/Bogota", "America/Lima"] }}
        access="form" onSaved={() => {}} onRetry={() => {}} />,
    );
    await interact(() => conflict.container.querySelector<HTMLButtonElement>("button")!.click());
    expect(conflict.container.querySelector("form")).not.toBeNull();
    expect(await findAccessibilityViolations(conflict.container)).toEqual([]);
    conflict.unmount();
  });
});
