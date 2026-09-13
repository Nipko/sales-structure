import * as React from "react";
import { scanScreen } from "./a11y";

/**
 * The scanner, scanned.
 *
 * Every other spec in this project asserts that axe found nothing — which is
 * also what a broken harness returns. A silent failure (axe not running, the
 * container detached before the scan, effects never flushed so only a spinner
 * is examined) would turn the whole accessibility suite green and keep it
 * green. So this file feeds it markup that is definitely wrong and insists it
 * says so, by rule id.
 *
 * It also records, in executable form, what the scan does NOT cover: the last
 * case is a genuinely unusable control that axe passes, because "no violations"
 * means "no machine-detectable violations" and nothing more.
 */

const ruleIds = async (element: React.ReactElement): Promise<string[]> =>
    (await scanScreen(element)).map((finding) => finding.id).sort();

describe("the accessibility harness detects what it claims to detect", () => {
    it("finds a button with no accessible name", async () => {
        expect(await ruleIds(
            <button type="button"><span aria-hidden="true">×</span></button>,
        )).toContain("button-name");
    });

    it("finds an input with no label", async () => {
        expect(await ruleIds(<input type="text" />)).toContain("label");
    });

    it("finds an aria attribute a role does not support", async () => {
        expect(await ruleIds(
            // eslint-disable-next-line jsx-a11y/role-supports-aria-props -- deliberate: this is the defect under test
            <div role="heading" aria-level={2} aria-checked="true">Canales</div>,
        )).toContain("aria-allowed-attr");
    });

    it("finds a role missing its required children", async () => {
        expect(await ruleIds(<ul role="tablist"><li>Textos legales</li></ul>))
            .toContain("aria-required-children");
    });

    it("finds an image with no alternative text", async () => {
        // eslint-disable-next-line jsx-a11y/alt-text, @next/next/no-img-element -- deliberate: this is the defect under test
        expect(await ruleIds(<img src="/logo.png" />)).toContain("image-alt");
    });

    it("reports a finding with the selector that produced it", async () => {
        const findings = await scanScreen(
            <button type="button" id="nameless"><span aria-hidden="true">×</span></button>,
        );
        const violation = findings.find((finding) => finding.id === "button-name");
        expect(violation).toBeDefined();
        expect(violation!.nodes.join(" ")).toContain("#nameless");
        expect(violation!.impact).not.toBe("");
    });

    it("scans the state after effects, not the first paint", async () => {
        function LoadsThenBreaks() {
            const [loaded, setLoaded] = React.useState(false);
            React.useEffect(() => { setLoaded(true); }, []);
            // The violation only exists once loading finishes. If the harness
            // scanned the first render it would find nothing and pass.
            return loaded ? <input type="text" /> : <p>Cargando…</p>;
        }
        expect(await ruleIds(<LoadsThenBreaks />)).toContain("label");
    });

    it("passes markup that is correct", async () => {
        expect(await scanScreen(
            <div>
                <label htmlFor="phone">Teléfono</label>
                <input id="phone" type="tel" />
            </div>,
        )).toEqual([]);
    });

    it("does NOT catch a control that is unusable but well-formed", async () => {
        // Documented on purpose. This div has a name and a role, and axe is
        // satisfied — but it has no tabindex and no key handler, so it cannot be
        // reached or activated from a keyboard at all. Machine checks cover
        // roughly a third of WCAG; this is the other two thirds, and the reason
        // the eslint rules (`interactive-supports-focus`,
        // `click-events-have-key-events`) exist alongside these scans — both
        // flag the element below, which is why it needs a disable comment.
        expect(await scanScreen(
            // eslint-disable-next-line jsx-a11y/interactive-supports-focus, jsx-a11y/click-events-have-key-events -- deliberate: the eslint rules DO catch this, which is the point
            <div role="button" onClick={() => {}}>Desconectar</div>,
        )).toEqual([]);
    });
});
