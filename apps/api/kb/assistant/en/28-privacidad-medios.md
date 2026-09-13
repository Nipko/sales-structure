---
id: privacidad-medios
title: "Privacy for images, audio, and consent"
routes: ["/admin/settings/policies", "/admin/compliance", "/admin/settings/billing"]
roles: ["tenant_admin"]
keywords: ["privacy", "consent", "audio", "image", "transcription", "analysis", "retention", "withdraw"]
---

# Privacy for images, audio, and consent

A plan may include image analysis or audio transcription, but availability does not authorize processing a person's content. Before using the capability, the business must publish an active privacy policy under **Settings → Policies → Privacy**. The text should explain which media is processed, for what purpose, how long it is retained, and how consent can be withdrawn. The person responsible for the business must review the text; Parallly Assist does not invent or publish legal terms.

When an image or audio arrives without valid authorization, the agent neither retains nor analyzes that file. It sends a clear request, links the public policy, and waits for explicit confirmation. If the person agrees, Parallly records the scope, policy version, date, and originating conversation. It then asks the person to resend the original file because the first copy was not retained. An ambiguous or conditional reply does not grant permission.

Media consent covers the requested automated extraction; it is not broad permission to reuse data. The source file and temporary extraction are removed when the turn completes. The final customer message follows normal conversation retention. Authorization can be withdrawn under **Compliance**, and it also stops applying when the active policy version changes or the contact is erased.

Parallly account security and the payment relationship with Meta are separate concerns. The card a business registers for WhatsApp charges is managed by Meta; it does not give Parallly access to card details. The business privacy policy governs how its customers' data is handled by the agent. Review both controls separately and test the agent with synthetic media after publishing the policy.

If Agent health shows **Privacy for images and audio**, open the recommendation or use **Show me how**. The blocker clears only when an active privacy policy is available to the runtime; a shipping policy, general terms, or a draft does not satisfy it.
