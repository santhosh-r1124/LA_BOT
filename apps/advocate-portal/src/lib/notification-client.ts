import type { AppNotification, PaginatedNotifications } from '@legal-platform/shared';
import { apiFetch } from './api-client';

/** Bindings for `/api/v1/notifications/*` (Phase 11). */
export const notificationClient = {
  list: (token: string, offset = 0) =>
    apiFetch<PaginatedNotifications>(`/api/v1/notifications?limit=20&offset=${offset}`, {
      token,
    }),

  unreadCount: (token: string) =>
    apiFetch<{ unread: number }>('/api/v1/notifications/unread-count', { token }),

  markRead: (id: string, token: string) =>
    apiFetch<AppNotification>(`/api/v1/notifications/${id}/read`, { method: 'POST', token }),

  markAllRead: (token: string) =>
    apiFetch<null>('/api/v1/notifications/read-all', { method: 'POST', token }),
};
