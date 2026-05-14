"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// SMS channel is hidden until integration is ready.
// Redirect any direct URL access back to channels overview.
export default function SmsChannelPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/channels");
  }, [router]);
  return null;
}
