import { META_CONNECT_ERROR } from "@parallext/shared";
import { interact, renderScreen, scanScreen, findAccessibilityViolations } from "@/test/a11y";
import { ConnectTriage } from "./ConnectTriage";
import { ConnectFailureCard } from "./ConnectFailureCard";
import { connectFailureForCode } from "./connect-errors";

/**
 * The two things the recording says were missing.
 *
 * What the pure helpers cannot prove: that the question a person answers before
 * Meta's window NEVER takes the connect button away (it is rendered outside
 * this component, and nothing here reports an answer to anyone), that "no sé"
 * is answered with the same steps as "no" rather than with a shrug, and that a
 * failure arrives as a title, one action and at most one button — announced,
 * because on a phone it lands below the fold.
 */

describe("ConnectTriage", () => {
  it("asks one question with three answers and says nothing else until one is picked", async () => {
    const screen = await renderScreen(
      <ConnectTriage namespace="channels.instagram.triage" name="instagram-triage" />,
    );

    expect(screen.container.textContent).toContain("¿Tu cuenta de Instagram es profesional?");
    const radios = screen.container.querySelectorAll<HTMLInputElement>("input[type=radio]");
    expect(radios).toHaveLength(3);
    expect(Array.from(radios).some((radio) => radio.checked)).toBe(false);
    expect(screen.container.querySelector("ol")).toBeNull();
    screen.unmount();
  });

  it("answers 'no sé' with the same three steps as 'no', because the steps are how you find out", async () => {
    for (const answer of ["no", "unsure"]) {
      const screen = await renderScreen(
        <ConnectTriage namespace="channels.instagram.triage" name="instagram-triage" />,
      );
      const radio = screen.container.querySelector<HTMLInputElement>(`input[value=${answer}]`)!;
      await interact(() => radio.click());

      const steps = screen.container.querySelectorAll("ol li");
      expect(steps).toHaveLength(3);
      expect(screen.container.textContent).toContain("Cambiar a cuenta profesional");
      // The sentence that makes the hint a hint.
      expect(screen.container.textContent).toContain("el botón de conectar sigue disponible");
      screen.unmount();
    }
  });

  it("does not repeat the steps at somebody who already said yes", async () => {
    const screen = await renderScreen(
      <ConnectTriage namespace="channels.instagram.triage" name="instagram-triage" />,
    );
    await interact(() => screen.container.querySelector<HTMLInputElement>("input[value=yes]")!.click());

    expect(screen.container.querySelector("ol")).toBeNull();
    expect(screen.container.textContent).toContain("Sigue con el botón de abajo");
    screen.unmount();
  });

  it("asks Messenger its own question, about posting as the page", async () => {
    const screen = await renderScreen(
      <ConnectTriage namespace="channels.messenger.triage" name="messenger-triage" />,
    );
    expect(screen.container.textContent).toContain("¿Puedes publicar en la página de Facebook de tu negocio?");

    await interact(() => screen.container.querySelector<HTMLInputElement>("input[value=unsure]")!.click());
    expect(screen.container.textContent).toContain("rol de administrador");
    screen.unmount();
  });

  it("renders every radio with a name a screen reader can read", async () => {
    for (const namespace of ["channels.instagram.triage", "channels.messenger.triage"]) {
      const screen = await renderScreen(<ConnectTriage namespace={namespace} name="triage" />);
      // The control is visually a chip, so the accessible name comes from the
      // label wrapping it. An unlabelled radio is the exact regression a chip
      // built out of `sr-only` invites.
      for (const radio of Array.from(screen.container.querySelectorAll<HTMLInputElement>("input[type=radio]"))) {
        expect(radio.closest("label")?.textContent?.trim()).toBeTruthy();
      }
      expect(await findAccessibilityViolations(screen.container)).toEqual([]);
      screen.unmount();
    }
  });
});

describe("ConnectFailureCard", () => {
  it("says what happened, what to do, and offers the one action", async () => {
    const onRetry = jest.fn();
    const screen = await renderScreen(
      <ConnectFailureCard
        namespace="channels.instagram.errors"
        failure={connectFailureForCode("instagram", META_CONNECT_ERROR.WINDOW_CANCELLED)}
        onRetry={onRetry}
      />,
    );

    const alert = screen.container.querySelector("[role=alert]")!;
    expect(alert.textContent).toContain("La conexión quedó a medias");
    expect(alert.textContent).toContain("no cierres la ventana");
    // Nothing Meta wrote, and exactly one control.
    const buttons = alert.querySelectorAll("button, a");
    expect(buttons).toHaveLength(1);

    await interact(() => (buttons[0] as HTMLButtonElement).click());
    expect(onRetry).toHaveBeenCalledTimes(1);
    screen.unmount();
  });

  it("offers no retry in front of a wall a retry cannot move", async () => {
    // A personal account stays personal however many times Meta's window is
    // reopened. The fix is in the text; a retry button beside it is the loop the
    // recording captured. The connect button is still on the screen underneath
    // for whoever comes back after converting the account.
    const onRetry = jest.fn();
    const screen = await renderScreen(
      <ConnectFailureCard
        namespace="channels.instagram.errors"
        failure={connectFailureForCode("instagram", META_CONNECT_ERROR.ACCOUNT_NOT_PROFESSIONAL)}
        onRetry={onRetry}
      />,
    );

    expect(screen.container.textContent).toContain("Tu cuenta de Instagram todavía es personal");
    expect(screen.container.textContent).toContain("Cambiar a cuenta profesional");
    expect(screen.container.querySelectorAll("button, a")).toHaveLength(0);
    expect(onRetry).not.toHaveBeenCalled();
    screen.unmount();
  });

  it("sends a plan limit to billing instead of back into Meta's window", async () => {
    const onRetry = jest.fn();
    const screen = await renderScreen(
      <ConnectFailureCard
        namespace="channels.messenger.errors"
        failure={connectFailureForCode("messenger", META_CONNECT_ERROR.PLAN_LIMIT)}
        onRetry={onRetry}
      />,
    );

    expect(screen.container.querySelector("button")).toBeNull();
    expect(screen.container.querySelector("a")!.getAttribute("href")).toBe("/admin/settings/billing");
    expect(onRetry).not.toHaveBeenCalled();
    screen.unmount();
  });

  it("renders no control at all in a window that cannot retry", async () => {
    // The OAuth pop-up shows the same card without `onRetry`: it cannot reopen
    // Meta, and a dead button would be worse than none.
    const screen = await renderScreen(
      <ConnectFailureCard
        namespace="channels.instagram.errors"
        failure={connectFailureForCode("instagram", META_CONNECT_ERROR.WINDOW_CANCELLED)}
      />,
    );
    expect(screen.container.querySelectorAll("button, a")).toHaveLength(0);
    expect(screen.container.textContent).toContain("La conexión quedó a medias");
    screen.unmount();
  });

  it("has no machine-detectable accessibility violations in the cards both channels can show", async () => {
    const cases = [
      ["channels.instagram.errors", connectFailureForCode("instagram", "popup_blocked")],
      ["channels.instagram.errors", connectFailureForCode("instagram", META_CONNECT_ERROR.PLAN_LIMIT)],
      ["channels.messenger.errors", connectFailureForCode("messenger", META_CONNECT_ERROR.NOT_PAGE_ADMIN)],
      ["channels.messenger.errors", connectFailureForCode("messenger", "config_missing")],
    ] as const;
    for (const [namespace, failure] of cases) {
      expect(await scanScreen(
        <ConnectFailureCard namespace={namespace} failure={failure} onRetry={() => {}} />,
      )).toEqual([]);
    }
  });
});
