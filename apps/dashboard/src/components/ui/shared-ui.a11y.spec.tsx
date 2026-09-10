import type { ReactElement } from "react";
import { Bell, Inbox, MessageSquare } from "lucide-react";
import { scanScreen } from "@/test/a11y";
import { Badge } from "./badge";
import { Breadcrumbs } from "./breadcrumbs";
import { Button } from "./button";
import { ConfirmStep } from "./confirm-step";
import { EmptyState } from "./empty-state";
import { Input } from "./input";
import { Label } from "./label";
import { LoadFailureNotice } from "./load-failure";
import { PageHeader } from "./page-header";
import { TabNav } from "./tab-nav";
import { UpgradeBanner } from "./upgrade-banner";

/**
 * The pieces every screen is assembled from.
 *
 * A dashboard's accessibility is mostly decided here: if `Button` renders a
 * `<div onClick>`, or `TabNav` claims `role="tablist"` without the roles that
 * role requires, the defect ships on 144 pages at once. These are presentational
 * components with no data of their own, so nothing is stubbed for them beyond
 * what the harness stubs for every scan — the router, `<Link>` and the
 * animation library, none of which the accessibility tree reads.
 */

const cases: Array<[string, () => ReactElement]> = [
    ["Button", () => <Button>Guardar</Button>],
    ["Button (icon only)", () => (
        <Button aria-label="Notificaciones"><Bell size={16} aria-hidden="true" /></Button>
    )],
    ["Badge", () => <Badge>Activo</Badge>],
    ["Input with Label", () => (
        <div>
            <Label htmlFor="business-name">Nombre del negocio</Label>
            <Input id="business-name" defaultValue="Peluquería Norte" />
        </div>
    )],
    ["PageHeader", () => (
        <PageHeader title="Canales" subtitle="Gestiona tus conexiones" icon={MessageSquare} />
    )],
    ["Breadcrumbs", () => (
        <Breadcrumbs items={[{ label: "Agentes", href: "/admin/agent" }, { label: "Vendedora" }]} />
    )],
    ["TabNav", () => (
        <TabNav
            tabs={[{ id: "legal", label: "Textos legales" }, { id: "consents", label: "Consentimientos", badge: 3 }]}
            activeTab="legal"
            onTabChange={() => {}}
        />
    )],
    ["EmptyState", () => (
        <EmptyState icon={Inbox} title="Sin conversaciones" description="Cuando llegue un mensaje aparecerá aquí." />
    )],
    ["ConfirmStep", () => (
        <ConfirmStep
            title="¿Desconectar el canal?"
            consequence="Se dejarán de recibir mensajes en este número."
            confirmLabel="Desconectar"
            cancelLabel="Cancelar"
            busy={false}
            onConfirm={() => {}}
            onCancel={() => {}}
        />
    )],
    ["UpgradeBanner", () => <UpgradeBanner current={3} limit={3} resourceLabel="agentes" />],
    ["LoadFailureNotice", () => <LoadFailureNotice onRetry={() => {}} />],
    ["LoadFailureNotice (no retry)", () => <LoadFailureNotice />],
];

describe("shared UI components have no machine-detectable accessibility violations", () => {
    it.each(cases)("%s", async (_name, render) => {
        const violations = await scanScreen(render());
        expect(violations).toEqual([]);
    });
});
