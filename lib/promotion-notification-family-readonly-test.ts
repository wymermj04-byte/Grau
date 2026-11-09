import { supabase } from '@/lib/supabase';
import {
  isPromotionNotificationFamilyReadOnlyTestEnabled,
  promotionNotificationFamilyReadOnlyTestCapability,
} from '@/lib/promotion-notification-family-readonly-test-feature';

type RpcError = { code?: unknown; message?: unknown; status?: unknown };

type NotificationRow = {
  notification_id?: unknown;
  student_id?: unknown;
  event_kind?: unknown;
  created_at?: unknown;
  read_at?: unknown;
};

export type FamilyNotificationInboxTestItem = {
  notificationId: number;
  studentId: number;
  eventKind: string;
  createdAt: string;
  readAt: string | null;
};

export type FamilyNotificationInboxTestResult = {
  status: 'success' | 'rollout-disabled' | 'authorization-denied' | 'error';
  items: FamilyNotificationInboxTestItem[];
  errorCode: string | null;
  summary: string;
};

type FamilyNotificationInboxTestScope = {
  userId: string;
  gymId: number;
};

function requireEnabled() {
  if (!isPromotionNotificationFamilyReadOnlyTestEnabled()) {
    throw new Error(promotionNotificationFamilyReadOnlyTestCapability.reason);
  }
}

function asPositiveInteger(value: unknown, label: string) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`The notification inbox returned an invalid ${label}.`);
  }
  return numeric;
}

function asTimestamp(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) {
    throw new Error(`The notification inbox returned an invalid ${label}.`);
  }
  return value;
}

function toItems(data: unknown): FamilyNotificationInboxTestItem[] {
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) throw new Error('The notification inbox returned an invalid response.');

  return data.map((row) => {
    if (!row || typeof row !== 'object') throw new Error('The notification inbox returned an invalid response.');
    const notification = row as NotificationRow;
    if (typeof notification.event_kind !== 'string' || !notification.event_kind.trim()) {
      throw new Error('The notification inbox returned an invalid event type.');
    }

    return {
      notificationId: asPositiveInteger(notification.notification_id, 'notification ID'),
      studentId: asPositiveInteger(notification.student_id, 'student ID'),
      eventKind: notification.event_kind,
      createdAt: asTimestamp(notification.created_at, 'creation time'),
      readAt: notification.read_at === null || notification.read_at === undefined
        ? null
        : asTimestamp(notification.read_at, 'read time'),
    };
  });
}

function safeErrorCode(error: RpcError) {
  return typeof error.code === 'string' ? error.code : null;
}

function isRolloutDisabledError(error: RpcError) {
  return error.code === '42501'
    && error.message === 'Promotion notifications are not enabled for this gym.';
}

function isAuthorizationError(error: RpcError) {
  return error.code === '42501' || error.status === 401 || error.status === 403;
}

/**
 * Development-only diagnostic. It accepts no student, user, gym, or rollout
 * parameters and calls only the family-scoped public inbox RPC. Server RLS and
 * the RPC's own Gym 4 rollout guard remain authoritative.
 */
export async function checkFamilyPromotionNotificationInbox(
  scope: FamilyNotificationInboxTestScope,
): Promise<FamilyNotificationInboxTestResult> {
  requireEnabled();
  if (scope.gymId !== promotionNotificationFamilyReadOnlyTestCapability.gymId) {
    throw new Error('This diagnostic is limited to the approved Gym 4 family scope.');
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session || sessionData.session.user.id !== scope.userId) {
    throw new Error('Your authenticated account changed. Resolve family access again before checking the inbox.');
  }

  const { data, error } = await supabase.rpc('family_promotion_notification_inbox', { p_limit: 50 });
  if (error) {
    const rpcError = error as RpcError;
    if (isRolloutDisabledError(rpcError)) {
      return {
        status: 'rollout-disabled',
        items: [],
        errorCode: safeErrorCode(rpcError),
        summary: 'The server confirmed that Gym 4 promotion notifications are disabled. No notification records were returned.',
      };
    }
    if (isAuthorizationError(rpcError)) {
      return {
        status: 'authorization-denied',
        items: [],
        errorCode: safeErrorCode(rpcError),
        summary: 'The server denied this family inbox request.',
      };
    }
    return {
      status: 'error',
      items: [],
      errorCode: safeErrorCode(rpcError),
      summary: 'The family notification inbox request did not complete.',
    };
  }

  const items = toItems(data);
  return {
    status: 'success',
    items,
    errorCode: null,
    summary: items.length === 0
      ? 'The server returned an empty family notification inbox.'
      : `The server returned ${items.length} family notification ${items.length === 1 ? 'record' : 'records'}.`,
  };
}
