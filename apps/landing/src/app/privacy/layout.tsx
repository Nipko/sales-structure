import { buildMetadata } from "../../lib/seo";

export const metadata = buildMetadata({
  title: "Política de privacidad",
  description: "Conoce cómo Parallly recopila, usa, protege y gestiona los datos personales.",
  path: "/privacy",
});

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
