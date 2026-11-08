import * as Crypto from 'expo-crypto';
import { supabase } from '@/lib/supabase';
import { isMessagingEnabled, messagingCapability } from '@/lib/messaging-feature';

/** Exact access-role values accepted by the deployed messaging RPCs. */
export type MessagingAccessRole = 'family' | 'staff';
export type MessagingSenderKind = MessagingAccessRole;

export type MessagingConversation = {
  conversationId: number;
  gymId: number;
  label: string;
  latestMessagePreview: string;
  latestSenderKind: MessagingSenderKind | null;
  latestMessageAt: string | null;
  unreadCount: number;
  canReply: boolean;
};

export type MessagingMessage = {
  messageId: number;
  senderKind: MessagingSenderKind;
  senderLabel: string;
  body: string;
  createdAt: string;
  hasMore?: boolean;
};

export type MessagingHistoryPage = { messages: MessagingMessage[]; hasMore: boolean };
export type MessagingUnreadPage = {
  cursorId: string | null;
  baseReadMessageId: number | null;
  throughMessageId: number | null;
  hasMore: boolean;
  messages: MessagingMessage[];
};
export type MessagingConversationResult = { conversationId: number; gymId: number; createdAt: string };
export type MessagingSendResult = { conversationId: number; messageId: number; createdAt: string };
export type MessagingReadAcknowledgement = { lastReadMessageId: number; acknowledgedAt: string };
export type MessagingStaffProfile = {
  userId: string;
  gymId: number;
  displayName: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

type RpcRow = Record<string, unknown>;
type SupabaseRpcError = { code?: unknown; message?: unknown; status?: unknown };

const MAX_MESSAGE_PAGE_SIZE = 100;
const DEFAULT_MESSAGE_PAGE_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MessagingUnavailableError extends Error {
  constructor() {
    super(messagingCapability.reason);
    this.name = 'MessagingUnavailableError';
  }
}

export class MessagingContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessagingContractError';
  }
}

/** A safe, user-displayable representation of an RPC failure. */
export class MessagingApiError extends Error {
  readonly code: string | null;
  readonly status: number | null;

  constructor(operation: string, error: SupabaseRpcError) {
    const message = typeof error.message === 'string' && error.message.trim()
      ? error.message.trim()
      : `${operation} could not be completed.`;
    super(message);
    this.name = 'MessagingApiError';
    this.code = typeof error.code === 'string' ? error.code : null;
    this.status = typeof error.status === 'number' ? error.status : null;
  }
}

function requireMessagingEnabled() {
  if (!isMessagingEnabled()) throw new MessagingUnavailableError();
}

function requirePositiveInteger(value: unknown, name: string) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new MessagingContractError(`Messaging requires a valid ${name}.`);
  return parsed;
}

function nullablePositiveInteger(value: unknown, name: string) {
  return value === null || value === undefined ? null : requirePositiveInteger(value, name);
}

function requireString(value: unknown, name: string) {
  if (typeof value !== 'string') throw new MessagingContractError(`Messaging returned an invalid ${name}.`);
  return value;
}

function nullableString(value: unknown, name: string) {
  return value === null || value === undefined ? null : requireString(value, name);
}

function requireUuid(value: unknown, name: string) {
  const uuid = requireString(value, name);
  if (!UUID_PATTERN.test(uuid)) throw new MessagingContractError(`Messaging requires a valid ${name}.`);
  return uuid;
}

function requireAccessRole(value: unknown): MessagingAccessRole {
  if (value === 'family' || value === 'staff') return value;
  throw new MessagingContractError('Messaging requires a family or staff access role.');
}

function requirePageSize(value: number | undefined) {
  const pageSize = value ?? DEFAULT_MESSAGE_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_MESSAGE_PAGE_SIZE) {
    throw new MessagingContractError(`Messaging page size must be between 1 and ${MAX_MESSAGE_PAGE_SIZE}.`);
  }
  return pageSize;
}

function requireMessageBody(value: string) {
  const body = value.trim();
  if (body.length < 1 || body.length > 4000) throw new MessagingContractError('Messages must contain 1 to 4000 characters.');
  return body;
}

function firstRow(data: unknown, operation: string): RpcRow {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new MessagingContractError(`${operation} did not return a record.`);
  return row as RpcRow;
}

function rows(data: unknown, operation: string): RpcRow[] {
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data) || data.some((row) => !row || typeof row !== 'object')) {
    throw new MessagingContractError(`${operation} returned an invalid result.`);
  }
  return data as RpcRow[];
}

function throwRpcError(operation: string, error: SupabaseRpcError | null): void {
  if (error) throw new MessagingApiError(operation, error);
}

function messageFromRow(row: RpcRow): MessagingMessage {
  const hasMore = row.has_more;
  if (hasMore !== undefined && typeof hasMore !== 'boolean') throw new MessagingContractError('Messaging returned an invalid pagination result.');
  return {
    messageId: requirePositiveInteger(row.message_id, 'message ID'),
    senderKind: requireAccessRole(row.sender_kind),
    senderLabel: requireString(row.sender_label, 'sender label'),
    body: requireString(row.body, 'message body'),
    createdAt: requireString(row.created_at, 'message timestamp'),
    ...(typeof hasMore === 'boolean' ? { hasMore } : {}),
  };
}

function conversationFromRow(row: RpcRow, role: MessagingAccessRole): MessagingConversation {
  const label = role === 'staff' ? row.family_label : row.gym_name;
  const latestSender = row.latest_sender_kind;
  const unreadCount = Number(row.unread_count ?? 0);
  if (!Number.isSafeInteger(unreadCount) || unreadCount < 0) throw new MessagingContractError('Messaging returned an invalid unread count.');
  if (latestSender !== null && latestSender !== undefined && latestSender !== 'family' && latestSender !== 'staff') {
    throw new MessagingContractError('Messaging returned an invalid latest sender.');
  }
  return {
    conversationId: requirePositiveInteger(row.conversation_id, 'conversation ID'),
    gymId: requirePositiveInteger(row.gym_id, 'gym ID'),
    label: requireString(label, 'conversation label'),
    latestMessagePreview: requireString(row.latest_message_preview, 'message preview'),
    latestSenderKind: latestSender === 'family' || latestSender === 'staff' ? latestSender : null,
    latestMessageAt: nullableString(row.latest_message_at, 'latest message timestamp'),
    unreadCount,
    canReply: role === 'family' ? true : row.can_reply === true,
  };
}

function sendResultFromRow(row: RpcRow, operation: string): MessagingSendResult {
  return {
    conversationId: requirePositiveInteger(row.conversation_id, `${operation} conversation ID`),
    messageId: requirePositiveInteger(row.message_id, `${operation} message ID`),
    createdAt: requireString(row.created_at, `${operation} timestamp`),
  };
}

/** Creates a UUID for one user action; retain it until that action succeeds. */
export function createMessagingIdempotencyKey() {
  try {
    return Crypto.randomUUID();
  } catch {
    throw new MessagingContractError('Secure message retry-key generation is unavailable. Please try again later.');
  }
}

/** Public RPC 1/9: active admins set a gym-scoped staff display name. */
export async function upsertMessagingStaffProfile(userId: string, gymId: number, displayName: string): Promise<MessagingStaffProfile> {
  requireMessagingEnabled();
  const { data, error } = await supabase.rpc('family_staff_upsert_staff_profile', {
    p_user_id: requireUuid(userId, 'staff user ID'), p_gym_id: requirePositiveInteger(gymId, 'gym ID'), p_display_name: displayName,
  });
  throwRpcError('Saving the staff display name', error);
  const row = firstRow(data, 'Saving the staff display name');
  return {
    userId: requireUuid(row.user_id, 'staff user ID'), gymId: requirePositiveInteger(row.gym_id, 'gym ID'),
    displayName: requireString(row.display_name, 'staff display name'), updatedBy: requireUuid(row.updated_by, 'profile updater ID'),
    createdAt: requireString(row.created_at, 'profile creation timestamp'), updatedAt: requireString(row.updated_at, 'profile update timestamp'),
  };
}

/** Public RPC 2/9: approved families obtain their one conversation per gym. */
export async function getOrCreateFamilyConversation(gymId: number): Promise<MessagingConversationResult> {
  requireMessagingEnabled();
  const { data, error } = await supabase.rpc('family_staff_get_or_create_conversation', { p_gym_id: requirePositiveInteger(gymId, 'gym ID') });
  throwRpcError('Opening the family conversation', error);
  const row = firstRow(data, 'Opening the family conversation');
  return { conversationId: requirePositiveInteger(row.conversation_id, 'conversation ID'), gymId: requirePositiveInteger(row.gym_id, 'gym ID'), createdAt: requireString(row.created_at, 'conversation creation timestamp') };
}

/** Public RPC 3/9: sends an idempotent family message. */
export async function sendFamilyMessagingMessage(gymId: number, body: string, idempotencyKey: string): Promise<MessagingSendResult> {
  requireMessagingEnabled();
  const { data, error } = await supabase.rpc('family_staff_send_family_message', {
    p_gym_id: requirePositiveInteger(gymId, 'gym ID'), p_body: requireMessageBody(body), p_idempotency_key: requireUuid(idempotencyKey, 'message retry key'),
  });
  throwRpcError('Sending the family message', error);
  return sendResultFromRow(firstRow(data, 'Sending the family message'), 'family message');
}

/** Public RPC 4/9: sends an idempotent academy-staff reply. */
export async function sendStaffMessagingMessage(conversationId: number, body: string, idempotencyKey: string): Promise<MessagingSendResult> {
  requireMessagingEnabled();
  const { data, error } = await supabase.rpc('family_staff_send_staff_message', {
    p_conversation_id: requirePositiveInteger(conversationId, 'conversation ID'), p_body: requireMessageBody(body), p_idempotency_key: requireUuid(idempotencyKey, 'message retry key'),
  });
  throwRpcError('Sending the staff message', error);
  return sendResultFromRow(firstRow(data, 'Sending the staff message'), 'staff message');
}

/** Public RPC 5/9: approved family inbox. */
export async function listFamilyMessagingConversations(): Promise<MessagingConversation[]> {
  requireMessagingEnabled();
  const { data, error } = await supabase.rpc('family_staff_list_family_conversations');
  throwRpcError('Loading family messages', error);
  return rows(data, 'Loading family messages').map((row) => conversationFromRow(row, 'family'));
}

/** Public RPC 6/9: active admin/coach inbox for one selected gym. */
export async function listStaffMessagingConversations(gymId: number): Promise<MessagingConversation[]> {
  requireMessagingEnabled();
  const { data, error } = await supabase.rpc('family_staff_list_staff_conversations', { p_gym_id: requirePositiveInteger(gymId, 'gym ID') });
  throwRpcError('Loading staff messages', error);
  return rows(data, 'Loading staff messages').map((row) => conversationFromRow(row, 'staff'));
}

/** Public RPC 7/9: role-scoped chronological history page. */
export async function listMessagingHistory(conversationId: number, accessRole: MessagingAccessRole, beforeMessageId: number | null = null, pageSize?: number): Promise<MessagingHistoryPage> {
  requireMessagingEnabled();
  const { data, error } = await supabase.rpc('family_staff_list_message_history', {
    p_conversation_id: requirePositiveInteger(conversationId, 'conversation ID'), p_access_role: requireAccessRole(accessRole),
    p_before_message_id: beforeMessageId === null ? null : requirePositiveInteger(beforeMessageId, 'pagination boundary'), p_page_size: requirePageSize(pageSize),
  });
  throwRpcError('Loading message history', error);
  const messages = rows(data, 'Loading message history').map(messageFromRow);
  return { messages, hasMore: messages[0]?.hasMore === true };
}

/** Public RPC 8/9: role-scoped unread page and server-issued cursor. */
export async function openUnreadMessagingPage(conversationId: number, accessRole: MessagingAccessRole, pageSize?: number): Promise<MessagingUnreadPage> {
  requireMessagingEnabled();
  const { data, error } = await supabase.rpc('family_staff_open_unread_page', {
    p_conversation_id: requirePositiveInteger(conversationId, 'conversation ID'), p_access_role: requireAccessRole(accessRole), p_page_size: requirePageSize(pageSize),
  });
  throwRpcError('Opening unread messages', error);
  const row = firstRow(data, 'Opening unread messages');
  if (typeof row.has_more !== 'boolean' || !Array.isArray(row.messages)) throw new MessagingContractError('Messaging returned an invalid unread page.');
  const cursorId = row.read_cursor_id === null ? null : requireUuid(row.read_cursor_id, 'read cursor');
  const throughMessageId = nullablePositiveInteger(row.through_message_id, 'read endpoint');
  if ((cursorId === null) !== (throughMessageId === null)) throw new MessagingContractError('Messaging returned an incomplete read cursor.');
  return {
    cursorId, baseReadMessageId: nullablePositiveInteger(row.base_read_message_id, 'read marker'), throughMessageId,
    hasMore: row.has_more, messages: rows(row.messages, 'Opening unread messages').map(messageFromRow),
  };
}

/** Public RPC 9/9: acknowledges one exact role-scoped server-issued cursor. */
export async function acknowledgeMessagingRead(conversationId: number, accessRole: MessagingAccessRole, cursorId: string, throughMessageId: number): Promise<MessagingReadAcknowledgement> {
  requireMessagingEnabled();
  const { data, error } = await supabase.rpc('family_staff_acknowledge_read', {
    p_conversation_id: requirePositiveInteger(conversationId, 'conversation ID'), p_access_role: requireAccessRole(accessRole),
    p_read_cursor_id: requireUuid(cursorId, 'read cursor'), p_through_message_id: requirePositiveInteger(throughMessageId, 'read endpoint'),
  });
  throwRpcError('Acknowledging read messages', error);
  const row = firstRow(data, 'Acknowledging read messages');
  return { lastReadMessageId: requirePositiveInteger(row.last_read_message_id, 'read marker'), acknowledgedAt: requireString(row.acknowledged_at, 'acknowledgement timestamp') };
}
