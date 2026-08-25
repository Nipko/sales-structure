import { redirect } from "next/navigation";

/** Compatibility target for old bookmarks; new SMS setup is retired. */
export default function LegacySmsChannelRoute() {
  redirect("/admin/channels");
}
