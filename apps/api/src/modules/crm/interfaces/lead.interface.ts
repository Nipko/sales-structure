export interface Company {
  id: string;
  name: string;
  industry: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface Lead {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string;
  email: string | null;
  score: number | null;
  stage: string | null;
  primary_intent: string | null;
  secondary_intent: string | null;
  is_vip: boolean | null;
  preferred_contact: string | null;
  campaign_id: string | null;
  course_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  referrer_url: string | null;
  gclid: string | null;
  fbclid: string | null;
  assigned_to: string | null;
  opted_out: boolean | null;
  opted_out_at: Date | null;
  last_contacted_at: Date | null;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}
