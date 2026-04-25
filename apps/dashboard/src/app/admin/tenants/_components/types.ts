export interface Tenant {
  id: string;
  name: string;
  slug: string;
  industry: string;
  language: string;
  plan: string;
  isActive: boolean;
  createdAt: string;
  channels: number;
  conversations: number;
  users: number;
  subscriptionStatus?: string;
  currentPeriodEnd?: string | null;
  trialEndsAt?: string | null;
  onboardingCompleted?: boolean;
  suspendedAt?: string | null;
  suspendReason?: string | null;
}

export interface TenantUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface PlatformStats {
  active: number;
  trialing: number;
  pastDue: number;
  cancelled: number;
  suspended: number;
  mrr: number;
  totalRevenue: number;
  signups7d: number;
  signups30d: number;
}

export interface PlatformHealth {
  api: boolean;
  redis: boolean;
  postgres: boolean;
  queues: {
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
  }[];
  channelDistribution: { type: string; count: number }[];
}

export interface PlatformBilling {
  mrr: number;
  totalRevenue: number;
  activeSubscriptions: number;
  failedPayments: number;
  planDistribution: { plan: string; count: number }[];
  recentPayments: {
    tenantName: string;
    amount: number;
    status: string;
    date: string;
  }[];
  failedPaymentsList: {
    tenantName: string;
    amount: number;
    reason: string;
    date: string;
  }[];
}

export interface PlatformUsage {
  tenants: {
    id: string;
    name: string;
    plan: string;
    automationUsed: number;
    automationLimit: number;
    outboundUsed: number;
    outboundLimit: number;
    status: string;
  }[];
}
