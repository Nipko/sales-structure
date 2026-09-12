# DRAFT — awaiting human review. Nothing here has been applied.

**Status:** proposed wording and open decisions only. No legal page, no contract and
no price was changed by the pass that produced this file. Every item below needs a
named human owner to accept, reject or rewrite it before it reaches a public page.

**Not a legal opinion, and not an approval.** No lawyer, tax adviser or finance
owner has reviewed any sentence in this file. Where an item says "proposed text",
that is a request for review, not a cleared string.

**Scope of the pass that wrote this:** `apps/landing` only. It added an estimator to
`/costos-whatsapp`, four labelled demos, the custody line on the three-payments
notice, an i18n parity validator and a hardened signup bridge. It changed no legal
page and no API.

---

## 1. Why the legal pages may now be out of step

Three facts are now stated plainly on marketing pages. If the legal pages say
anything narrower, weaker or merely different, the marketing page is the one a
reader will quote back.

### 1.1 Meta charges the business, not Parallly

`/costos-whatsapp` and the notice beside every CTA now say that from 1 October 2026
Meta bills the business's OWN WhatsApp Business account for each delivered service
message, that this money never passes through Parallly, and that it is not part of
any plan.

**Derived from:** `docs/product-capabilities-reference.md` (lines 49–55) and
`docs/audits/2026-09-12/m4-pricing-proposal.md` (lines 13–16).

**Review question for the terms owner:** do the current terms say anywhere, or imply
by silence, that platform fees cover message delivery? If the fee schedule lists
"WhatsApp" as an included item, it contradicts the public page.

**Proposed clause (draft):**

> Los cargos que Meta Platforms emite por la entrega de mensajes desde la cuenta de
> WhatsApp Business del Cliente son una relación directa entre el Cliente y Meta.
> Parallly no es parte de esa relación, no factura ni refactura esos cargos, no los
> incluye en ninguna suscripción y no puede acreditarlos, bonificarlos ni
> reembolsarlos. El medio de pago que los cubre se administra en las herramientas de
> Meta, sobre la cuenta del Cliente.

### 1.2 Parallly never holds the Meta payment method

The short notice now carries, on every page that shows a CTA: the Meta payment
method is added on Meta's own page, and Parallly does not receive it, does not store
it and cannot verify it.

**Derived from:** `apps/landing/src/data/payment-model.ts`, where
`whatsappDelivery.methodEnteredAt` is `"meta"` and `parallelyVisibility` is
`"status_only"`; the build fails if either changes.

**Review question for the privacy owner:** the privacy policy describes what we
collect. Does it state, positively, that we do not collect this instrument? An
absence is not a commitment.

**Proposed addition (draft):**

> No recopilamos ni almacenamos los datos del medio de pago que el Cliente registra
> ante Meta. Cuando el Cliente lo autoriza, consultamos el estado que Meta expone
> sobre esa cuenta (si hay un método asociado y desde cuándo). Ese estado no informa
> saldo, deuda ni garantía de entrega, y no lo presentamos como tal.

### 1.3 The subscription card: the mechanism, not a guarantee

`trust.mpDesc` said the card details "nunca tocan nuestros servidores". It now
describes the mechanism instead: the browser sends them to Wompi, and the database
keeps a reference with the brand, the last four digits and the expiry.

**Derived from:** `apps/api/src/modules/billing/recurring/payment-source.service.ts`
and `apps/api/src/modules/billing/adapters/wompi.adapter.ts`.

**Why it changed:** the old sentence was an absolute security guarantee resting on
tokenisation alone. Tokenisation is real and the claim about the SERVER was
defensible, but a general guarantee covers the frontend and any instrumentation on
it, which tokenisation does not.

**Review question:** does the privacy policy still carry an equivalent absolute?
If so, it should be replaced with the same mechanism sentence.

---

## 2. Commercial decisions this pass deliberately did not take

None of these is a coding task. Each needs a person with the authority to decide.

| # | Decision | Why it is blocked | Consequence of leaving it |
|---|---|---|---|
| 1 | Whether to state publicly that Parallly is a Meta Tech Provider | True as a description of the billing model, but the commercial contract and account ownership are not proven by anything in the repository (`docs/research/2026-09-10/plan-economics-code-audit.md`, line 9), and the badge is frozen by `validate-marketing-claims.cjs` | The pages state the payment FACT without the badge, which is accurate but gives up a real differentiator |
| 2 | Whether `whatsappCreditUsdCents` was ever sold to anyone | It is seed data with no consuming logic: a plan feature that grants nothing. If it was presented as a credit to any existing tenant, that is an outstanding commitment | Nothing on the public site mentions it, which is correct for new sales and says nothing about existing ones |
| 3 | Whether spend enforcement will ever be offered as a cap | The gate defaults to `observe` and no screen or endpoint writes `enforce` (`apps/api/src/modules/billing/whatsapp-spend/whatsapp-send-admission.service.ts`, line 816) | The site claims metering and visibility and claims no cap, which matches the code |
| 4 | Fee schedule wording once the estimator is public | A reader who sees an estimated Meta total beside a subscription price may ask which is contractual | The estimator says it is not an invoice, in four languages, and lists four exclusions — but the terms have not been read against it |
| 5 | Testimonials | Still switched off, failing closed until registered evidence AND consent exist | Empty strings in all four locales; the parity validator exempts them explicitly rather than pressuring anyone to invent a quote |

---

## 3. One structural item left open, on purpose

**Four languages share one HTML per route, and no page emits `hreflang`.**

The language is chosen in the browser from a cookie and `navigator.languages`
(`src/components/LangProvider.tsx`). There are 37 exported pages and 37 canonical
tags, and zero language alternates.

This was **not** "fixed" by adding `hreflang`, because four alternates pointing at
one cookie-dependent document tell a crawler that four indexable URLs exist when
one does — a worse state than silence. Instead, `validate-marketing-claims.cjs` now
fails the build if anybody adds `hreflang` or a sitemap `xhtml:link` while the
per-locale routes still do not exist.

**The actual fix, for whoever picks it up:**

1. A locale segment under `src/app` (`[locale]` with `generateStaticParams`, or four
   generated trees), so `/`, `/en/...`, `/pt/...`, `/fr/...` are real documents.
2. `LangProvider` driven by the path, with the cookie demoted to a redirect hint on
   the root only.
3. `alternates.languages` in `seo.ts` plus `x-default`, per route.
4. `public/sitemap.xml` derived from the route table rather than maintained by hand —
   37 routes times four locales is not a list anybody keeps correct.
5. Redirects preserved for every existing URL.

Estimated shape: every page file touched, the sitemap regenerated, and the locale
assertions in the validator re-pointed. It is a session of its own, not a patch.

---

## 4. What the reviewer should check first

1. Read §1.1 against the current fee schedule. That is the one contradiction that
   costs money if a tenant loses delivery on 1 October and says the plan covered it.
2. Read §1.2 against the privacy policy's collection list.
3. Decide item 2 in §2 (the WhatsApp credit). It is the only one with a possible
   existing commitment behind it.
4. Everything else can wait for the next review cycle without a public page being
   wrong in the meantime.
