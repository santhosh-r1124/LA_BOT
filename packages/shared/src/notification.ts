/** In-app notifications (Phase 11). Mirrors `app/schemas/notification.py`. */

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** Path within the recipient's app, e.g. "/consultations". */
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface PaginatedNotifications {
  items: AppNotification[];
  total: number;
  unread: number;
  limit: number;
  offset: number;
}
