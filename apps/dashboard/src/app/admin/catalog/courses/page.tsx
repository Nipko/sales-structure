import { redirect } from "next/navigation";

/** Course management now has a single canonical destination. */
export default function CatalogCoursesRedirect() {
  redirect("/admin/courses");
}
