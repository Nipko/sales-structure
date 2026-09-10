import { renderScreen, scanScreen } from "@/test/a11y";
import { DataSourceBadge } from "./useApiData";

/**
 * The badge that says where the numbers came from.
 *
 * It used to be a boolean whose false branch read "DEMO", on nine screens, all
 * of them showing the tenant's own records — there is no demo data anywhere in
 * this dashboard. So the assertion under test is not "the badge renders": it is
 * that a failed or unfinished read never claims a provenance we do not have,
 * and that the three states are distinguishable by something other than colour.
 */

const textOf = async (state: "live" | "unverified" | "unavailable") => {
    const screen = await renderScreen(<DataSourceBadge state={state} />);
    const badge = screen.container.querySelector("span[aria-label]") as HTMLElement;
    const result = { label: badge.textContent ?? "", accessibleName: badge.getAttribute("aria-label") ?? "" };
    screen.unmount();
    return result;
};

describe("the data source badge never claims data is demo", () => {
    it("says nothing about demo data in any state", async () => {
        for (const state of ["live", "unverified", "unavailable"] as const) {
            const { label, accessibleName } = await textOf(state);
            expect(`${label} ${accessibleName}`.toLowerCase()).not.toContain("demo");
        }
    });

    it("distinguishes a failed read from an unfinished one", async () => {
        const unavailable = await textOf("unavailable");
        const unverified = await textOf("unverified");
        expect(unavailable.label).not.toEqual(unverified.label);
        expect(unavailable.accessibleName).not.toEqual(unverified.accessibleName);
    });

    it("does not present a failed read as live data", async () => {
        const unavailable = await textOf("unavailable");
        const live = await textOf("live");
        expect(unavailable.label).not.toEqual(live.label);
        expect(live.accessibleName).not.toEqual(unavailable.accessibleName);
    });

    it("carries its meaning in text, not only in the colour of a dot", async () => {
        for (const state of ["live", "unverified", "unavailable"] as const) {
            const { label, accessibleName } = await textOf(state);
            // The bullet is decorative; something readable has to survive it.
            expect(label.replace(/[●\s]/g, "").length).toBeGreaterThan(0);
            expect(accessibleName.length).toBeGreaterThan(label.length);
        }
    });

    it.each(["live", "unverified", "unavailable"] as const)(
        "has no machine-detectable accessibility violations (%s)",
        async (state) => {
            expect(await scanScreen(<DataSourceBadge state={state} />)).toEqual([]);
        },
    );
});
