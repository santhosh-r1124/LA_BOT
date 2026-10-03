/**
 * On-demand consultation booking (Phase 8, FRD §9). Mirrors
 * `app/models/consultation.py` and `app/schemas/consultation.py` —
 * field names, snake_case, must match the wire format exactly.
 */

export const CONSULTATION_MODES = ['VIDEO', 'PHONE', 'IN_PERSON'] as const;
export type ConsultationMode = (typeof CONSULTATION_MODES)[number];

export const CONSULTATION_STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'DECLINED',
  'CANCELLED',
  'COMPLETED',
  'CLOSED',
] as const;
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];

export const CONSULTATION_PAYMENT_STATUSES = [
  'UNPAID',
  'PENDING',
  'PAID',
  'REFUNDED',
  'WAIVED',
] as const;
export type ConsultationPaymentStatus = (typeof CONSULTATION_PAYMENT_STATUSES)[number];

export interface Consultation {
  id: string;
  consumer_id: string;
  consumer_display_name: string | null;
  advocate_profile_id: string;
  advocate_display_name: string | null;
  practice_area: string;
  topic: string;
  description: string;
  mode: ConsultationMode;
  status: ConsultationStatus;
  preferred_time: string | null;
  scheduled_at: string | null;
  meeting_link: string | null;
  /** Decimal, serialised as a string by Pydantic (e.g. "1500.00"). */
  fee_amount: string | null;
  payment_status: ConsultationPaymentStatus;
  decline_reason: string | null;
  cancellation_reason: string | null;
  /** Only populated for the advocate/admin viewer — null for the consumer. */
  advocate_notes: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginatedConsultations {
  items: Consultation[];
  total: number;
  limit: number;
  offset: number;
}

/** Statuses from which either party may still cancel. */
export const CANCELLABLE_CONSULTATION_STATUSES: ReadonlySet<ConsultationStatus> = new Set([
  'REQUESTED',
  'ACCEPTED',
]);

export function consultationStatusLabel(status: ConsultationStatus): string {
  const labels: Record<ConsultationStatus, string> = {
    REQUESTED: 'Awaiting response',
    ACCEPTED: 'Scheduled',
    DECLINED: 'Declined',
    CANCELLED: 'Cancelled',
    COMPLETED: 'Completed',
    CLOSED: 'Closed',
  };
  return labels[status];
}
