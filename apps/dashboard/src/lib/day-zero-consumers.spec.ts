import * as fs from "fs";
import * as path from "path";

/**
 * Every screen that stays quiet during day 0 asks with the activation facts.
 *
 * `isOnboardingBeforeLive(stage)` alone counts `completed` as live, and the
 * wizard's last button writes `completed`: called that way, a surface came
 * back the moment the owner pressed "Ir al panel", before her agent had
 * answered anybody. The shared contract only ends day 0 on the first real
 * reply when it is handed `{ firstReplyAt, createdAt }`, so a call without
 * them is the old bug, whatever the surface.
 *
 * Source text, not rendering: the point is that NO call site anywhere in the
 * panel regresses, including one added next month.
 */

const SRC = path.join(__dirname, "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === "test") continue;
            sourceFiles(full, out);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

/** The argument text of every `isOnboardingBeforeLive(...)` call in a file. */
function callArguments(source: string): string[] {
    const calls: string[] = [];
    const marker = "isOnboardingBeforeLive(";
    let from = source.indexOf(marker);
    while (from !== -1) {
        let depth = 1;
        let i = from + marker.length;
        for (; i < source.length && depth > 0; i++) {
            if (source[i] === "(") depth++;
            else if (source[i] === ")") depth--;
        }
        calls.push(source.slice(from + marker.length, i - 1));
        from = source.indexOf(marker, i);
    }
    return calls;
}

const callSites = sourceFiles(SRC).flatMap((file) => {
    const source = fs.readFileSync(file, "utf8");
    // Imports mention the name without calling it.
    return callArguments(source).map((args) => ({ file: path.relative(SRC, file).replace(/\\/g, "/"), args }));
});

describe("day-0 gates in the panel", () => {
    it("finds the four surfaces that stay quiet during day 0", () => {
        // Guards the guard: a path typo would make the next assertion vacuous.
        const files = new Set(callSites.map((site) => site.file));
        expect([...files].sort()).toEqual(expect.arrayContaining([
            "components/HelpAssistant.tsx",
            "components/TrialCountdownBanner.tsx",
            "components/pwa/InstallPrompt.tsx",
            "components/quality/QualityAttentionBanner.tsx",
        ]));
    });

    it("hands the first reply and the creation date to every call", () => {
        const stageOnly = callSites
            .filter(({ args }) => !/firstReplyAt\s*:/.test(args) || !/createdAt\s*:\s*[^,}]*tenantCreatedAt/.test(args))
            .map(({ file, args }) => `${file}: isOnboardingBeforeLive(${args.replace(/\s+/g, " ").trim()})`);
        expect(stageOnly).toEqual([]);
    });
});
