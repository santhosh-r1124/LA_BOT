import type { Consultation, PaginatedConsultations } from '@legal-platform/shared';
import { apiFetch } from './api-client';

export interface CreateConsultationPayload {
  advocate_profile_id: string;
  practice_area: string;
  topic: string;
  description: string;
  mode: 'VIDEO' | 'PHONE' | 'IN_PERSON';
  preferred_time?: string;
}

/** Bindings for `/api/v1/consultations/*` (Phase 8). Every call needs a token. */
export const consultationClient = {
  create: (payload: CreateConsultationPayload, token: string) =>
    apiFetch<Consultation>('/api/v1/consultations', { method: 'POST', body: payload, token }),

  listMine: (token: string, status?: string) =>
    apiFetch<PaginatedConsultations>(`/api/v1/consultations${status ? `?status=${status}` : ''}`, {
      token,
    }),

  get: (id: string, token: string) =>
    apiFetch<Consultation>(`/api/v1/consultations/${id}`, { token }),

  cancel: (id: string, reason: string, token: string) =>
    apiFetch<Consultation>(`/api/v1/consultations/${id}/cancel`, {
      method: 'POST',
      body: { reason },
      token,
    }),
};
