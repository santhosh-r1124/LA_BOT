import type { Consultation, PaginatedConsultations } from '@legal-platform/shared';
import { apiFetch } from './api-client';

/** Bindings for `/api/v1/consultations/*` (Phase 8) from the advocate's side. */
export const consultationClient = {
  listMine: (token: string, status?: string) =>
    apiFetch<PaginatedConsultations>(`/api/v1/consultations${status ? `?status=${status}` : ''}`, {
      token,
    }),

  accept: (id: string, scheduledAt: string, meetingLink: string | undefined, token: string) =>
    apiFetch<Consultation>(`/api/v1/consultations/${id}/accept`, {
      method: 'POST',
      body: { scheduled_at: scheduledAt, meeting_link: meetingLink || undefined },
      token,
    }),

  decline: (id: string, reason: string, token: string) =>
    apiFetch<Consultation>(`/api/v1/consultations/${id}/decline`, {
      method: 'POST',
      body: { reason },
      token,
    }),

  cancel: (id: string, reason: string, token: string) =>
    apiFetch<Consultation>(`/api/v1/consultations/${id}/cancel`, {
      method: 'POST',
      body: { reason },
      token,
    }),

  complete: (id: string, advocateNotes: string | undefined, token: string) =>
    apiFetch<Consultation>(`/api/v1/consultations/${id}/complete`, {
      method: 'POST',
      body: { advocate_notes: advocateNotes || undefined },
      token,
    }),

  close: (id: string, token: string) =>
    apiFetch<Consultation>(`/api/v1/consultations/${id}/close`, { method: 'POST', token }),
};
