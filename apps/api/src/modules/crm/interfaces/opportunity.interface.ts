export interface Opportunity {
  id: string;
  lead_id: string;
  course_id: string | null;
  campaign_id: string | null;
  conversation_id: string | null;
  stage: string | null;
  score: number | null;
  estimated_value: number | null;
  currency: string | null;
  sla_deadline: Date | null;
  won_at: Date | null;
  lost_at: Date | null;
  loss_reason: string | null;
  assigned_to: string | null;
  metadata: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}
