"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /admin/settings/integrations doesn't render its own page — it redirects
 * to the only existing child (CRM) so the URL still works if someone
 * lands here directly. New integration sub-routes can be added under
 * /admin/settings/integrations/<provider>/page.tsx.
 */
export default function IntegrationsIndex() {
    const router = useRouter();
    useEffect(() => {
        router.replace("/admin/settings/integrations/crm");
    }, [router]);
    return null;
}
