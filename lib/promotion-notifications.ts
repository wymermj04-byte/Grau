import { supabase } from '@/lib/supabase';
import {
  isPromotionNotificationsEnabled,
  promotionNotificationsCapability,
} from '@/lib/promotion-notifications-feature';

export type PromotionNotificationAudience = 'family' | 'staff';
export type PromotionNotificationEventKind = 'promotion_celebration' | 'five_remaining' | 'eligible_for_review';

export type PromotionNotification = {
  id: number;
  studentId: number;
  eventKind: PromotionNotificationEventKind;
  createdAt: string;
  readAt: string | null;
};

type NotificationRow = {
  notification_id: number | string;
  student_id: number | string;
  event_kind: unknown;
  created_at: unknown;
  read_at: unknown;
};

type RpcError = { code?: unknown; message?: unknown };

export class PromotionNotificationsUnavailableError extends Error {
  constructor() {
    super(promotionNotificationsCapability.reason);
    this.name = 'PromotionNotificationsUnavailableError';
  }
}

export class PromotionNotificationsContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromotionNotificationsContractError';
  }
}

export class PromotionNotificationsApiError extends Error {
  readonly code: string | null;

  constructor(operation: string, error: RpcError) {
    super(
      typeof error.message === 'string' && error.message.trim()
        ? error.message.trim()
        : `${operation} could not be completed.`,
    );
    this.name = 'PromotionNotificationsApiError';
    this.code = typeof error.code === 'string' ? error.code : null;
  }
}

function requireEnabled() {
  if (!isPromotionNotificationsEnabled()) {
    throw new PromotionNotificationsUnavailableError();
  }
}

function positiveInteger(value: unknown, label: string) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new PromotionNotificationsContractError(`Promotion notifications returned an invalid ${label}.`);
  }
  return numeric;
}

function timestamp(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) {
    throw new PromotionNotificationsContractError(`Promotion notifications returned an invalid ${label}.`);
  }
  return value;
}

function nullableTimestamp(value: unknown, label: string) {
  return value === null || value === undefined ? null : timestamp(value, label);
}

function toNotification(row: NotificationRow): PromotionNotification {
  if (
    row.event_kind !== 'promotion_celebration'
    && row.event_kind !== 'five_remaining'
    && row.event_kind !== 'eligible_for_review'
  ) {
    throw new PromotionNotificationsContractError('Promotion notifications returned an unsupported event type.');
  }

  return {
    id: positiveInteger(row.notification_id, 'notification ID'),
    studentId: positiveInteger(row.student_id, 'student ID'),
    eventKind: row.event_kind,
    createdAt: timestamp(row.created_at, 'creation time'),
    readAt: nullableTimestamp(row.read_at, 'read time'),
  };
}

function normalizeRows(data: unknown, operation: string) {
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== 'object')) {
    throw new PromotionNotificationsContractError(`${operation} returned an invalid response.`);
  }
  return (data as NotificationRow[]).map(toNotification);
}

function assertLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new PromotionNotificationsContractError('Notification limit must be between 1 and 100.');
  }
  return limit;
}

function assertAudience(audience: PromotionNotificationAudience) {
  if (audience !== 'family' && audience !== 'staff') {
    throw new PromotionNotificationsContractError('Promotion notification access is unavailable.');
  }
  return audience;
}

export async function listPromotionNotifications(
  audience: PromotionNotificationAudience,
  limit = 50,
): Promise<PromotionNotification[]> {
  requireEnabled();
  const resolvedAudience = assertAudience(audience);
  const operation = 'Loading promotion notifications';
  const { data, error } = await supabase.rpc(
    resolvedAudience === 'family'
      ? 'family_promotion_notification_inbox'
      : 'staff_promotion_notification_inbox',
    { p_limit: assertLimit(limit) },
  );

  if (error) throw new PromotionNotificationsApiError(operation, error);
  return normalizeRows(data, operation);
}

export async function markPromotionNotificationRead(
  audience: PromotionNotificationAudience,
  notificationId: number,
): Promise<void> {
  requireEnabled();
  const resolvedAudience = assertAudience(audience);
  const { error } = await supabase.rpc(
    resolvedAudience === 'family'
      ? 'mark_family_promotion_notification_read'
      : 'mark_staff_promotion_notification_read',
    { p_notification_id: positiveInteger(notificationId, 'notification ID') },
  );

  if (error) throw new PromotionNotificationsApiError('Marking notification as read', error);
}
