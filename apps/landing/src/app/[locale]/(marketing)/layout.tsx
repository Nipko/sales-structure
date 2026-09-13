import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";

export default function LocalizedMarketingLayout({ children }: { children: React.ReactNode }) {
  return <><Navbar /><main id="contenido-principal" className="pt-16">{children}</main><Footer /></>;
}
