import { buildMetadata } from "../../lib/seo";

export const metadata = buildMetadata({
  title: "Crear cuenta",
  description: "Continúa al registro seguro de Parallly.",
  path: "/signup",
  noIndex: true,
});

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
