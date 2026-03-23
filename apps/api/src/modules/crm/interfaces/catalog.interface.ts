export interface Course {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currency: string;
  duration_hours: number | null;
  modality: string | null;
  is_active: boolean;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface Campaign {
  id: string;
  name: string;
  course_id: string | null;
  channel: string | null;
  wa_template_name: string | null;
  status: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  office_hours_start: number | null;
  office_hours_end: number | null;
  max_attempts: number | null;
  retry_delay_hours: number | null;
  fallback_email: boolean | null;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}
