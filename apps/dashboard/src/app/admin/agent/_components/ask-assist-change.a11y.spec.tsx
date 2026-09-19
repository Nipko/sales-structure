import * as fs from "fs";
import * as path from "path";
import { useState } from "react";
import { findAccessibilityViolations, interact, renderScreen } from "@/test/a11y";
import { QUALITY_ASSIST_EVENT, parseQualityAssistantDetail } from "@/lib/quality-assistant-contract";
import { ASK_ASSIST_CHANGE_MAX, AskAssistChange } from "./AskAssistChange";

/**
 * "Dime qué cambiar" — the editor's way to ask for a change in words.
 *
 * The only Assist entry in the editor lived in the assessment panel, which the
 * default mode hides, so an owner who could not find the field behind "that
 * greeting is too long" had nowhere to say it. This field opens Assist on this
 * agent and sends her words as her message, through the same event the quality
 * surfaces use — so Assist gets the agent target and can prepare a proposal.
 */

const ES = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "..", "messages", "es.json"), "utf8"));
const AGENT = "22222222-2222-4222-8222-222222222222";

function type(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The editor around the field: unsaved until its Save is pressed. */
function EditorSaving() {
    const [unsaved, setUnsaved] = useState(true);
    return (
        <>
            <button type="button" data-save onClick={() => setUnsaved(false)}>Guardar</button>
            <AskAssistChange agentId={AGENT} unsavedChanges={unsaved} />
        </>
    );
}

describe("Dime qué cambiar", () => {
    let received: unknown[] = [];
    const listen = (event: Event) => { received.push((event as CustomEvent).detail); };
    beforeEach(() => { received = []; window.addEventListener(QUALITY_ASSIST_EVENT, listen); });
    afterEach(() => window.removeEventListener(QUALITY_ASSIST_EVENT, listen));

    it("opens Assist on this agent and sends the owner's words, and nothing else", async () => {
        const screen = await renderScreen(<AskAssistChange agentId={AGENT} agentName="Valentina" />);
        try {
            const form = screen.container.querySelector("form[data-ask-assist-change]") as HTMLFormElement;
            const input = form.querySelector("input") as HTMLInputElement;
            const button = form.querySelector("button") as HTMLButtonElement;
            // Labelled by its own visible words, and described by what happens next.
            expect(form.querySelector(`label[for="${input.id}"]`)?.textContent).toContain(ES.agent.askAssist.label);
            expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent)
                .toBe(ES.agent.askAssist.hint);
            expect(button.textContent).toBe(ES.agent.askAssist.submit);

            await interact(() => type(input, "  que salude más corto  "));
            await interact(() => button.click());

            expect(received).toHaveLength(1);
            // The event is the one Assist already listens to, and it parses —
            // with `send`, so her words go out without a second Enter in the chat.
            expect(parseQualityAssistantDetail(received[0])).toStrictEqual({
                agentId: AGENT, agentName: "Valentina", prompt: "que salude más corto", send: true,
                signalId: undefined, code: undefined, severity: undefined, href: undefined,
            });
            // Sent, so the field is ready for the next one.
            expect(input.value).toBe("");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("does not open Assist for an empty request", async () => {
        const screen = await renderScreen(<AskAssistChange agentId={AGENT} />);
        try {
            const input = screen.container.querySelector("input") as HTMLInputElement;
            const button = screen.container.querySelector("button") as HTMLButtonElement;
            expect(button.disabled).toBe(true);
            await interact(() => type(input, "   "));
            expect(button.disabled).toBe(true);
            await interact(() => (screen.container.querySelector("form") as HTMLFormElement).requestSubmit());
            expect(received).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("does not send while the editor has unsaved changes, and says to save them first", async () => {
        // Sending then made Assist change the stored agent under her edits: the
        // editor could only offer "Descartar lo que escribiste y recargar".
        const screen = await renderScreen(<AskAssistChange agentId={AGENT} agentName="Valentina" unsavedChanges />);
        try {
            const form = screen.container.querySelector("form[data-ask-assist-change]") as HTMLFormElement;
            const input = form.querySelector("input") as HTMLInputElement;
            const button = form.querySelector("button") as HTMLButtonElement;
            // She can still write what she wants; only sending waits.
            await interact(() => type(input, "que salude más corto"));
            expect(input.disabled).toBe(false);
            expect(button.disabled).toBe(true);
            // The reason is on screen, in plain words, and tied to both controls.
            const reason = document.getElementById(button.getAttribute("aria-describedby")!);
            expect(reason?.textContent).toBe(ES.agent.askAssist.saveFirst);
            expect(input.getAttribute("aria-describedby")).toBe(button.getAttribute("aria-describedby"));
            expect(form.textContent).not.toContain(ES.agent.askAssist.hint);
            // Enter (or anything that submits the form) does not go around it.
            await interact(() => form.requestSubmit());
            expect(received).toEqual([]);
            expect(input.value).toBe("que salude más corto");
            expect(await findAccessibilityViolations(screen.container)).toEqual([]);
        } finally {
            screen.unmount();
        }
    });

    it("sends once the changes are saved, with what she had written", async () => {
        const screen = await renderScreen(<EditorSaving />);
        try {
            const form = screen.container.querySelector("form[data-ask-assist-change]") as HTMLFormElement;
            await interact(() => type(form.querySelector("input") as HTMLInputElement, "que ofrezca agendar"));
            await interact(() => (screen.container.querySelector("[data-save]") as HTMLButtonElement).click());
            const button = form.querySelector("button") as HTMLButtonElement;
            expect(button.disabled).toBe(false);
            expect(document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent ?? "")
                .not.toBe(ES.agent.askAssist.saveFirst);
            await interact(() => button.click());
            expect(received).toHaveLength(1);
            expect(parseQualityAssistantDetail(received[0])?.prompt).toBe("que ofrezca agendar");
        } finally {
            screen.unmount();
        }
    });

    it("stays one quiet line: no heading, no alert, no second guide", async () => {
        const screen = await renderScreen(<AskAssistChange agentId={AGENT} />);
        try {
            expect(screen.container.querySelectorAll("h1, h2, h3, h4, [role='alert'], [role='status'], [role='dialog']")).toHaveLength(0);
            expect((screen.container.querySelector("input") as HTMLInputElement).maxLength).toBe(ASK_ASSIST_CHANGE_MAX);
        } finally {
            screen.unmount();
        }
    });
});
