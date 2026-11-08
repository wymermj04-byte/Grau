import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMessagingIdempotencyKey, MessagingApiError, MessagingContractError, type MessagingAccessRole } from '@/lib/messaging';
import { isMessagingControlledAcknowledgementRecoveryEnabled, isMessagingControlledCompletionEnabled, isMessagingControlledTestEnabled, messagingControlledAcknowledgementRecoveryCapability, messagingControlledCompletionCapability, messagingControlledTestCapability } from '@/lib/messaging-controlled-test-feature';
import { supabase } from '@/lib/supabase';

const STORAGE_PREFIX = 'grau.messaging-controlled-test.v1.';
const MAX_PAGE_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GYM4_ACKNOWLEDGEMENT_RECOVERY_RUN = {
  runId: '57ff4ff3-b2bb-4290-be29-e3bf1c3ce596',
  gymId: 4,
  conversationId: 1,
  familyMessageId: 1,
  staffMessageId: 2,
} as const;

const GYM4_POST_ACKNOWLEDGEMENT_COMPLETION_RUN = {
  runId: '57ff4ff3-b2bb-4290-be29-e3bf1c3ce596',
  gymId: 4,
  conversationId: 1,
  familyMessageId: 1,
  staffMessageId: 2,
  recoveredThroughMessageId: 2,
} as const;

export type ControlledTestStep =
  | 'family-inbox'
  | 'attach-verified-empty-conversation'
  | 'create-conversation'
  | 'family-send'
  | 'family-retry'
  | 'staff-inbox'
  | 'staff-send'
  | 'staff-retry'
  | 'history'
  | 'unread-page'
  | 'acknowledgement-recovery'
  | 'post-acknowledgement-completion'
  | 'acknowledge'
  | 'role-denial';

export type ControlledTestMessage = {
  body: string;
  idempotencyKey: string;
  messageId: number | null;
  createdAt: string | null;
  pending: boolean;
};

export type ControlledReadCursor = {
  role: MessagingAccessRole;
  cursorId: string;
  throughMessageId: number;
};

/** Aggregate-only family inbox evidence retained across screen restores. */
export type ControlledFamilyInboxDiagnostic = {
  resolvedAccessRole: 'family';
  conversationId: number;
  conversationFound: boolean;
  unreadCount: number | null;
  expected: 'positive' | 'zero';
  expectedZeroUnreadPassed: boolean | null;
  assertionPassed: boolean;
  recordedAt: string;
};

/** Present only after the separately gated read-only completion check passes. */
export type ControlledPostAcknowledgementCompletion = {
  verifiedAt: string;
  conversationId: number;
  unreadCount: 0;
};

export type ControlledMessagingTestRun = {
  version: 1;
  runId: string;
  gymId: number;
  createdAt: string;
  conversationId: number | null;
  halted: boolean;
  attachedVerifiedEmptyConversation: boolean;
  familyInboxChecked: boolean;
  staffInboxChecked: boolean;
  familyMessage: ControlledTestMessage;
  staffMessage: ControlledTestMessage;
  /** Original server-issued cursor retained for diagnostics. */
  lastReadCursor: ControlledReadCursor | null;
  /** A future confirmed recovery may add a fresh cursor without replacing the original. */
  recoveryReadCursor: ControlledReadCursor | null;
  /** Recent aggregate-only family inbox checks, never message content or labels. */
  familyInboxDiagnostics: ControlledFamilyInboxDiagnostic[];
  /** Limits a resumed reviewed run to the final opposite-role denial check. */
  postAcknowledgementCompletion: ControlledPostAcknowledgementCompletion | null;
};

export type ControlledTestResult = {
  step: ControlledTestStep;
  status: 'passed' | 'stopped' | 'denied' | 'inconclusive' | 'failed';
  summary: string;
  conversationId: number | null;
  messageId: number | null;
  cursorId: string | null;
  errorCode: string | null;
  /** Safe, local-only scope retained for a controlled role-denial failure. */
  gymId?: number | null;
  /** A sanitized client or server error class, never a stack trace. */
  errorType?: string | null;
  /** Safe server or client failure detail; no message bodies or account data. */
  errorDetail?: string | null;
  /** Context retained for a failed acknowledgement without replacing its cursor. */
  accessRole?: MessagingAccessRole | null;
  throughMessageId?: number | null;
};

/** Safe, local-only explanation for the final controlled security-check gate. */
export type ControlledRoleDenialRecoveryEligibility = {
  eligible: boolean;
  halted: boolean;
  exactRun: boolean;
  exactConversation: boolean;
  exactMessages: boolean;
  noPendingMessages: boolean;
  originalFamilyCursor: boolean;
  recoveredFamilyEndpoint: boolean;
  zeroUnreadCompletion: boolean;
};

type RpcRow = Record<string, unknown>;
type RpcError = { code?: unknown; message?: unknown; status?: unknown };

function requireEnabled() {
  if (!isMessagingControlledTestEnabled()) {
    throw new MessagingContractError(messagingControlledTestCapability.reason);
  }
}

function requirePositiveInteger(value: unknown, name: string) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new MessagingContractError(`A valid ${name} is required.`);
  return parsed;
}

function requireUuid(value: unknown, name: string) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new MessagingContractError(`A valid ${name} is required.`);
  return value;
}

function nonNegativeSafeInteger(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function rows(data: unknown, operation: string): RpcRow[] {
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== 'object')) {
    throw new MessagingContractError(`${operation} returned an invalid response.`);
  }
  return data as RpcRow[];
}

function firstRow(data: unknown, operation: string): RpcRow {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new MessagingContractError(`${operation} did not return a record.`);
  return row as RpcRow;
}

function throwRpcError(operation: string, error: RpcError | null) {
  if (error) throw new MessagingApiError(operation, error);
}

function safeDiagnosticCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : null;
}

function safeDiagnosticErrorType(error: unknown) {
  const value = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : 'UnknownError';
}

function safeDiagnosticMessage(error: unknown) {
  if (!(error instanceof Error) || typeof error.message !== 'string') return 'An unexpected client or transport error occurred before a verified server response was available.';
  const sanitized = error.message
    .replace(/\b((?:authorization|access[_-]?token|refresh[_-]?token|token|api[_-]?key|apikey|password|secret)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi, '$1[redacted]')
    .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, '[redacted-token]')
    .replace(/([?&](?:access_token|refresh_token|token|api_key|apikey)=)[^&#\s]+/gi, '$1[redacted]')
    .trim()
    .slice(0, 240);
  return sanitized || 'An unexpected client or transport error occurred before a verified server response was available.';
}

function errorResult(
  step: ControlledTestStep,
  error: unknown,
  context?: Pick<ControlledTestResult, 'conversationId' | 'cursorId' | 'accessRole' | 'throughMessageId'>,
): ControlledTestResult {
  if (error instanceof MessagingApiError) {
    const denied = error.code === '42501' || error.status === 401 || error.status === 403;
    return {
      step,
      status: denied ? 'denied' : 'failed',
      summary: denied ? 'The server rejected this access attempt.' : 'The RPC did not complete. Stop and review before continuing.',
      conversationId: context?.conversationId ?? null,
      messageId: null,
      cursorId: context?.cursorId ?? null,
      errorCode: error.code,
      errorDetail: error.message,
      accessRole: context?.accessRole ?? null,
      throughMessageId: context?.throughMessageId ?? null,
    };
  }
  return {
    step,
    status: 'failed',
    summary: 'The test action did not complete. Stop and review before continuing.',
    conversationId: context?.conversationId ?? null,
    messageId: null,
    cursorId: context?.cursorId ?? null,
    errorCode: null,
    errorDetail: error instanceof Error ? error.message : null,
    accessRole: context?.accessRole ?? null,
    throughMessageId: context?.throughMessageId ?? null,
  };
}

function testBody(runId: string, sender: 'FAMILY' | 'ADMIN') {
  return `[GZ-P1-TEST-G4-${runId}] ${sender} TEST ${sender === 'FAMILY' ? 'MESSAGE' : 'REPLY'}`;
}

function storageKey(runId: string) {
  return `${STORAGE_PREFIX}${requireUuid(runId, 'test-run identifier')}`;
}

function familyInboxDiagnosticFromUnknown(value: unknown): ControlledFamilyInboxDiagnostic | null {
  if (!value || typeof value !== 'object') return null;
  const diagnostic = value as Partial<ControlledFamilyInboxDiagnostic>;
  const conversationId = nonNegativeSafeInteger(diagnostic.conversationId);
  const unreadCount = diagnostic.unreadCount === null ? null : nonNegativeSafeInteger(diagnostic.unreadCount);
  if (diagnostic.resolvedAccessRole !== 'family'
    || !conversationId || typeof diagnostic.conversationFound !== 'boolean'
    || (diagnostic.unreadCount !== null && unreadCount === null)
    || (diagnostic.expected !== 'positive' && diagnostic.expected !== 'zero')
    || (diagnostic.expectedZeroUnreadPassed !== null && typeof diagnostic.expectedZeroUnreadPassed !== 'boolean')
    || typeof diagnostic.assertionPassed !== 'boolean'
    || typeof diagnostic.recordedAt !== 'string') return null;
  return {
    resolvedAccessRole: 'family',
    conversationId,
    conversationFound: diagnostic.conversationFound,
    unreadCount,
    expected: diagnostic.expected,
    expectedZeroUnreadPassed: diagnostic.expectedZeroUnreadPassed,
    assertionPassed: diagnostic.assertionPassed,
    recordedAt: diagnostic.recordedAt,
  };
}

function recordFamilyInboxDiagnostic(
  run: ControlledMessagingTestRun,
  expected: ControlledFamilyInboxDiagnostic['expected'],
  conversationFound: boolean,
  unreadCount: number | null,
  assertionPassed: boolean,
) {
  const diagnostic: ControlledFamilyInboxDiagnostic = {
    resolvedAccessRole: 'family',
    conversationId: run.conversationId ?? 0,
    conversationFound,
    unreadCount,
    expected,
    expectedZeroUnreadPassed: expected === 'zero' ? assertionPassed : null,
    assertionPassed,
    recordedAt: new Date().toISOString(),
  };
  run.familyInboxDiagnostics = [diagnostic, ...run.familyInboxDiagnostics].slice(0, 8);
}

function matchingConversationRow(data: unknown, run: ControlledMessagingTestRun) {
  return rows(data, 'Checking the inbox unread count').find((row) => (
    nonNegativeSafeInteger(row.conversation_id) === run.conversationId
    && nonNegativeSafeInteger(row.gym_id) === run.gymId
  ));
}

function requireReadCursor(value: unknown, name: string): ControlledReadCursor {
  if (!value || typeof value !== 'object') throw new MessagingContractError(`A valid ${name} is required.`);
  const cursor = value as Partial<ControlledReadCursor>;
  if (cursor.role !== 'family' && cursor.role !== 'staff') throw new MessagingContractError(`A valid ${name} role is required.`);
  return {
    role: cursor.role,
    cursorId: requireUuid(cursor.cursorId, `${name} ID`),
    throughMessageId: requirePositiveInteger(cursor.throughMessageId, `${name} endpoint`),
  };
}

/** This recovery is deliberately limited to the one approved halted Gym 4 run. */
export function canRecoverHaltedFamilyAcknowledgement(run: ControlledMessagingTestRun) {
  if (!run.halted
    || run.runId !== GYM4_ACKNOWLEDGEMENT_RECOVERY_RUN.runId
    || run.gymId !== GYM4_ACKNOWLEDGEMENT_RECOVERY_RUN.gymId
    || run.conversationId !== GYM4_ACKNOWLEDGEMENT_RECOVERY_RUN.conversationId
    || run.familyMessage.messageId !== GYM4_ACKNOWLEDGEMENT_RECOVERY_RUN.familyMessageId
    || run.staffMessage.messageId !== GYM4_ACKNOWLEDGEMENT_RECOVERY_RUN.staffMessageId
    || run.familyMessage.pending
    || run.staffMessage.pending
    || run.recoveryReadCursor !== null) {
    return false;
  }
  try {
    return requireReadCursor(run.lastReadCursor, 'original read cursor').role === 'family';
  } catch {
    return false;
  }
}

/** This remains limited to the exact reviewed run and is disabled by default. */
export function canCompleteHaltedPostAcknowledgementVerification(run: ControlledMessagingTestRun) {
  if (!run.halted
    || run.runId !== GYM4_POST_ACKNOWLEDGEMENT_COMPLETION_RUN.runId
    || run.gymId !== GYM4_POST_ACKNOWLEDGEMENT_COMPLETION_RUN.gymId
    || run.conversationId !== GYM4_POST_ACKNOWLEDGEMENT_COMPLETION_RUN.conversationId
    || run.familyMessage.messageId !== GYM4_POST_ACKNOWLEDGEMENT_COMPLETION_RUN.familyMessageId
    || run.staffMessage.messageId !== GYM4_POST_ACKNOWLEDGEMENT_COMPLETION_RUN.staffMessageId
    || run.familyMessage.pending
    || run.staffMessage.pending
    || run.postAcknowledgementCompletion !== null) return false;
  try {
    const original = requireReadCursor(run.lastReadCursor, 'original read cursor');
    const recovered = requireReadCursor(run.recoveryReadCursor, 'recovered read cursor');
    return original.role === 'family'
      && recovered.role === 'family'
      && recovered.throughMessageId === GYM4_POST_ACKNOWLEDGEMENT_COMPLETION_RUN.recoveredThroughMessageId;
  } catch {
    return false;
  }
}

/**
 * A failed final denial check can be retried only for the exact reviewed run,
 * after its zero-unread completion has already succeeded. The retry remains a
 * read-only history call and cannot reopen any earlier test action.
 */
export function getHaltedControlledRoleDenialRecoveryEligibility(run: ControlledMessagingTestRun): ControlledRoleDenialRecoveryEligibility {
  const exactRun = run.runId === GYM4_POST_ACKNOWLEDGEMENT_COMPLETION_RUN.runId
    && run.gymId === GYM4_POST_ACKNOWLEDGEMENT_COMPLETION_RUN.gymId;
  const exactConversation = run.conversationId === GYM4_POST_ACKNOWLEDGEMENT_COMPLETION_RUN.conversationId;
  const exactMessages = run.familyMessage.messageId === GYM4_POST_ACKNOWLEDGEMENT_COMPLETION_RUN.familyMessageId
    && run.staffMessage.messageId === GYM4_POST_ACKNOWLEDGEMENT_COMPLETION_RUN.staffMessageId;
  const noPendingMessages = !run.familyMessage.pending && !run.staffMessage.pending;
  let originalFamilyCursor = false;
  let recoveredFamilyEndpoint = false;
  try {
    const original = requireReadCursor(run.lastReadCursor, 'original read cursor');
    originalFamilyCursor = original.role === 'family';
  } catch {
    // The original-cursor condition stays false for local diagnostic display.
  }
  try {
    const recovered = requireReadCursor(run.recoveryReadCursor, 'recovered read cursor');
    recoveredFamilyEndpoint = recovered.role === 'family'
      && recovered.throughMessageId === GYM4_POST_ACKNOWLEDGEMENT_COMPLETION_RUN.recoveredThroughMessageId;
  } catch {
    // The recovered-cursor condition stays false for local diagnostic display.
  }
  const completion = run.postAcknowledgementCompletion;
  const zeroUnreadCompletion = completion?.conversationId === run.conversationId
    && completion.unreadCount === 0;
  const eligible = run.halted
    && exactRun
    && exactConversation
    && exactMessages
    && noPendingMessages
    && originalFamilyCursor
    && recoveredFamilyEndpoint
    && zeroUnreadCompletion;
  return {
    eligible,
    halted: run.halted,
    exactRun,
    exactConversation,
    exactMessages,
    noPendingMessages,
    originalFamilyCursor,
    recoveredFamilyEndpoint,
    zeroUnreadCompletion,
  };
}

export function canRetryHaltedControlledRoleDenial(run: ControlledMessagingTestRun) {
  return getHaltedControlledRoleDenialRecoveryEligibility(run).eligible;
}

/**
 * A preflight checkpoint can be restored after an interrupted screen update.
 * This is intentionally narrower than a general resume: no conversation,
 * messages, pending sends, or read cursor may exist. The subsequent attach
 * operation still independently proves family ownership and empty history.
 */
export function canRecoverVerifiedEmptyControlledConversation(run: ControlledMessagingTestRun) {
  return run.conversationId === null
    && run.familyInboxChecked === true
    && run.familyMessage.messageId === null
    && run.staffMessage.messageId === null
    && run.familyMessage.pending === false
    && run.staffMessage.pending === false
    && run.lastReadCursor === null;
}

export function createControlledMessagingTestRun(gymId: number): ControlledMessagingTestRun {
  requireEnabled();
  const runId = createMessagingIdempotencyKey();
  return {
    version: 1,
    runId,
    gymId: requirePositiveInteger(gymId, 'gym ID'),
    createdAt: new Date().toISOString(),
    conversationId: null,
    halted: false,
    attachedVerifiedEmptyConversation: false,
    familyInboxChecked: false,
    staffInboxChecked: false,
    familyMessage: { body: testBody(runId, 'FAMILY'), idempotencyKey: createMessagingIdempotencyKey(), messageId: null, createdAt: null, pending: false },
    staffMessage: { body: testBody(runId, 'ADMIN'), idempotencyKey: createMessagingIdempotencyKey(), messageId: null, createdAt: null, pending: false },
    lastReadCursor: null,
    recoveryReadCursor: null,
    familyInboxDiagnostics: [],
    postAcknowledgementCompletion: null,
  };
}

export async function saveControlledMessagingTestRun(run: ControlledMessagingTestRun) {
  requireEnabled();
  await AsyncStorage.setItem(storageKey(run.runId), JSON.stringify(run));
}

export async function restoreControlledMessagingTestRun(runId: string): Promise<ControlledMessagingTestRun | null> {
  requireEnabled();
  const raw = await AsyncStorage.getItem(storageKey(runId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ControlledMessagingTestRun>;
    if (value.version !== 1 || value.runId !== runId || !value.familyMessage || !value.staffMessage) return null;
    requirePositiveInteger(value.gymId, 'gym ID');
    requireUuid(value.familyMessage.idempotencyKey, 'family retry key');
    requireUuid(value.staffMessage.idempotencyKey, 'staff retry key');
    if (value.lastReadCursor !== null && value.lastReadCursor !== undefined) requireReadCursor(value.lastReadCursor, 'original read cursor');
    if (value.recoveryReadCursor !== null && value.recoveryReadCursor !== undefined) requireReadCursor(value.recoveryReadCursor, 'recovery read cursor');
    const familyInboxDiagnostics = Array.isArray(value.familyInboxDiagnostics)
      ? value.familyInboxDiagnostics.map(familyInboxDiagnosticFromUnknown).filter((diagnostic): diagnostic is ControlledFamilyInboxDiagnostic => diagnostic !== null).slice(0, 8)
      : [];
    const completion = value.postAcknowledgementCompletion;
    const postAcknowledgementCompletion = completion && typeof completion === 'object'
      && requirePositiveInteger((completion as Partial<ControlledPostAcknowledgementCompletion>).conversationId, 'completion conversation ID') === 1
      && (completion as Partial<ControlledPostAcknowledgementCompletion>).unreadCount === 0
      && typeof (completion as Partial<ControlledPostAcknowledgementCompletion>).verifiedAt === 'string'
      ? completion as ControlledPostAcknowledgementCompletion
      : null;
    return {
      ...value,
      halted: value.halted === true,
      attachedVerifiedEmptyConversation: value.attachedVerifiedEmptyConversation === true,
      lastReadCursor: value.lastReadCursor ?? null,
      recoveryReadCursor: value.recoveryReadCursor ?? null,
      familyInboxDiagnostics,
      postAcknowledgementCompletion,
    } as ControlledMessagingTestRun;
  } catch {
    return null;
  }
}

/** Read-only gate: a Gym 4 conversation already present halts this controlled run. */
export async function checkControlledFamilyInbox(run: ControlledMessagingTestRun): Promise<ControlledTestResult> {
  requireEnabled();
  try {
    const { data, error } = await supabase.rpc('family_staff_list_family_conversations');
    throwRpcError('Checking the family inbox', error);
    const existing = rows(data, 'Checking the family inbox').filter((row) => Number(row.gym_id) === run.gymId);
    run.familyInboxChecked = true;
    await saveControlledMessagingTestRun(run);
    if (existing.length > 0) {
      return { step: 'family-inbox', status: 'stopped', summary: 'A conversation already exists for this Gym 4 family. This controlled run must stop without creating another conversation.', conversationId: null, messageId: null, cursorId: null, errorCode: null };
    }
    return { step: 'family-inbox', status: 'passed', summary: 'The authorized family inbox was checked and has no Gym 4 conversation to conflict with this run.', conversationId: null, messageId: null, cursorId: null, errorCode: null };
  } catch (error) {
    return errorResult('family-inbox', error);
  }
}

/**
 * Manual recovery for a halted run only. It relies entirely on family-scoped
 * RPCs before retaining an already-existing, verified empty conversation.
 */
export async function attachVerifiedEmptyControlledConversation(run: ControlledMessagingTestRun, candidateConversationId: number): Promise<ControlledTestResult> {
  requireEnabled();
  const conversationId = requirePositiveInteger(candidateConversationId, 'conversation ID');
  if (!canRecoverVerifiedEmptyControlledConversation(run)) {
    return { step: 'attach-verified-empty-conversation', status: 'stopped', summary: 'Only a stopped preflight checkpoint without messages, pending sends, or a saved conversation can use verified-empty attachment.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null };
  }

  try {
    const inboxResponse = await supabase.rpc('family_staff_list_family_conversations');
    throwRpcError('Verifying the family conversation', inboxResponse.error);
    const conversation = rows(inboxResponse.data, 'Verifying the family conversation').find((row) => (
      requirePositiveInteger(row.conversation_id, 'conversation ID') === conversationId
      && requirePositiveInteger(row.gym_id, 'gym ID') === run.gymId
    ));
    if (!conversation) {
      return { step: 'attach-verified-empty-conversation', status: 'stopped', summary: 'The signed-in family inbox did not authorize that Gym 4 conversation. The halted run remains unchanged.', conversationId: null, messageId: null, cursorId: null, errorCode: null };
    }

    const historyResponse = await supabase.rpc('family_staff_list_message_history', {
      p_conversation_id: conversationId,
      p_access_role: 'family',
      p_before_message_id: null,
      p_page_size: 1,
    });
    throwRpcError('Verifying that the conversation is empty', historyResponse.error);
    if (rows(historyResponse.data, 'Verifying that the conversation is empty').length !== 0) {
      return { step: 'attach-verified-empty-conversation', status: 'stopped', summary: 'The authorized conversation contains message history. The halted run remains unchanged.', conversationId, messageId: null, cursorId: null, errorCode: null };
    }

    run.conversationId = conversationId;
    run.familyInboxChecked = true;
    run.halted = false;
    run.attachedVerifiedEmptyConversation = true;
    await saveControlledMessagingTestRun(run);
    return { step: 'attach-verified-empty-conversation', status: 'passed', summary: 'The signed-in family authorized this Gym 4 conversation and its history was empty. The original run was recovered without changing retry UUIDs.', conversationId, messageId: null, cursorId: null, errorCode: null };
  } catch (error) {
    return errorResult('attach-verified-empty-conversation', error);
  }
}

export async function createControlledFamilyConversation(run: ControlledMessagingTestRun): Promise<ControlledTestResult> {
  requireEnabled();
  if (!run.familyInboxChecked) return { step: 'create-conversation', status: 'stopped', summary: 'Check the family inbox first.', conversationId: null, messageId: null, cursorId: null, errorCode: null };
  if (run.conversationId) return { step: 'create-conversation', status: 'stopped', summary: 'This run already has a conversation ID. Do not create another conversation.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null };
  try {
    const { data, error } = await supabase.rpc('family_staff_get_or_create_conversation', { p_gym_id: run.gymId });
    throwRpcError('Creating the family conversation', error);
    const row = firstRow(data, 'Creating the family conversation');
    run.conversationId = requirePositiveInteger(row.conversation_id, 'conversation ID');
    if (requirePositiveInteger(row.gym_id, 'returned gym ID') !== run.gymId) throw new MessagingContractError('The conversation was returned for the wrong gym.');
    await saveControlledMessagingTestRun(run);
    return { step: 'create-conversation', status: 'passed', summary: 'One Gym 4 conversation was created or returned for this approved family.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null };
  } catch (error) {
    return errorResult('create-conversation', error);
  }
}

async function sendControlledMessage(run: ControlledMessagingTestRun, sender: 'family' | 'staff', retry: boolean): Promise<ControlledTestResult> {
  requireEnabled();
  const message = sender === 'family' ? run.familyMessage : run.staffMessage;
  const step: ControlledTestStep = sender === 'family' ? (retry ? 'family-retry' : 'family-send') : (retry ? 'staff-retry' : 'staff-send');
  if (!run.conversationId) return { step, status: 'stopped', summary: 'A saved conversation ID is required before sending.', conversationId: null, messageId: null, cursorId: null, errorCode: null };
  if (!retry && (message.pending || message.messageId !== null)) return { step, status: 'stopped', summary: 'This message already has a pending or confirmed send. Use its exact retry action only if needed.', conversationId: run.conversationId, messageId: message.messageId, cursorId: null, errorCode: null };
  if (retry && message.messageId === null && !message.pending) return { step, status: 'stopped', summary: 'There is no pending or confirmed message available to retry.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null };
  message.pending = true;
  await saveControlledMessagingTestRun(run);
  try {
    const rpc = sender === 'family' ? 'family_staff_send_family_message' : 'family_staff_send_staff_message';
    const args = sender === 'family'
      ? { p_gym_id: run.gymId, p_body: message.body, p_idempotency_key: message.idempotencyKey }
      : { p_conversation_id: run.conversationId, p_body: message.body, p_idempotency_key: message.idempotencyKey };
    const { data, error } = await supabase.rpc(rpc, args);
    throwRpcError(`Sending the ${sender} test message`, error);
    const row = firstRow(data, `Sending the ${sender} test message`);
    const returnedConversationId = requirePositiveInteger(row.conversation_id, 'returned conversation ID');
    const messageId = requirePositiveInteger(row.message_id, 'returned message ID');
    if (returnedConversationId !== run.conversationId) throw new MessagingContractError('The message was returned for the wrong conversation.');
    if (retry && message.messageId !== null && message.messageId !== messageId) throw new MessagingContractError('A retry returned a different message ID. Stop immediately.');
    message.messageId = messageId;
    message.createdAt = typeof row.created_at === 'string' ? row.created_at : null;
    message.pending = false;
    await saveControlledMessagingTestRun(run);
    return { step, status: 'passed', summary: retry ? 'The exact saved message body and UUID returned the original message ID.' : 'The explicitly confirmed test message was accepted once.', conversationId: run.conversationId, messageId, cursorId: null, errorCode: null };
  } catch (error) {
    // Keep both the exact body and key. A human may retry it; no replacement key is generated.
    await saveControlledMessagingTestRun(run);
    return errorResult(step, error);
  }
}

export const sendControlledFamilyMessage = (run: ControlledMessagingTestRun, retry = false) => sendControlledMessage(run, 'family', retry);
export const sendControlledStaffMessage = (run: ControlledMessagingTestRun, retry = false) => sendControlledMessage(run, 'staff', retry);

export async function checkControlledStaffInbox(run: ControlledMessagingTestRun): Promise<ControlledTestResult> {
  requireEnabled();
  try {
    const { data, error } = await supabase.rpc('family_staff_list_staff_conversations', { p_gym_id: run.gymId });
    throwRpcError('Checking the staff inbox', error);
    const match = rows(data, 'Checking the staff inbox').find((row) => Number(row.conversation_id) === run.conversationId);
    run.staffInboxChecked = true;
    await saveControlledMessagingTestRun(run);
    const unreadCount = match === undefined ? null : Number(match.unread_count);
    const incomingFamilyMessageIsUnread = run.familyMessage.messageId === null || (unreadCount !== null && Number.isSafeInteger(unreadCount) && unreadCount > 0);
    return match && incomingFamilyMessageIsUnread
      ? { step: 'staff-inbox', status: 'passed', summary: 'The authorized staff inbox contains this controlled Gym 4 conversation and reports the incoming family message as unread.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null }
      : { step: 'staff-inbox', status: 'inconclusive', summary: 'The staff inbox returned without this conversation. Stop and review before proceeding.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null };
  } catch (error) {
    return errorResult('staff-inbox', error);
  }
}

/** Verifies only the selected run’s aggregate inbox count; no labels or previews are returned to UI. */
export async function verifyControlledInboxUnread(run: ControlledMessagingTestRun, role: MessagingAccessRole, expected: 'positive' | 'zero'): Promise<ControlledTestResult> {
  requireEnabled();
  if (!run.conversationId) return { step: role === 'family' ? 'family-inbox' : 'staff-inbox', status: 'stopped', summary: 'A saved conversation ID is required.', conversationId: null, messageId: null, cursorId: null, errorCode: null };
  const step: ControlledTestStep = role === 'family' ? 'family-inbox' : 'staff-inbox';
  try {
    const response = role === 'family'
      ? await supabase.rpc('family_staff_list_family_conversations')
      : await supabase.rpc('family_staff_list_staff_conversations', { p_gym_id: run.gymId });
    throwRpcError('Checking the inbox unread count', response.error);
    const match = matchingConversationRow(response.data, run);
    const unreadCount = match === undefined ? null : nonNegativeSafeInteger(match.unread_count);
    const matchesExpectation = unreadCount !== null && Number.isSafeInteger(unreadCount) && (expected === 'positive' ? unreadCount > 0 : unreadCount === 0);
    if (role === 'family') {
      recordFamilyInboxDiagnostic(run, expected, match !== undefined, unreadCount, matchesExpectation);
      await saveControlledMessagingTestRun(run);
    }
    return matchesExpectation
      ? { step, status: 'passed', summary: expected === 'positive' ? 'The selected role’s inbox reports this incoming controlled message as unread.' : 'The selected role’s inbox reports no unread controlled messages after acknowledgement.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null }
      : { step, status: 'failed', summary: 'The selected role’s inbox unread count did not match the expected state. Stop immediately.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null };
  } catch (error) {
    return errorResult(step, error);
  }
}

/**
 * A separately approved completion may only recheck the existing family's
 * aggregate inbox state. It never acknowledges, opens an unread page, sends a
 * message, or replaces any cursor. A passed check unlocks only role denial.
 */
export async function completeHaltedPostAcknowledgementVerification(run: ControlledMessagingTestRun): Promise<ControlledTestResult> {
  requireEnabled();
  if (!isMessagingControlledCompletionEnabled()) {
    return {
      step: 'post-acknowledgement-completion',
      status: 'stopped',
      summary: messagingControlledCompletionCapability.reason,
      conversationId: run.conversationId,
      messageId: null,
      cursorId: null,
      errorCode: null,
    };
  }
  if (!canCompleteHaltedPostAcknowledgementVerification(run)) {
    return {
      step: 'post-acknowledgement-completion',
      status: 'stopped',
      summary: 'This run does not meet the exact reviewed post-acknowledgement completion requirements.',
      conversationId: run.conversationId,
      messageId: null,
      cursorId: null,
      errorCode: null,
    };
  }
  try {
    const conversationId = requirePositiveInteger(run.conversationId, 'completion conversation ID');
    const { data, error } = await supabase.rpc('family_staff_list_family_conversations');
    throwRpcError('Rechecking the family inbox before controlled-test completion', error);
    const match = matchingConversationRow(data, run);
    const unreadCount = match === undefined ? null : nonNegativeSafeInteger(match.unread_count);
    const verified = unreadCount === 0;
    recordFamilyInboxDiagnostic(run, 'zero', match !== undefined, unreadCount, verified);
    if (!verified) {
      await saveControlledMessagingTestRun(run);
      return {
        step: 'post-acknowledgement-completion',
        status: 'stopped',
        summary: 'The fresh authorized family inbox did not confirm Conversation 1 with zero unread messages. The run remains halted.',
        conversationId: run.conversationId,
        messageId: null,
        cursorId: null,
        errorCode: null,
      };
    }
    run.postAcknowledgementCompletion = {
      verifiedAt: new Date().toISOString(),
      conversationId,
      unreadCount: 0,
    };
    run.halted = false;
    await saveControlledMessagingTestRun(run);
    return {
      step: 'post-acknowledgement-completion',
      status: 'passed',
      summary: 'A fresh authorized family inbox confirmed Conversation 1 with zero unread messages. Only the opposite-role denial check is now available.',
      conversationId: run.conversationId,
      messageId: null,
      cursorId: null,
      errorCode: null,
    };
  } catch (error) {
    recordFamilyInboxDiagnostic(run, 'zero', false, null, false);
    await saveControlledMessagingTestRun(run);
    return errorResult('post-acknowledgement-completion', error);
  }
}

export async function verifyControlledHistory(run: ControlledMessagingTestRun, role: MessagingAccessRole): Promise<ControlledTestResult> {
  requireEnabled();
  if (!run.conversationId) return { step: 'history', status: 'stopped', summary: 'A saved conversation ID is required.', conversationId: null, messageId: null, cursorId: null, errorCode: null };
  try {
    const { data, error } = await supabase.rpc('family_staff_list_message_history', { p_conversation_id: run.conversationId, p_access_role: role, p_before_message_id: null, p_page_size: 1 });
    throwRpcError('Checking message history', error);
    const newestPage = rows(data, 'Checking message history');
    const newest = newestPage[0];
    if (!newest) throw new MessagingContractError('History did not include the controlled message page.');
    const newestId = requirePositiveInteger(newest.message_id, 'message ID');
    const expectedBothMessages = run.familyMessage.messageId !== null && run.staffMessage.messageId !== null;
    const hasMore = newest.has_more === true;
    const olderResponse = expectedBothMessages
      ? await supabase.rpc('family_staff_list_message_history', { p_conversation_id: run.conversationId, p_access_role: role, p_before_message_id: newestId, p_page_size: 1 })
      : null;
    if (olderResponse) throwRpcError('Checking paged message history', olderResponse.error);
    const olderPage = olderResponse ? rows(olderResponse.data, 'Checking paged message history') : [];
    const chronological = olderPage.length === 0 || requirePositiveInteger(olderPage[0].message_id, 'message ID') < newestId;
    const allRows = [...olderPage, ...newestPage];
    const familyFound = run.familyMessage.messageId === null || allRows.some((row) => Number(row.message_id) === run.familyMessage.messageId && row.sender_kind === 'family' && typeof row.sender_label === 'string' && row.sender_label.trim().length > 0);
    const staffFound = run.staffMessage.messageId === null || allRows.some((row) => Number(row.message_id) === run.staffMessage.messageId && row.sender_kind === 'staff' && typeof row.sender_label === 'string' && row.sender_label.trim().length > 0);
    const paginationValid = !expectedBothMessages || (hasMore && olderPage.length === 1);
    return chronological && familyFound && staffFound && paginationValid
      ? { step: 'history', status: 'passed', summary: 'The authorized role received chronological paged history with sender types and non-empty labels for this controlled run. Message text was not displayed.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null }
      : { step: 'history', status: 'failed', summary: 'History did not meet the expected chronological or sender-metadata checks. Stop immediately.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null };
  } catch (error) {
    return errorResult('history', error);
  }
}

export async function openControlledUnreadPage(run: ControlledMessagingTestRun, role: MessagingAccessRole): Promise<ControlledTestResult> {
  requireEnabled();
  if (!run.conversationId) return { step: 'unread-page', status: 'stopped', summary: 'A saved conversation ID is required.', conversationId: null, messageId: null, cursorId: null, errorCode: null };
  try {
    const { data, error } = await supabase.rpc('family_staff_open_unread_page', { p_conversation_id: run.conversationId, p_access_role: role, p_page_size: MAX_PAGE_SIZE });
    throwRpcError('Opening unread messages', error);
    const row = firstRow(data, 'Opening unread messages');
    if (row.read_cursor_id === null || row.through_message_id === null) {
      return { step: 'unread-page', status: 'inconclusive', summary: 'No unread cursor was issued. Do not acknowledge; review the current unread state.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null };
    }
    const messages = rows(row.messages, 'Opening unread messages');
    const ids = messages.map((message) => requirePositiveInteger(message.message_id, 'message ID'));
    const chronological = ids.every((id, index) => index === 0 || id > ids[index - 1]);
    if (!chronological) throw new MessagingContractError('Unread messages were not chronological.');
    run.lastReadCursor = { role, cursorId: requireUuid(row.read_cursor_id, 'read cursor'), throughMessageId: requirePositiveInteger(row.through_message_id, 'read endpoint') };
    await saveControlledMessagingTestRun(run);
    return { step: 'unread-page', status: 'passed', summary: 'A server-issued unread cursor and exact endpoint were saved locally. No message text was displayed.', conversationId: run.conversationId, messageId: null, cursorId: run.lastReadCursor.cursorId, errorCode: null };
  } catch (error) {
    return errorResult('unread-page', error);
  }
}

/**
 * Separately gated recovery for the one halted family acknowledgement run.
 * It first proves the signed-in family can still see the exact Gym 4
 * conversation, then asks the server for a fresh cursor only after the UI's
 * explicit confirmation. It never overwrites the original cursor or
 * acknowledges the returned page.
 */
export async function recoverHaltedFamilyAcknowledgement(run: ControlledMessagingTestRun): Promise<ControlledTestResult> {
  requireEnabled();
  const originalCursor = run.lastReadCursor;
  const failureContext = originalCursor ? {
    conversationId: run.conversationId,
    cursorId: originalCursor.cursorId,
    accessRole: originalCursor.role,
    throughMessageId: originalCursor.throughMessageId,
  } : undefined;
  if (!isMessagingControlledAcknowledgementRecoveryEnabled()) {
    return {
      step: 'acknowledgement-recovery',
      status: 'stopped',
      summary: messagingControlledAcknowledgementRecoveryCapability.reason,
      conversationId: run.conversationId,
      messageId: null,
      cursorId: originalCursor?.cursorId ?? null,
      errorCode: null,
      accessRole: originalCursor?.role ?? null,
      throughMessageId: originalCursor?.throughMessageId ?? null,
    };
  }
  if (!canRecoverHaltedFamilyAcknowledgement(run)) {
    return {
      step: 'acknowledgement-recovery',
      status: 'stopped',
      summary: 'This run does not meet the exact halted family-acknowledgement recovery requirements.',
      conversationId: run.conversationId,
      messageId: null,
      cursorId: originalCursor?.cursorId ?? null,
      errorCode: null,
      accessRole: originalCursor?.role ?? null,
      throughMessageId: originalCursor?.throughMessageId ?? null,
    };
  }

  try {
    const conversationId = requirePositiveInteger(run.conversationId, 'conversation ID');
    const original = requireReadCursor(originalCursor, 'original read cursor');
    const inboxResponse = await supabase.rpc('family_staff_list_family_conversations');
    throwRpcError('Rechecking family access before acknowledgement recovery', inboxResponse.error);
    const authorizedConversation = rows(inboxResponse.data, 'Rechecking family access before acknowledgement recovery').find((row) => (
      requirePositiveInteger(row.conversation_id, 'conversation ID') === conversationId
      && requirePositiveInteger(row.gym_id, 'gym ID') === run.gymId
    ));
    if (!authorizedConversation) {
      return {
        step: 'acknowledgement-recovery',
        status: 'stopped',
        summary: 'The signed-in family is not authorized for the saved Gym 4 conversation. The halted run remains unchanged.',
        conversationId,
        messageId: null,
        cursorId: original.cursorId,
        errorCode: null,
        accessRole: original.role,
        throughMessageId: original.throughMessageId,
      };
    }

    const unreadResponse = await supabase.rpc('family_staff_open_unread_page', {
      p_conversation_id: conversationId,
      p_access_role: 'family',
      p_page_size: MAX_PAGE_SIZE,
    });
    throwRpcError('Requesting a fresh family unread cursor for recovery', unreadResponse.error);
    const row = firstRow(unreadResponse.data, 'Requesting a fresh family unread cursor for recovery');
    if (row.read_cursor_id === null || row.through_message_id === null) {
      return {
        step: 'acknowledgement-recovery',
        status: 'stopped',
        summary: 'The server did not issue a fresh unread cursor. The original cursor and halted run remain unchanged.',
        conversationId,
        messageId: null,
        cursorId: original.cursorId,
        errorCode: null,
        accessRole: original.role,
        throughMessageId: original.throughMessageId,
      };
    }
    const issuedCursor: ControlledReadCursor = {
      role: 'family',
      cursorId: requireUuid(row.read_cursor_id, 'recovery read cursor'),
      throughMessageId: requirePositiveInteger(row.through_message_id, 'recovery read endpoint'),
    };
    const messages = rows(row.messages, 'Requesting a fresh family unread cursor for recovery');
    const messageIds = messages.map((message) => requirePositiveInteger(message.message_id, 'message ID'));
    const chronological = messageIds.every((id, index) => index === 0 || id > messageIds[index - 1]);
    if (!chronological || !messageIds.includes(GYM4_ACKNOWLEDGEMENT_RECOVERY_RUN.staffMessageId)) {
      throw new MessagingContractError('The fresh unread page did not contain the expected chronological staff reply.');
    }

    run.recoveryReadCursor = issuedCursor;
    run.halted = false;
    await saveControlledMessagingTestRun(run);
    return {
      step: 'acknowledgement-recovery',
      status: 'passed',
      summary: 'A fresh family cursor was validated for the existing conversation. The original cursor remains saved and no acknowledgement was performed.',
      conversationId,
      messageId: null,
      cursorId: issuedCursor.cursorId,
      errorCode: null,
      accessRole: issuedCursor.role,
      throughMessageId: issuedCursor.throughMessageId,
    };
  } catch (error) {
    return errorResult('acknowledgement-recovery', error, failureContext);
  }
}

export async function acknowledgeControlledUnreadPage(run: ControlledMessagingTestRun): Promise<ControlledTestResult> {
  requireEnabled();
  const selectedCursor = run.recoveryReadCursor ?? run.lastReadCursor;
  if (!run.conversationId || !selectedCursor) return { step: 'acknowledge', status: 'stopped', summary: 'Open an unread page first; acknowledgements require its saved cursor and endpoint.', conversationId: run.conversationId, messageId: null, cursorId: null, errorCode: null };
  let failureContext: Pick<ControlledTestResult, 'conversationId' | 'cursorId' | 'accessRole' | 'throughMessageId'> = {
    conversationId: run.conversationId,
    cursorId: selectedCursor.cursorId,
    accessRole: selectedCursor.role,
    throughMessageId: selectedCursor.throughMessageId,
  };
  try {
    const conversationId = requirePositiveInteger(run.conversationId, 'conversation ID');
    const cursor = {
      role: selectedCursor.role,
      cursorId: requireUuid(selectedCursor.cursorId, 'read cursor'),
      throughMessageId: requirePositiveInteger(selectedCursor.throughMessageId, 'read endpoint'),
    };
    failureContext = {
      conversationId,
      cursorId: cursor.cursorId,
      accessRole: cursor.role,
      throughMessageId: cursor.throughMessageId,
    };
    const { data, error } = await supabase.rpc('family_staff_acknowledge_read', { p_conversation_id: conversationId, p_access_role: cursor.role, p_read_cursor_id: cursor.cursorId, p_through_message_id: cursor.throughMessageId });
    throwRpcError('Acknowledging the unread page', error);
    const row = firstRow(data, 'Acknowledging the unread page');
    if (requirePositiveInteger(row.last_read_message_id, 'read marker') !== cursor.throughMessageId) throw new MessagingContractError('The read marker did not match the server-issued endpoint.');
    return { step: 'acknowledge', status: 'passed', summary: 'The exact server-issued cursor advanced the selected role’s read marker to its endpoint.', conversationId: run.conversationId, messageId: cursor.throughMessageId, cursorId: cursor.cursorId, errorCode: null };
  } catch (error) {
    return errorResult('acknowledge', error, failureContext);
  }
}

export async function checkControlledRoleDenial(run: ControlledMessagingTestRun, forbiddenRole: MessagingAccessRole): Promise<ControlledTestResult> {
  requireEnabled();
  if (!run.conversationId) return { step: 'role-denial', status: 'stopped', summary: 'A saved conversation ID is required.', conversationId: null, messageId: null, cursorId: null, errorCode: null };
  const diagnosticContext = { conversationId: run.conversationId, gymId: run.gymId, accessRole: forbiddenRole };
  try {
    const { data, error } = await supabase.rpc('family_staff_list_message_history', { p_conversation_id: run.conversationId, p_access_role: forbiddenRole, p_before_message_id: null, p_page_size: 1 });
    throwRpcError('Checking the forbidden access role', error);
    void data;
    return { step: 'role-denial', status: 'failed', summary: 'The server allowed the forbidden access role. Stop immediately.', ...diagnosticContext, messageId: null, cursorId: null, errorCode: null, errorType: null };
  } catch (error) {
    if (error instanceof MessagingApiError && error.code === '42501') {
      return {
        step: 'role-denial',
        status: 'denied',
        summary: 'The server rejected the forbidden access role with the expected authorization code.',
        ...diagnosticContext,
        messageId: null,
        cursorId: null,
        errorCode: error.code,
        errorType: safeDiagnosticErrorType(error),
        errorDetail: safeDiagnosticMessage(error),
      };
    }
    if (error instanceof MessagingApiError) {
      return {
        step: 'role-denial',
        status: 'failed',
        summary: 'The server did not return the expected authorization denial code. Stop immediately.',
        ...diagnosticContext,
        messageId: null,
        cursorId: null,
        errorCode: error.code,
        errorType: safeDiagnosticErrorType(error),
        errorDetail: safeDiagnosticMessage(error),
      };
    }
    return {
      step: 'role-denial',
      status: 'failed',
      summary: 'The role-denial RPC did not return a verified server response. Stop immediately.',
      ...diagnosticContext,
      messageId: null,
      cursorId: null,
      errorCode: safeDiagnosticCode(error),
      errorType: safeDiagnosticErrorType(error),
      errorDetail: safeDiagnosticMessage(error),
    };
  }
}
