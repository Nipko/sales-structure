import { redirect } from "next/navigation";

/** Legacy catalog hub kept as a stable bookmark alias. */
export default function CatalogHubRedirect() {
  redirect("/admin/courses");
}
