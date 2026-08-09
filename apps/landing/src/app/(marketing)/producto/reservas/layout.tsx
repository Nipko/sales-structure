import { buildMetadata } from "../../../../lib/seo";

export const metadata = buildMetadata({
  title: "Reservas y agenda",
  description:
    "Gestiona disponibilidad, servicios, personal, recordatorios y calendarios para agendar desde una conversación.",
  path: "/producto/reservas",
});

export default function BookingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
