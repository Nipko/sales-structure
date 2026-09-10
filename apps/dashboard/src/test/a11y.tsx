import * as fs from "fs";
import * as path from "path";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import axe, { type Result } from "axe-core";

/**
 * Renders a component and asks axe what a screen reader would be handed.
 *
 * What this proves and what it does not, because an accessibility test that
 * overclaims is worse than none:
 *
 * - It catches the machine-checkable half — a control with no accessible name,
 *   an `aria-*` attribute a role does not support, a label pointing at nothing,
 *   a `role` missing its required properties, nesting that breaks the
 *   accessibility tree. That is roughly a third of WCAG, and it is exactly the
 *   third that regresses silently during a refactor.
 * - It does NOT prove the screen is usable. Colour contrast needs real computed
 *   styles and jsdom has no layout, so those checks are disabled rather than
 *   left to pass vacuously. Focus order, keyboard traps, whether the reading
 *   order matches the visual one, and whether the copy makes sense out loud all
 *   need a real browser and a person.
 *
 * The provider tree is deliberately thin and real: the actual `messages/es.json`,
 * so a missing key shows up as the key path in an accessible name rather than
 * as a mock that always says "ok". Only `@/lib/api` and `next/link` are faked —
 * the first because a test must not do network, the second because `<Link>`
 * requires the App Router context and renders an `<a href>` anyway, which is
 * the only thing axe looks at.
 */

const MESSAGES = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "messages", "es.json"), "utf8"),
);

/**
 * Checks jsdom cannot answer honestly.
 *
 * `color-contrast` needs painted pixels; in jsdom it either skips or reports
 * against a blank canvas. Letting it run would produce a green result that
 * means nothing — the failure mode this whole file exists to avoid.
 */
const NOT_MEANINGFUL_WITHOUT_A_BROWSER = ["color-contrast"];

export interface RenderedScreen {
    container: HTMLElement;
    unmount: () => void;
}

/** Mounts into a real detached DOM, flushing effects so loaded state is what axe sees. */
export async function renderScreen(element: ReactElement): Promise<RenderedScreen> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    await act(async () => {
        root = createRoot(container);
        root.render(
            <NextIntlClientProvider locale="es" messages={MESSAGES} timeZone="America/Bogota">
                {element}
            </NextIntlClientProvider>,
        );
    });
    // A second flush: these screens load in an effect, so the first paint is the
    // spinner. Scanning that would test the skeleton and call it a screen.
    await act(async () => { await Promise.resolve(); });
    return {
        container,
        unmount: () => {
            act(() => { root.unmount(); });
            container.remove();
        },
    };
}

/**
 * Runs an interaction and lets everything it started settle.
 *
 * Some of what a screen shows only exists after somebody drives it — a queue
 * table that appears once a tenant is picked, a confirm step that appears once
 * a destructive button is pressed. Scanning only the first paint would grade
 * these screens on their emptiest state.
 */
export async function interact(action: () => void): Promise<void> {
    await act(async () => { action(); });
    await act(async () => { await Promise.resolve(); });
}

/** Sets a form control the way a person would, so React sees the change. */
export function setValue(control: HTMLSelectElement | HTMLInputElement, value: string): void {
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
}

export interface AxeFinding {
    id: string;
    impact: string;
    help: string;
    nodes: string[];
}

/** axe violations, flattened into something a failure message can print. */
export async function findAccessibilityViolations(container: HTMLElement): Promise<AxeFinding[]> {
    const results = await axe.run(container, {
        rules: Object.fromEntries(
            NOT_MEANINGFUL_WITHOUT_A_BROWSER.map((id) => [id, { enabled: false }]),
        ),
        resultTypes: ["violations"],
    });
    return results.violations.map((violation: Result) => ({
        id: violation.id,
        impact: violation.impact ?? "unknown",
        help: violation.help,
        // The selector is what makes the failure actionable; the HTML is noise.
        nodes: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
    }));
}

/** Renders, scans, unmounts. Returns findings so the caller writes the assertion. */
export async function scanScreen(element: ReactElement): Promise<AxeFinding[]> {
    const screen = await renderScreen(element);
    try {
        return await findAccessibilityViolations(screen.container);
    } finally {
        screen.unmount();
    }
}
