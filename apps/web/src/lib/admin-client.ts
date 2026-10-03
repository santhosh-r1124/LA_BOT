import type { AuthUser } from '@legal-platform/auth';
import type { AdvocateProfile, Payment } from '@legal-platform/shared';
import { apiFetch } from './api-client';

/** Bindings for the admin & legal-ops API (Phase 12). ADMIN / LEGAL_ADMIN only. */

export const ADMIN_ROLES: ReadonlySet<string> = new Set(['ADMIN', 'LEGAL_ADMIN']);

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Mirrors `app/schemas/admin.py::AdminAdvocateOut`. */
export interface AdminAdvocate extends AdvocateProfile {
  email: string;
  display_name: string | null;
}

/** Mirrors `app/schemas/admin.py::AdminOverview`. */
export interface AdminOverview {
  users_by_role: Record<string, number>;
  advocates_awaiting_verification: number;
  consultations_by_status: Record<string, number>;
  payments_by_status: Record<string, number>;
  legal_documents_by_status: Record<string, number>;
  catalog_by_status: Record<string, number>;
  risk_review_pending: number;
}

/** Mirrors `app/schemas/admin.py::RiskReviewItem`. */
export interface RiskReviewItem {
  id: string;
  conversation_id: string;
  content: string;
  legal_category: string | null;
  jurisdiction_scope: string | null;
  risk_level: string | null;
  is_anonymous: boolean;
  assistant_reply: string | null;
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

/** Mirrors `app/schemas/legal_source.py::LegalDocumentOut`. */
export interface LegalDocument {
  id: string;
  title: string;
  law_name: string | null;
  jurisdiction: string;
  state_code: string | null;
  source_url: string;
  document_type: string;
  ingestion_status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  ingestion_error: string | null;
  chunk_count: number;
  created_at: string;
}

/** Mirrors `app/schemas/legal_source_catalog.py::CatalogEntryOut`. */
export interface CatalogEntry {
  id: string;
  provider: string;
  title: string;
  law_name: string | null;
  source_url: string;
  document_type: string;
  jurisdiction: string;
  state_code: string | null;
  status: 'NEW' | 'INGESTED' | 'INVALID' | 'SKIPPED';
  ingested_document_id: string | null;
  notes: string | null;
  last_seen_at: string;
}

export interface ProviderRunResult {
  provider: string;
  discovered: number;
  upserted: number;
  error: string | null;
}

/** Mirrors `app/schemas/admin.py::AuditEventOut`. */
export interface AuditEvent {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export const DISCOVERY_PROVIDERS = ['curated', 'india_code_oai', 'hf_dataset'] as const;

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

// Ingestion fetches + embeds documents synchronously; a single source can
// take a minute on the free embedding tier, a batch several.
const INGEST_TIMEOUT_MS = 600_000;

export const adminClient = {
  overview: (token: string) => apiFetch<AdminOverview>('/api/v1/admin/overview', { token }),

  // ---- Users ------------------------------------------------------------
  users: (token: string, params: { role?: string; offset?: number } = {}) =>
    apiFetch<Paginated<AuthUser>>(`/api/v1/admin/users${qs({ ...params, limit: 25 })}`, {
      token,
    }),
  setUserActive: (token: string, userId: string, isActive: boolean) =>
    apiFetch<AuthUser>(`/api/v1/admin/users/${userId}`, {
      method: 'PATCH',
      body: { is_active: isActive },
      token,
    }),

  // ---- Advocate verification -------------------------------------------
  pendingAdvocates: (token: string, offset = 0) =>
    apiFetch<Paginated<AdminAdvocate>>(`/api/v1/admin/advocates/pending${qs({ offset })}`, {
      token,
    }),
  verifyAdvocate: (token: string, profileId: string, note?: string) =>
    apiFetch<AdvocateProfile>(`/api/v1/admin/advocates/${profileId}/verify`, {
      method: 'POST',
      body: { note: note || null },
      token,
    }),
  rejectAdvocate: (token: string, profileId: string, note: string) =>
    apiFetch<AdvocateProfile>(`/api/v1/admin/advocates/${profileId}/reject`, {
      method: 'POST',
      body: { note },
      token,
    }),

  // ---- Knowledge base -----------------------------------------------------
  documents: (token: string, params: { status?: string; offset?: number } = {}) =>
    apiFetch<Paginated<LegalDocument>>(
      `/api/v1/admin/legal-sources${qs({ ...params, limit: 25 })}`,
      {
        token,
      },
    ),
  reindexDocument: (token: string, id: string) =>
    apiFetch<LegalDocument>(`/api/v1/admin/legal-sources/${id}/reindex`, {
      method: 'POST',
      token,
      timeoutMs: INGEST_TIMEOUT_MS,
    }),
  deleteDocument: (token: string, id: string) =>
    apiFetch<null>(`/api/v1/admin/legal-sources/${id}`, { method: 'DELETE', token }),
  discover: (token: string, providers: string[]) =>
    apiFetch<{ results: ProviderRunResult[] }>(
      `/api/v1/admin/legal-sources/discover?${providers.map((p) => `providers=${encodeURIComponent(p)}`).join('&')}`,
      { method: 'POST', token, timeoutMs: INGEST_TIMEOUT_MS },
    ),
  catalog: (
    token: string,
    params: { status?: string; provider?: string; state_code?: string; offset?: number } = {},
  ) =>
    apiFetch<Paginated<CatalogEntry>>(
      `/api/v1/admin/legal-sources/catalog${qs({ ...params, limit: 25 })}`,
      { token },
    ),
  ingestCatalogEntry: (token: string, id: string) =>
    apiFetch<CatalogEntry>(`/api/v1/admin/legal-sources/catalog/${id}/ingest`, {
      method: 'POST',
      token,
      timeoutMs: INGEST_TIMEOUT_MS,
    }),
  ingestCatalogBatch: (
    token: string,
    params: { provider?: string; state_code?: string; limit: number },
  ) =>
    apiFetch<{ attempted: number; completed: number; failed: number }>(
      `/api/v1/admin/legal-sources/catalog/ingest-all${qs(params)}`,
      { method: 'POST', token, timeoutMs: INGEST_TIMEOUT_MS },
    ),

  // ---- Payments ---------------------------------------------------------
  payments: (token: string, params: { status?: string; offset?: number } = {}) =>
    apiFetch<Paginated<Payment>>(`/api/v1/admin/payments${qs({ ...params, limit: 25 })}`, {
      token,
    }),
  refund: (token: string, paymentId: string, amount?: string) =>
    apiFetch<{ refund_id: string; amount_minor: number; status: string }>(
      `/api/v1/admin/payments/${paymentId}/refund`,
      { method: 'POST', body: { amount: amount || null }, token },
    ),

  // ---- High-risk query review --------------------------------------------
  riskQueue: (token: string, params: { reviewed?: boolean; offset?: number } = {}) =>
    apiFetch<Paginated<RiskReviewItem>>(
      `/api/v1/admin/risk-review${qs({ ...params, limit: 25 })}`,
      {
        token,
      },
    ),
  markReviewed: (token: string, messageId: string, note?: string) =>
    apiFetch<RiskReviewItem>(`/api/v1/admin/risk-review/${messageId}/review`, {
      method: 'POST',
      body: { note: note || null },
      token,
    }),

  // ---- Audit log --------------------------------------------------------
  audit: (token: string, params: { action?: string; offset?: number } = {}) =>
    apiFetch<Paginated<AuditEvent>>(`/api/v1/admin/audit${qs({ ...params, limit: 50 })}`, {
      token,
    }),
};
