import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MessagingAccessRole } from '@/lib/messaging';

const STORAGE_PREFIX = 'grau.messaging-draft.v2:';
const MAX_DRAFT_LENGTH = 4000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MessagingDraftScope = {
  userId: string;
  role: MessagingAccessRole;
  gymId: number;
  conversationId: number;
};

export type MessagingPendingAttempt = {
  body: string;
  retryKey: string;
  status: 'unknown' | 'sent_cleanup_required';
};

export type PersistedMessagingDraft = {
  draftBody: string;
  retryKey: string | null;
  pendingAttempt: MessagingPendingAttempt | null;
};

export type MessagingDraftStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'>;
export type CurrentMessagingScope = {
  userId: string | null;
  role: MessagingAccessRole | null;
  staffGymId: number | null;
  familyGymIds: number[];
};

const EMPTY_DRAFT: PersistedMessagingDraft = { draftBody: '', retryKey: null, pendingAttempt: null };

function validScope(scope: MessagingDraftScope) {
  return typeof scope.userId === 'string' && scope.userId.trim().length > 0
    && (scope.role === 'family' || scope.role === 'staff')
    && Number.isSafeInteger(scope.gymId) && scope.gymId > 0
    && Number.isSafeInteger(scope.conversationId) && scope.conversationId > 0;
}

function validBody(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_DRAFT_LENGTH;
}

function validRetryKey(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validPendingAttempt(value: unknown): MessagingPendingAttempt | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const body = record.body;
  const retryKey = record.retryKey;
  if (!validBody(body) || !body.trim() || !validRetryKey(retryKey)) return null;
  if (record.status !== 'unknown' && record.status !== 'sent_cleanup_required') return null;
  return { body, retryKey, status: record.status };
}

function validDraft(value: unknown): PersistedMessagingDraft | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  // Read the former one-record shape once so an update never silently discards
  // an in-progress retry from an earlier client build.
  if ('body' in record && !('draftBody' in record)) {
    if (!validBody(record.body) || (record.retryKey !== null && !validRetryKey(record.retryKey))) return null;
    return { draftBody: record.body as string, retryKey: record.retryKey as string | null, pendingAttempt: null };
  }

  if (!validBody(record.draftBody) || (record.retryKey !== null && !validRetryKey(record.retryKey))) return null;
  const pendingAttempt = record.pendingAttempt === null || record.pendingAttempt === undefined
    ? null
    : validPendingAttempt(record.pendingAttempt);
  if (record.pendingAttempt !== null && record.pendingAttempt !== undefined && !pendingAttempt) return null;
  return { draftBody: record.draftBody as string, retryKey: record.retryKey as string | null, pendingAttempt };
}

export function messagingDraftScopeKey(scope: MessagingDraftScope) {
  if (!validScope(scope)) throw new Error('Messaging draft scope is invalid.');
  return `${scope.userId}:${scope.role}:${scope.gymId}:${scope.conversationId}`;
}

/** Verifies the active account and access context immediately before an RPC. */
export function isCurrentMessagingScope(scope: MessagingDraftScope, current: CurrentMessagingScope) {
  if (current.userId !== scope.userId || current.role !== scope.role) return false;
  return scope.role === 'staff'
    ? current.staffGymId === scope.gymId
    : current.familyGymIds.includes(scope.gymId);
}

/** Synchronous lock used by the composer before React state has a chance to render. */
export function createMessagingSendLock() {
  let inFlight = false;
  return {
    tryAcquire() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    release() { inFlight = false; },
    get isInFlight() { return inFlight; },
  };
}

/** A preserved unknown or cleanup-required attempt must be reconciled before another send. */
export function canSendPersistedMessagingDraft(draft: PersistedMessagingDraft) {
  return !draft.pendingAttempt && Boolean(draft.draftBody.trim());
}

function storageKey(scope: MessagingDraftScope) {
  return `${STORAGE_PREFIX}${encodeURIComponent(messagingDraftScopeKey(scope))}`;
}

function hasStoredState(draft: PersistedMessagingDraft) {
  return Boolean(draft.draftBody || draft.retryKey || draft.pendingAttempt);
}

export function createMessagingDraftStore(storage: MessagingDraftStorage) {
  const queues = new Map<string, Promise<void>>();

  function enqueue<T>(scope: MessagingDraftScope, operation: () => Promise<T>) {
    const key = storageKey(scope);
    const previous = queues.get(key) ?? Promise.resolve();
    const task = previous.then(operation, operation);
    queues.set(key, task.then(() => undefined, () => undefined));
    return task;
  }

  async function load(scope: MessagingDraftScope): Promise<PersistedMessagingDraft | null> {
    return enqueue(scope, async () => {
      const raw = await storage.getItem(storageKey(scope));
      if (!raw) return null;
      try {
        return validDraft(JSON.parse(raw));
      } catch {
        return null;
      }
    });
  }

  async function save(scope: MessagingDraftScope, draft: PersistedMessagingDraft): Promise<void> {
    const safeDraft = validDraft(draft);
    if (!safeDraft) throw new Error('Messaging draft content is invalid.');
    await enqueue(scope, async () => {
      if (!hasStoredState(safeDraft)) {
        await storage.removeItem(storageKey(scope));
        return;
      }
      await storage.setItem(storageKey(scope), JSON.stringify(safeDraft));
    });
  }

  async function clear(scope: MessagingDraftScope): Promise<void> {
    await enqueue(scope, async () => {
      await storage.removeItem(storageKey(scope));
    });
  }

  return { load, save, clear };
}

const defaultStore = createMessagingDraftStore(AsyncStorage);

/** Local-only draft state is scoped to one authenticated account, role, gym, and conversation. */
export function loadMessagingDraft(scope: MessagingDraftScope) {
  return defaultStore.load(scope);
}

export function saveMessagingDraft(scope: MessagingDraftScope, draft: PersistedMessagingDraft) {
  return defaultStore.save(scope, draft);
}

export function clearMessagingDraft(scope: MessagingDraftScope) {
  return defaultStore.clear(scope);
}

export { EMPTY_DRAFT };
