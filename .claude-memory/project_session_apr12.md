---
name: Session April 12-13 Summary
description: Major session — Google OAuth, 3 new modules (Media/Templates/Appointments), email redesign, scaling analysis
type: project
---

Session date: April 12-13, 2026

**Why:** Track what was implemented so the next session can continue without re-explaining.

## Implemented in this session

### Google OAuth + Onboarding
- Google Sign-In with renderButton (popup mode, not FedCM)
- Setup password, email verification (OTP), 4-step onboarding wizard
- super_admin and users with tenant skip onboarding
- GoogleAuthService with hardcoded client ID fallback

### Auth Enhancements
- Professional email templates (respond.io style): verification, reset, 2FA, welcome, password changed
- Password reset flow: POST /auth/forgot-password + /auth/reset-password (public)
- Change password: POST /auth/change-password (authenticated)
- Email-based 2FA: POST /auth/send-2fa + /auth/verify-2fa
- Frontend pages: /forgot-password, /admin/settings/change-password

### 3 New Feature Modules
1. **Media Module** — Upload, resize (sharp→webp), serve via readFile+res.end, company logo, label/description, 5MB limit
2. **Email Templates** — CRUD, 4 default templates with {{variables}}, preview, test send
3. **Appointments** — CRUD, availability slots, blocked dates, conflict detection, calendar UI

### Fixes
- Deploy: ALTER TABLE split into separate -c flags (was failing silently)
- SMTP config added to deploy pipeline
- Agent analytics: m.sender→m.direction
- Contacts "last interaction": now uses actual last message date, not leads.updated_at
- Multi-tenant isolation audit: confirmed schema isolation is correct

## Pending for next session
- Scaling Phase 1: PgBouncer, Sentry, separate workers
- i18n with next-intl (es/en/pt)
- Cloudflare R2 for media storage
- Country landing pages with hreflang
- WhatsApp typing indicator still broken for SMB accounts
