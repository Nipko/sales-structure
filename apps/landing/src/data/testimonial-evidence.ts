/**
 * Publication contract for customer testimonials.
 *
 * A testimonial may be rendered only after its source and publication consent
 * have been recorded. Keeping the registry empty makes the section fail closed
 * while the Wave 0 evidence review is in progress.
 */
export interface VerifiedTestimonialEvidence {
  id: string;
  quoteKey: string;
  authorName: string;
  authorRole: string;
  companyName: string;
  evidenceUrl: `https://${string}`;
  consentRecordedAt: `${number}-${number}-${number}`;
}

export const VERIFIED_TESTIMONIAL_EVIDENCE: readonly VerifiedTestimonialEvidence[] = [];

export const TESTIMONIALS_PUBLICATION_ENABLED = false;

