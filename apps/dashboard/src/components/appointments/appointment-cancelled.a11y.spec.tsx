import { interact, renderScreen } from "@/test/a11y";
import CalendarGrid from "./CalendarGrid";
import AppointmentModal from "./AppointmentModal";
import AppointmentStatusBadge from "./AppointmentStatusBadge";
import type { Appointment } from "./shared";

jest.mock("@/lib/api", () => ({ __esModule: true, api: {} }));

/**
 * Review of 2026-10-08: two cancelled appointments looked exactly like live
 * ones in the calendar, could be dragged to another slot, and opened an edit
 * form that never said they were cancelled.
 */
function appt(over: Partial<Appointment> & { id: string }): Appointment {
  return {
    serviceName: "Corte y estilo",
    contactName: "Joaquin Sosa",
    startAt: "2026-10-12T09:00:00",
    endAt: "2026-10-12T10:30:00",
    status: "confirmed",
    createdAt: "2026-10-01T00:00:00Z",
    ...over,
  };
}

const MONDAY = new Date(2026, 9, 12);

function grid(appointments: Appointment[]) {
  return (
    <CalendarGrid
      appointments={appointments}
      services={[]}
      externalEvents={[]}
      weekStart={MONDAY}
      dateLocale="es-MX"
      onWeekChange={() => {}}
      onCreateAppointment={() => {}}
      onEditAppointment={() => {}}
      onReschedule={jest.fn()}
    />
  );
}

const byStatus = (root: HTMLElement, status: string) =>
  root.querySelector<HTMLElement>(`[data-appointment-status="${status}"]`);

describe("calendar blocks", () => {
  it("shows a cancelled appointment muted, struck through, labelled and not draggable", async () => {
    const screen = await renderScreen(grid([
      appt({ id: "live", status: "confirmed", startAt: "2026-10-12T09:00:00" }),
      appt({ id: "dead", status: "cancelled", startAt: "2026-10-13T09:00:00", endAt: "2026-10-13T10:30:00" }),
    ]));
    try {
      const live = byStatus(screen.container, "confirmed")!;
      const dead = byStatus(screen.container, "cancelled")!;
      expect(live.getAttribute("draggable")).toBe("true");
      expect(dead.getAttribute("draggable")).toBe("false");
      expect(dead.className).toContain("opacity-60");
      expect(dead.innerHTML).toContain("line-through");
      expect(dead.textContent).toContain("Cancelada");
      expect(live.textContent).not.toContain("Cancelada");
    } finally { screen.unmount(); }
  });

  it("does not start a drag of a cancelled appointment", async () => {
    const screen = await renderScreen(grid([appt({ id: "dead", status: "cancelled" })]));
    try {
      const dead = byStatus(screen.container, "cancelled")!;
      const event = new Event("dragstart", { bubbles: true, cancelable: true });
      Object.assign(event, { dataTransfer: { setData: jest.fn(), effectAllowed: "" } });
      await interact(() => { dead.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
    } finally { screen.unmount(); }
  });

  it("lets the owner hide cancelled appointments", async () => {
    const screen = await renderScreen(grid([
      appt({ id: "dead", status: "cancelled" }),
      appt({ id: "live", status: "pending", startAt: "2026-10-14T09:00:00" }),
    ]));
    try {
      const toggle = Array.from(screen.container.querySelectorAll("button"))
        .find((b) => b.textContent?.trim() === "Ocultar canceladas")!;
      expect(toggle).toBeTruthy();
      await interact(() => { toggle.click(); });
      expect(byStatus(screen.container, "cancelled")).toBeNull();
      expect(byStatus(screen.container, "pending")).not.toBeNull();
    } finally { screen.unmount(); }
  });
});

function modal(appointment: Appointment) {
  return (
    <AppointmentModal
      form={{
        serviceName: appointment.serviceName, date: "2026-10-12", startTime: "09:00", endTime: "10:30",
        location: "", notes: "", assignedTo: "", contactId: "",
      }}
      onChange={() => {}}
      services={[]}
      contacts={[]}
      contactsLoading={false}
      contactsLoadFailed={false}
      contactSearch=""
      onContactSearchChange={() => {}}
      contactsHasMore={false}
      onLoadMoreContacts={() => {}}
      onRetryContacts={() => {}}
      editingAppointment={appointment}
      saving={false}
      onSave={() => {}}
      onClose={() => {}}
    />
  );
}

describe("opening an appointment", () => {
  it("shows the status, and a cancelled one is read-only with no save button", async () => {
    const screen = await renderScreen(modal(appt({ id: "dead", status: "cancelled" })));
    try {
      const text = screen.container.textContent ?? "";
      expect(byStatus(screen.container, "cancelled")?.textContent).toBe("Cancelada");
      expect(text).toContain("Detalle de la cita");
      expect(text).toContain("está cancelada");
      expect(screen.container.querySelector("fieldset")?.disabled).toBe(true);
      const labels = Array.from(screen.container.querySelectorAll("button")).map((b) => b.textContent?.trim());
      expect(labels).toContain("Cerrar");
      expect(labels).not.toContain("Actualizar");
    } finally { screen.unmount(); }
  });

  it("shows the status of a live appointment and keeps it editable", async () => {
    const screen = await renderScreen(modal(appt({ id: "live", status: "pending" })));
    try {
      expect(byStatus(screen.container, "pending")?.textContent).toBe("Pendiente");
      expect(screen.container.textContent).toContain("Editar cita");
      expect(screen.container.querySelector("fieldset")?.disabled).toBe(false);
    } finally { screen.unmount(); }
  });
});

describe("status badge", () => {
  it("says the status in words", async () => {
    const screen = await renderScreen(<AppointmentStatusBadge status="no_show" />);
    try {
      expect(screen.container.textContent).toBe("No asistió");
    } finally { screen.unmount(); }
  });
});
