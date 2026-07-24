---
id: cuenta-seguridad
title: "Your account, team, and security"
routes: ["/admin/users", "/admin/settings/security", "/admin/settings/change-password"]
roles: ["tenant_admin"]
keywords: ["account", "security", "team", "users", "invite user", "add user", "roles", "permissions", "administrator", "supervisor", "agent", "two-factor authentication", "2fa", "authentication", "code", "password", "change password", "trusted devices", "sso", "single sign-on", "saml", "language", "theme", "dark mode", "sign out", "inactivity", "session"]
---

This section is where you manage who on your team can access the platform, with which permissions, and how you protect access to your account. Most of these options are handled by the **Administrator** role.

## Your team and roles

You can invite the people on your team to work with you on the platform. Each person has a **role** that defines what they can see and do:

| Role | Who it's for | What they can do |
|------|-------------|------------------|
| **Administrator** | Account owner / person in charge | Everything: settings, channels, AI agents, billing, users, and data. |
| **Supervisor** | Team lead | View and audit conversations, CRM, and reports; manage day-to-day operations, without touching billing or sensitive settings. |
| **Agent** | Support staff | Handle conversations in the inbox and work with their assigned contacts. |

### How to invite someone

1. In the sidebar, go to **Users**.
2. Click **Invite** (add a user).
3. Enter their **email**, choose their **role**, and send the invitation.
4. The person receives an email with a link to accept the invitation and create their password.

From the same screen you can change a user's role or deactivate their access when someone leaves the team.

> **How many users can I have**: it depends on your plan. If you need more, upgrade your plan in **Settings** → **Billing**.

---

## Two-factor authentication (2FA)

Two-factor authentication adds a second layer of security: in addition to your password, a temporary code is required when you sign in. Highly recommended, especially for administrators.

1. Go to **Settings** → **Security**.
2. Turn on **Two-Factor Authentication** and choose the method:
   - **Authenticator app** (recommended): scan the QR code with Google Authenticator, Authy, or similar, and enter the 6-digit code to confirm.
   - **Email**: you receive the code in your inbox every time you sign in.
3. When you turn it on, a set of **backup codes** is generated. Keep them somewhere safe: they let you get in if you lose access to your app or your email.

### Trusted devices

When you sign in from your usual computer or phone, you can mark it as a **trusted device**. That way it won't ask you for the two-step code on that device for 30 days. From **Settings** → **Security** you can see the list of your trusted devices and remove any you no longer use (for example, a borrowed computer).

---

## Changing your password

1. Go to **Settings** → **Change Password**.
2. Enter your current password and then the new one (twice).
3. Save. Use a long, unique password that you don't reuse on other services.

> If you **forgot** your password and can't get in, use the **Forgot your password?** option on the sign-in screen: you'll receive a code in your email to create a new one.

---

## Single sign-on (SSO)

If your company uses a corporate identity system (for example, the one from your business email provider), you can set up **single sign-on (SSO)** so your team signs in with the company credentials, without managing separate passwords.

1. Go to **Settings** → **Security**.
2. In the **SSO / SAML** section, fill in the details provided by your identity provider and download the Parallly details it asks you for.
3. Optionally, you can **enforce SSO** so that all of your company's users must sign in this way.

> SSO is a feature of the higher-tier plans. If you don't see the option or want help setting it up, reach out to support.

---

## Language, theme, and sign-in

- **Platform language**: you can use the interface in Spanish, English, Portuguese, or French. The language selector is in your profile menu / top bar. Changing it does not affect the language your AI assistant uses to reply to customers.
- **Light or dark theme**: in the top bar you'll find the theme switch (light / dark / automatic based on your system).
- **Sign-out on inactivity**: for security, if you leave the session idle for a long time, you'll see a warning before it closes automatically. This is normal; just sign in again.

---

## Frequently asked questions

**I invited someone but they're not getting the email.**
Ask them to check their spam or junk folder. Also make sure the email address is spelled correctly. You can resend the invitation from **Users**.

**An agent sees fewer options than I do. Is something wrong?**
No. Each role sees only what it needs for its job. An agent sees the inbox and their contacts, but not billing or settings: that's correct and it protects your account.

**I turned on two-factor authentication and lost my phone.**
Use one of the **backup codes** you saved when you turned it on. If you don't have those either, reach out to support so we can verify your identity and restore your access.

**Can I require my whole team to use two-factor authentication?**
Two-factor authentication is enabled per user. If you need to require it company-wide or use mandatory SSO, contact us and we'll help based on your plan.

Still have questions? Reach out to us at https://parallly-chat.cloud/support
