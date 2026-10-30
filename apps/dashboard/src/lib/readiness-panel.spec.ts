import * as fs from "node:fs";
import * as path from "node:path";
import { evaluate } from "../../../../packages/business-spec/src/engine/evaluate";
import { fromLegacyRows, type LegacyTenantRows } from "../../../../packages/business-spec/src/legacy-status";
import { formRequirementIds, screenTargetsFor } from "../../../../packages/business-spec/src/forms/descriptor";
import { loadSpec } from "../../../../packages/business-spec/src/load";
import type { ReadinessResult } from "../../../../packages/business-spec/src/types";
import {
    buildReadinessPanel,
    gapAction,
    navigableTarget,
    panelFormHref,
    topBlockingGaps,
    type ReadinessCurrentResponse,
    type ReadinessResultView,
} from "./readiness-panel";

/**
 * El panel solo agrupa lo que decide el motor. Estas pruebas usan el resultado REAL del motor sobre las fotos
 * golden de los 7 tenants QA (packages/business-spec/test/fixtures/qa-tenants), sin copiar ninguna regla.
 */
const REPO = path.resolve(__dirname, "../../../..");
const FIXTURES = path.join(REPO, "packages/business-spec/test/fixtures/qa-tenants");
const APP = path.join(REPO, "apps/dashboard/src/app");
const NOW = new Date("2026-10-30T12:00:00.000Z");
const spec = loadSpec();

// Comprobación de tipos: el resultado del motor encaja en lo que lee el panel.
const asView = (r: ReadinessResult): ReadinessResultView => r;

const slugs = fs.readdirSync(FIXTURES).filter(f => f.endsWith(".snapshot.json")).map(f => f.replace(".snapshot.json", "")).sort();
const resultFor = (slug: string) => evaluate(spec, fromLegacyRows(JSON.parse(fs.readFileSync(path.join(FIXTURES, `${slug}.snapshot.json`), "utf8")) as LegacyTenantRows), NOW);
const responseFor = (result: ReadinessResult): ReadinessCurrentResponse => ({
    evaluationId: "e1", evaluatedAt: result.asOf, trigger: "refresh", cached: false, result: asView(result),
});
const owner = { role: "tenant_admin", impersonating: false };
/** Lo que agrega la API (ReadinessService.screenTargets): la pantalla de catálogo del primer objeto habilitado. */
const screenTargets = (result: ReadinessResult) => screenTargetsFor(spec, result.config.objects.map(o => o.object));
const supervisor = { role: "tenant_supervisor", impersonating: false };

/** ¿Hay una página de Next para esta ruta? (`/admin/x?tab=y` → `app/admin/x/page.tsx`). */
function pageExists(href: string): boolean {
    const route = href.split(/[?#]/)[0];
    return fs.existsSync(path.join(APP, ...route.split("/").filter(Boolean), "page.tsx"));
}

describe("panel de preparación: forma de los datos", () => {
    it.each(slugs)("%s: el veredicto del panel es el del motor (el mismo que imprime readiness:report)", slug => {
        const result = resultFor(slug);
        const panel = buildReadinessPanel(responseFor(result), owner);
        expect(panel.verdict).toBe(result.verdict);
        expect(panel.counts).toEqual(result.counts);
        // cada hueco que cuenta aparece una vez: en su grupo o plegado bajo su raíz
        const shown = [...panel.blocking, ...panel.necessary, ...panel.recommended];
        const folded = shown.flatMap(g => g.alsoFixes.map(f => f.id));
        for (const id of [...result.blockingGaps, ...result.necessaryGaps, ...result.recommendedGaps]) {
            expect(shown.some(g => g.id === id) || folded.includes(id)).toBe(true);
        }
        expect(new Set(shown.map(g => g.id)).size).toBe(shown.length);
    });

    it.each(slugs)("%s: ningún enlace del dueño lleva a un 404 ni a una pantalla sin permiso", slug => {
        const panel = buildReadinessPanel(responseFor(resultFor(slug)), owner);
        const actions = [...panel.blocking, ...panel.necessary, ...panel.recommended].map(g => g.action).concat(panel.quality.map(q => q.action));
        for (const action of actions) {
            expect(action.kind).not.toBe("ask_admin");
            if (action.kind === "link") expect({ href: action.href, page: pageExists(action.href) }).toEqual({ href: action.href, page: true });
        }
    });

    it("todas las pantallas de la especificación existen y el dueño las puede abrir", () => {
        const targets = [...new Set(Object.values(spec.requirements).map(r => r.uiTarget).filter((t): t is string => Boolean(t)))];
        expect(targets.length).toBeGreaterThan(10);
        for (const target of targets) {
            const action = gapAction(target, owner);
            expect({ target, kind: action.kind }).toEqual({ target, kind: "link" });
            if (action.kind === "link") expect({ target, page: pageExists(action.href) }).toEqual({ target, page: true });
        }
    });

    it("dental: muestra los bloqueantes del motor con su mensaje, y la tarjeta de Inicio toma los 3 primeros", () => {
        const result = resultFor("spark-qa-dental-03");
        expect(result.verdict).toBe("no_listo");
        const panel = buildReadinessPanel(responseFor(result), owner);
        expect(panel.blocking.length).toBeGreaterThan(0);
        for (const gap of panel.blocking) {
            expect(gap.level).toBe(result.requirements.find(r => r.id === gap.id)?.level);
            expect(gap.message.length).toBeGreaterThan(0);
        }
        const top = topBlockingGaps(responseFor(result), owner);
        expect(top.map(g => g.id)).toEqual(panel.blocking.slice(0, 3).map(g => g.id));
    });

    it("un supervisor no recibe enlaces a pantallas que solo abre el administrador", () => {
        expect(gapAction("/admin/settings/business-info", supervisor)).toEqual({ kind: "ask_admin", href: "/admin/settings/business-info" });
        expect(gapAction("/admin/menu", supervisor)).toEqual({ kind: "link", href: "/admin/menu" });
        expect(gapAction("/admin/settings/business-info", owner)).toEqual({ kind: "link", href: "/admin/settings/business-info" });
        expect(gapAction(null, owner)).toEqual({ kind: "none" });
    });

    it("una ruta con segmento dinámico enlaza al listado donde se elige el ítem", () => {
        expect(navigableTarget("/admin/listings/[listingId]")).toBe("/admin/listings");
        expect(navigableTarget("/admin/appointments?tab=services")).toBe("/admin/appointments?tab=services");
        expect(gapAction("/admin/properties/[propertyId]", owner)).toEqual({ kind: "link", href: "/admin/properties" });
    });

    it.each(slugs)("%s (R3): cada bloqueante se arregla desde el panel: cajón o pantalla, nunca «próximamente»", slug => {
        const result = resultFor(slug);
        const response = { ...responseFor(result), formRequirementIds: formRequirementIds(spec), screenTargets: screenTargets(result) };
        const panel = buildReadinessPanel(response, owner);
        for (const gap of [...panel.blocking, ...panel.quality]) {
            expect({ id: gap.id, kind: gap.action.kind }).not.toEqual({ id: gap.id, kind: "none" });
            if (gap.action.kind === "form") expect(gap.action.requirementId).toBe(gap.id);
        }
        // los ítems de catálogo siguen en su pantalla
        for (const gap of panel.blocking.filter(g => g.id === "CORE.OFFER.ITEMS" || g.id.endsWith(".CATALOG"))) expect(gap.action.kind).toBe("link");
    });

    it("dental (R3): los huecos con formulario abren el cajón y la tarjeta de Inicio enlaza al panel con el cajón abierto", () => {
        const response = { ...responseFor(resultFor("spark-qa-dental-03")), formRequirementIds: formRequirementIds(spec) };
        const panel = buildReadinessPanel(response, owner);
        const withForm = panel.blocking.filter(g => g.action.kind === "form");
        expect(withForm.length).toBeGreaterThan(0);
        for (const gap of topBlockingGaps(response, owner)) {
            expect(gap.action.kind).toBe("link");
            if (withForm.some(g => g.id === gap.id) && gap.action.kind === "link") expect(gap.action.href).toBe(panelFormHref(gap.id));
        }
        // sin la lista (API anterior) todo vuelve a enlazar a su pantalla
        expect(buildReadinessPanel(responseFor(resultFor("spark-qa-dental-03")), owner).blocking.some(g => g.action.kind === "form")).toBe(false);
    });

    it("un hueco que nace de otro se muestra una vez, en su raíz", () => {
        const base = resultFor("spark-qa-dental-03");
        const reqs = base.requirements.filter(r => r.applies).slice(0, 2).map(r => ({ ...r }));
        const [root, child] = reqs;
        root.gap = { cause: "ausente", message: "Falta la raíz", intents: [], uiTarget: "/admin/menu", uiToday: "/admin/menu", rootOf: [child.id] };
        child.gap = { cause: "ausente", message: "Falta por la raíz", intents: [], uiTarget: "/admin/menu", uiToday: "/admin/menu", rootOf: [], rootCause: root.id };
        const result: ReadinessResult = { ...base, requirements: reqs, blockingGaps: [root.id, child.id], necessaryGaps: [], recommendedGaps: [] };
        const panel = buildReadinessPanel(responseFor(result), owner);
        expect(panel.blocking.map(g => g.id)).toEqual([root.id]);
        expect(panel.blocking[0].alsoFixes).toEqual([{ id: child.id, title: child.title }]);
    });
});
