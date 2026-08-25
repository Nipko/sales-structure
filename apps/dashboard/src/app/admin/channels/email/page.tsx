import { redirect } from "next/navigation";

/**
 * Compatibility target for old bookmarks. Email remains a managed inbound
 * adapter and is not a tenant self-service conversational channel.
 */
export default function LegacyEmailChannelRoute() {
    redirect("/admin/channels");
}
