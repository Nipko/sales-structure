import { buildMetadata } from "../../../../lib/seo";

export const metadata = buildMetadata({
  title: "Parallly Assist",
  description: "Recibe orientación dentro de Parallly para preparar la configuración, revisar tareas y encontrar el siguiente paso permitido para tu rol.",
  path: "/producto/parallly-assist",
});

export default function AssistLayout({ children }: { children: React.ReactNode }) {
  return children;
}
