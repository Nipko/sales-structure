import { redirect } from "next/navigation";

/** P26: legacy SMS configuration is intentionally not tenant self-service. */
export default function RetiredSmsNotificationsRoute() {
    redirect("/admin/settings");
}
