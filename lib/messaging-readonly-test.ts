import { supabase } from '@/lib/supabase';
import { isMessagingReadOnlyTestEnabled, messagingReadOnlyTestCapability } from '@/lib/messaging-readonly-test-feature';

type RpcError = { code?: unknown; status?: unknown };
type InboxRow = { gym_id?: unknown };

export type ReadOnlyInboxCheck = {
  kind: 'family-inbox' | 'staff-inbox';
  status: 'success' | 'denied' | 'inconclusive' | 'error';
  rowCount: number;
  scopeMatches: boolean | null;
  errorCode: string | null;
  summary: string;
};

function requireTestHarnessEnabled() {
  if (!isMessagingReadOnlyTestEnabled()) {
    throw new Error(messagingReadOnlyTestCapability.reason);
  }
}

function isAuthorizationError(error: RpcError) {
  return error.code === '42501' || error.status === 401 || error.status === 403;
}

function toRows(data: unknown): InboxRow[] {
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== 'object')) {
    throw new Error('The inbox RPC returned an invalid result.');
  }
  return data as InboxRow[];
}

function safeErrorCode(error: RpcError) {
  return typeof error.code === 'string' ? error.code : null;
}

/**
 * Development-only diagnostic. It calls only the read-only family inbox RPC
 * and returns aggregate results; raw rows are intentionally never exposed.
 */
export async function checkReadOnlyFamilyInbox(approvedGymIds: number[]): Promise<ReadOnlyInboxCheck> {
  requireTestHarnessEnabled();
  const { data, error } = await supabase.rpc('family_staff_list_family_conversations');
  if (error) {
    const rpcError = error as RpcError;
    return {
      kind: 'family-inbox',
      status: isAuthorizationError(rpcError) ? 'denied' : 'error',
      rowCount: 0,
      scopeMatches: null,
      errorCode: safeErrorCode(rpcError),
      summary: isAuthorizationError(rpcError) ? 'The server denied the family inbox request.' : 'The family inbox request did not complete.',
    };
  }

  const rows = toRows(data);
  const approvedGymIdSet = new Set(approvedGymIds);
  const scopeMatches = rows.every((row) => Number.isSafeInteger(Number(row.gym_id)) && approvedGymIdSet.has(Number(row.gym_id)));
  return {
    kind: 'family-inbox',
    status: scopeMatches ? 'success' : 'error',
    rowCount: rows.length,
    scopeMatches,
    errorCode: null,
    summary: !scopeMatches
      ? 'The family inbox returned a conversation outside the account’s approved gym scope.'
      : rows.length === 0
        ? 'The request succeeded with no conversations. Family isolation remains inconclusive until conversations exist.'
        : 'The request succeeded and every returned conversation matched an approved gym.',
  };
}

/**
 * Development-only diagnostic. It calls only the read-only staff inbox RPC.
 * An empty result is deliberately inconclusive because this RPC may hide an
 * unauthorized scope by returning no rows.
 */
export async function checkReadOnlyStaffInbox(gymId: number): Promise<ReadOnlyInboxCheck> {
  requireTestHarnessEnabled();
  if (!Number.isSafeInteger(gymId) || gymId <= 0) throw new Error('A valid gym ID is required for the staff inbox check.');

  const { data, error } = await supabase.rpc('family_staff_list_staff_conversations', { p_gym_id: gymId });
  if (error) {
    const rpcError = error as RpcError;
    return {
      kind: 'staff-inbox',
      status: isAuthorizationError(rpcError) ? 'denied' : 'error',
      rowCount: 0,
      scopeMatches: null,
      errorCode: safeErrorCode(rpcError),
      summary: isAuthorizationError(rpcError) ? 'The server denied the staff inbox request.' : 'The staff inbox request did not complete.',
    };
  }

  const rows = toRows(data);
  const scopeMatches = rows.every((row) => Number(row.gym_id) === gymId);
  return {
    kind: 'staff-inbox',
    status: rows.length === 0 ? 'inconclusive' : scopeMatches ? 'success' : 'error',
    rowCount: rows.length,
    scopeMatches,
    errorCode: null,
    summary: !scopeMatches
      ? 'The staff inbox returned a conversation outside the requested gym scope.'
      : rows.length === 0
        ? 'No rows were returned. This does not distinguish an empty inbox from server-side access filtering.'
        : 'The request succeeded and every returned conversation matched the requested gym.',
  };
}
