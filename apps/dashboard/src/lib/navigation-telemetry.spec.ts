import {
    NAVIGATION_TELEMETRY_MAX_BATCH,
    sanitizeNavigationTelemetry,
    sanitizeNavigationTelemetryBatch,
} from "@parallext/shared";

/**
 * Contar los callejones sin salida que el Gate 4 dice que no deben existir.
 *
 * Las pruebas verifican los mapas y los permisos, pero la estructura sólo
 * cubre lo que alguien pensó en declarar: una configuración rara, un enlace
 * guardado hace meses o un rol que cambió a mitad de sesión producen el mismo
 * síntoma sin que ningún mapa esté mal.
 */
describe("navigation telemetry contract", () => {
    const valid = {
        event: "navigation.access_denied",
        route: "/admin/vehicles",
        reason: "plan",
        role: "tenant_agent",
        requirement: "vehicleInventory",
    };

    it("accepts the shape the dashboard emits", () => {
        expect(sanitizeNavigationTelemetry(valid)).toEqual(valid);
    });

    it("drops an event name the contract does not declare", () => {
        expect(sanitizeNavigationTelemetry({ ...valid, event: "navigation.rage_click" })).toBeNull();
        expect(sanitizeNavigationTelemetry({ ...valid, event: "message_sent" })).toBeNull();
    });

    /**
     * El registro entero, no el campo. Guardar la mitad buena esconde el
     * problema hasta que aparezca un dato que no debía estar en una tabla de
     * analítica.
     */
    it.each([
        ["an email", { email: "ana@example.com" }],
        ["a name", { contactName: "Ana" }],
        ["free text", { note: "cliente enojado" }],
        ["an id", { userId: "550e8400-e29b-41d4-a716-446655440000" }],
    ])("drops the whole record when it carries %s", (_label, extra) => {
        expect(sanitizeNavigationTelemetry({ ...valid, ...extra })).toBeNull();
    });

    /** Una ruta con query o con un id lleva dentro lo que el contrato excluye. */
    it.each([
        "/admin/contacts/550e8400-e29b-41d4-a716-446655440000",
        "/admin/vehicles?search=ana",
        "https://admin.parallly-chat.cloud/admin/vehicles",
        "/settings",
        "",
    ])("rejects the route %s", (route) => {
        expect(sanitizeNavigationTelemetry({ ...valid, route })).toBeNull();
    });

    it("requires a typed reason", () => {
        expect(sanitizeNavigationTelemetry({ ...valid, reason: "porque si" })).toBeNull();
        expect(sanitizeNavigationTelemetry({ event: valid.event, route: valid.route })).toBeNull();
    });

    it("keeps the optional fields optional", () => {
        expect(sanitizeNavigationTelemetry({
            event: "navigation.dead_end", route: "/admin/orders", reason: "vertical",
        })).toEqual({ event: "navigation.dead_end", route: "/admin/orders", reason: "vertical" });
    });

    it("bounds a batch and drops only the invalid records", () => {
        const batch = [
            valid,
            { ...valid, event: "nope" },
            { ...valid, route: "/admin/orders" },
        ];
        expect(sanitizeNavigationTelemetryBatch(batch)).toHaveLength(2);

        const flood = Array.from({ length: 200 }, (_, i) => ({
            ...valid, route: `/admin/route-${i}`,
        }));
        expect(sanitizeNavigationTelemetryBatch(flood))
            .toHaveLength(NAVIGATION_TELEMETRY_MAX_BATCH);
    });

    it("treats junk as no events rather than throwing", () => {
        expect(sanitizeNavigationTelemetryBatch(undefined)).toEqual([]);
        expect(sanitizeNavigationTelemetryBatch("nope")).toEqual([]);
        expect(sanitizeNavigationTelemetry(null)).toBeNull();
        expect(sanitizeNavigationTelemetry([valid])).toBeNull();
    });
});
