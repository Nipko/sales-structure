/**
 * WhatsApp delivery rates, as Meta publishes them.
 *
 * Pure functions over a table derived from the preserved official rate cards.
 * Nothing here reads a clock, a database or a provider, and nothing here is
 * wired into a sending path yet: this is the price, and the reservation that
 * spends against it is a separate concern that has to be atomic.
 *
 * The three things worth knowing before using it:
 *
 *   - A market with no rate card resolves to `unknown`, never to zero and never
 *     to a cheaper regional bucket.
 *   - Rates are micro-units per message; `Money` in cents is produced once per
 *     batch, rounding up. Colombia's US$0.0008 rounds to zero cents, which is
 *     why cents are not the unit a rate is carried in.
 *   - The free thousand is per phone number per calendar month. Being allowed
 *     to reply and being free to reply are different questions.
 */
export * from './whatsapp-rate-table.generated';
export * from './whatsapp-rate-money';
export * from './whatsapp-rate-resolver';
export * from './whatsapp-free-allowance';
export * from './recipient-market';
