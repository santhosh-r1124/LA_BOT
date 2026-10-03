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

/** Mirrors `app/schemas/payment.py::PaymentOut`. */
export interface Payment {
  id: string;
  consultation_id: string;
  provider: string;
  gateway_order_id: string;
  gateway_payment_id: string | null;
  amount: string;
  currency: string;
  status: 'CREATED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
  failure_reason: string | null;
  refunded_amount: string | null;
  captured_at: string | null;
  created_at: string;
}

/** Mirrors `app/schemas/payment.py::PaymentOrderOut`. */
export interface PaymentOrder {
  payment: Payment;
  gateway: string;
  gateway_order_id: string;
  /** Smallest currency unit (paise) — what checkout.js expects. */
  amount_minor: number;
  currency: string;
  key_id: string | null;
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
