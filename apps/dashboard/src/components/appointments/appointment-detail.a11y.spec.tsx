import { renderScreen } from "@/test/a11y";
import AppointmentModal from "./AppointmentModal";
import type { Appointment } from "./shared";

jest.mock("@/lib/api", () => ({ __esModule: true, api: {} }));

/**
 * Review of 2026-10-08: the appointment dialog showed the assigned agent as a
 * raw internal id in a free-text field, and nothing said that the assistant had
 * booked it or where the conversation was.
 */
const AGENT_ID = "084a8ec6-1111-4222-8333-944455556666";
const CONVERSATION_ID = "c0ffee00-1111-4222-8333-944455556666";

function appointment(over: Partial<Appointment> = {}): Appointment {
  return {
    id: "a-1",
    serviceName: "Corte y estilo",
    contactName: "Joaquin Sosa",
    assignedTo: AGENT_ID,
    assignedName: "Prueba Parallly",
    startAt: "2026-10-12T09:00:00",
    endAt: "2026-10-12T09:45:00",
    status: "confirmed",
    createdAt: "2026-10-01T00:00:00Z",
    ...over,
  };
}

function modal(editing: Appointment) {
  return (
    <AppointmentModal
      form={{
        serviceName: editing.serviceName, date: "2026-10-12", startTime: "09:00", endTime: "09:45",
        location: "", notes: "Cliente: Joaquin Sosa", assignedTo: editing.assignedTo ?? "", contactId: "",
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
      editingAppointment={editing}
      saving={false}
      onSave={() => {}}
      onClose={() => {}}
    />
  );
}

const valuesOf = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")).map((el) => el.value);

describe("assigned agent", () => {
  it("shows the person's name and never the internal id", async () => {
    const screen = await renderScreen(modal(appointment()));
    try {
      expect(screen.container.textContent).toContain("Agente asignado");
      expect(screen.container.textContent).toContain("Prueba Parallly");
      expect(screen.container.textContent).not.toContain(AGENT_ID);
      expect(valuesOf(screen.container)).not.toContain(AGENT_ID);
      expect(screen.container.querySelector('input[placeholder="ID del agente"]')).toBeNull();
    } finally { screen.unmount(); }
  });

  it("hides the field when there is no name to show", async () => {
    const screen = await renderScreen(modal(appointment({ assignedName: undefined })));
    try {
      expect(screen.container.textContent).not.toContain("Agente asignado");
      expect(screen.container.textContent).not.toContain(AGENT_ID);
    } finally { screen.unmount(); }
  });
});

describe("origin of the appointment", () => {
  it("says the assistant created it and links the conversation", async () => {
    const screen = await renderScreen(modal(appointment({ source: "ai", conversationId: CONVERSATION_ID })));
    try {
      const origin = screen.container.querySelector('[data-appointment-origin="ai"]');
      expect(origin?.textContent).toContain("Creada por el asistente IA");
      const link = origin?.querySelector("a");
      expect(link?.textContent).toBe("Ver conversación");
      expect(link?.getAttribute("href")).toBe(`/admin/inbox?conversation=${CONVERSATION_ID}`);
    } finally { screen.unmount(); }
  });

  it("says it without a link when the conversation is unknown", async () => {
    const screen = await renderScreen(modal(appointment({ source: "ai", conversationId: null })));
    try {
      const origin = screen.container.querySelector('[data-appointment-origin="ai"]');
      expect(origin?.textContent).toContain("Creada por el asistente IA");
      expect(origin?.querySelector("a")).toBeNull();
    } finally { screen.unmount(); }
  });

  it("says nothing for an appointment a person created", async () => {
    const screen = await renderScreen(modal(appointment({ source: "manual", conversationId: CONVERSATION_ID })));
    try {
      expect(screen.container.querySelector('[data-appointment-origin="ai"]')).toBeNull();
      expect(screen.container.textContent).not.toContain("Creada por el asistente IA");
    } finally { screen.unmount(); }
  });
});
