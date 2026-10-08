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
  /** Synthetic demo listing (e.g. the bundled advocates.csv), not a real advocate. */
  is_sample: boolean;
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
  page: number;
  page_size: number;
}

/** Query parameters of `GET /api/v1/advocates`. Codes are case-sensitive. */
export interface AdvocateSearchFilters {
  /** Category code (CYBER_LAW) or name (Cyber Law). */
  practice_area?: string;
  /** Upper-case state code, e.g. TN. */
  state?: string;
  /** Substring match, case-insensitive. */
  city?: string;
  /** Lower-case language code, e.g. ta. */
  language_code?: string;
  min_experience_years?: number;
  max_consultation_fee?: string;
  page?: number;
  page_size?: number;
}

/** Mirrors `FacetValue` / `AdvocateFacets` (apps/api/app/schemas/advocate.py). */
export interface FacetValue {
  code: string;
  label: string;
  count: number;
}

export interface AdvocateFacets {
  total: number;
  sample_count: number;
  practice_areas: FacetValue[];
  states: FacetValue[];
  languages: FacetValue[];
  cities: FacetValue[];
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

  /** Filter values present in the directory, with counts. */
  facets: () => apiFetch<AdvocateFacets>('/api/v1/advocates/facets'),

  get: (advocateId: string) => apiFetch<AdvocateDirectoryEntry>(`/api/v1/advocates/${advocateId}`),

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
      throw new ApiRequestError(
        response.status,
        'http_error',
        `Upload failed (${response.status}).`,
      );
    }
    return payload as AdvocateImportReport;
  },
};
