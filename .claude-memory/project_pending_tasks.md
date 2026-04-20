---
name: Pending Tasks
description: Features and fixes pending implementation — check this when user asks "what's pending?"
type: project
originSessionId: d5aaa220-582d-4f39-aed4-0a7831ce3013
---
## Public Booking Integration (April 18, 2026)
- Backend exists: `public-booking.controller.ts` + Frontend: `/book/[tenantSlug]`
- **Missing:** Toggle "Enable public booking" in Appointments → Config
- **Missing:** Copiable link for tenant to share (parallly-chat.cloud/book/{slug})
- **Missing:** Preview/QR code of the booking link
- **Missing:** AI agent tool to send booking link to customer during conversation
- **Missing:** Customization (logo, colors, welcome text) for public booking page
- **Why:** The booking page exists but is disconnected — no way to activate it or find the URL from the dashboard

## Outbound Message Delivery Verification
- Task #58 still pending: verify outbound messages work after deploy
- Critical pipeline was fixed (ComplianceService removed from processor, isBlocked removed from reply path)
- Needs production testing to confirm messages reach customers

## Agent Templates — Content Enhancement
- 6 built-in templates upgraded with SPIN/BANT methodology (done April 18)
- **Pending:** Allow templates to include channel-specific greeting variations (WhatsApp vs Instagram vs SMS)
- **Pending:** E-commerce/Product Advisor template (7th template, researched but not implemented)

## Subscription/Billing System
- 4 plans defined (starter/pro/enterprise/custom) with agent limits
- **Missing:** Actual payment integration (Stripe, etc.)
- **Missing:** Plan upgrade/downgrade flow in dashboard
- **Missing:** Billing page in settings
- **Missing:** Usage tracking dashboard (messages sent, AI calls, etc.)

## Google Calendar Integration
- OAuth scope fixed (calendar.events → calendar)
- **Pending:** Google verification of OAuth consent screen (requires demo video)
- **Pending:** Test full calendar sync flow after verification
