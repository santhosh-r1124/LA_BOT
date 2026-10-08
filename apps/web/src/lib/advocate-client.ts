import { apiFetch, ApiRequestError } from './api-client';
import { env } from './env';
import { isApiError } from '@legal-platform/shared';

export interface AdvocateDirectoryEntry {
  id: string;
  display_name: string | null;
  practice_areas: string[];
  state_code: string;
  city: string;
  languages: string[];
  /** Decimal, serialised as a string by Pydantic (e.g. "1500.00"). */
  consultation_fee: string | null;
  bio: string | null;
  experience_years: number | null;
  availability: Record<string, unknown> | null;
  email: string | null;
  phone: string | null;
}

/** Mirrors `AdvocateImportReport` (apps/api/app/schemas/admin.py). */
export interface AdvocateImportReport {
  total_rows: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  dry_run: boolean;
  errors: Array<{ line: number; message: string }>;
}

export interface PaginatedAdvocateDirectory {
  items: AdvocateDirectoryEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdvocateSearchFilters {
  practice_area?: string;
  state_code?: string;
  city?: string;
  language?: string;
  min_experience_years?: number;
  max_consultation_fee?: string;
  limit?: number;
  offset?: number;
}

function toQueryString(filters: AdvocateSearchFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Bindings for `/api/v1/advocates/*` (public, Phase 7 discovery slice). */
export const advocateClient = {
  search: (filters: AdvocateSearchFilters = {}) =>
    apiFetch<PaginatedAdvocateDirectory>(`/api/v1/advocates${toQueryString(filters)}`),

  get: (advocateId: string) =>
    apiFetch<AdvocateDirectoryEntry>(`/api/v1/advocates/${advocateId}`),

  /** Admin-only CSV upload (multipart, so not via apiFetch's JSON body). */
  async importCsv(file: File, token: string, dryRun: boolean): Promise<AdvocateImportReport> {
    const form = new FormData();
    form.append('file', file);
    let response: Response;
    try {
      response = await fetch(
        `${env.NEXT_PUBLIC_API_BASE_URL}/api/v1/admin/advocates/import?dry_run=${dryRun}`,
        { method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` } },
      );
    } catch {
      throw new ApiRequestError(0, 'network_error', 'Could not reach the API.');
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (isApiError(payload)) {
        throw new ApiRequestError(response.status, payload.error.code, payload.error.message);
      }
      throw new ApiRequestError(response.status, 'http_error', `Upload failed (${response.status}).`);
    }
    return payload as AdvocateImportReport;
  },
};
