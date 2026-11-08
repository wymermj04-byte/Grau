import * as React from 'react';
import { FlatList, Pressable, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import {
  acknowledgeMessagingRead,
  createMessagingIdempotencyKey,
  listFamilyMessagingConversations,
  listMessagingHistory,
  listStaffMessagingConversations,
  openUnreadMessagingPage,
  sendFamilyMessagingMessage,
  sendStaffMessagingMessage,
  type MessagingAccessRole,
  type MessagingConversation,
  type MessagingMessage,
} from '@/lib/messaging';
import {
  clearMessagingDraft,
  canSendPersistedMessagingDraft,
  createMessagingSendLock,
  EMPTY_DRAFT,
  isCurrentMessagingScope,
  loadMessagingDraft,
  messagingDraftScopeKey,
  saveMessagingDraft,
  type MessagingDraftScope,
  type PersistedMessagingDraft,
} from '@/lib/messaging-drafts';
import { isMessagingEnabled, messagingCapability } from '@/lib/messaging-feature';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';

type AuthorizedConversationScope = MessagingDraftScope & { canReply: boolean };

function parsePositiveId(value: string | string[] | undefined) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseAccessRole(value: string | string[] | undefined): MessagingAccessRole | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === 'family' || candidate === 'staff' ? candidate : null;
}

function mergeMessages(...groups: MessagingMessage[][]) {
  const byId = new Map<number, MessagingMessage>();
  groups.flat().forEach((message) => byId.set(message.messageId, message));
  return [...byId.values()].sort((a, b) => a.messageId - b.messageId);
}

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function normalizedBody(value: string) {
  return value.trim();
}

function scopeFromConversation(userId: string, role: MessagingAccessRole, conversation: MessagingConversation): AuthorizedConversationScope {
  return { userId, role, gymId: conversation.gymId, conversationId: conversation.conversationId, canReply: conversation.canReply };
}

export default function ConversationScreen() {
  const router = useRouter();
  const { conversationId: routeId, accessRole: routeAccessRole } = useLocalSearchParams<{ conversationId?: string | string[]; accessRole?: string | string[] }>();
  const conversationId = parsePositiveId(routeId);
  const { session } = useAuth();
  const { accessError, accessStatus, gymId, isResolvingAccess, linkedGyms } = useGymAccess();
  const enabled = isMessagingEnabled();
  const requestedRole = parseAccessRole(routeAccessRole);
  const staffAvailable = accessStatus === 'staff' && gymId !== null;
  const familyAvailable = linkedGyms.length > 0;
  const role = requestedRole === 'staff' && staffAvailable
    ? 'staff'
    : requestedRole === 'family' && familyAvailable
      ? 'family'
      : staffAvailable && !familyAvailable
        ? 'staff'
        : familyAvailable && !staffAvailable
          ? 'family'
          : null;
  const userId = session?.user.id ?? null;
  const [authorizedScope, setAuthorizedScope] = React.useState<AuthorizedConversationScope | null>(null);
  const [isResolvingConversation, setIsResolvingConversation] = React.useState(false);
  const [conversationError, setConversationError] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<MessagingMessage[]>([]);
  const [draft, setDraft] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = React.useState(false);
  const [hasOlder, setHasOlder] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [isLoadingDraft, setIsLoadingDraft] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const [draftState, setDraftState] = React.useState<PersistedMessagingDraft>(EMPTY_DRAFT);
  const requestId = React.useRef(0);
  const draftLoadVersion = React.useRef(0);
  const draftEditedVersion = React.useRef(0);
  const scopeRef = React.useRef<AuthorizedConversationScope | null>(null);
  const draftStateRef = React.useRef<PersistedMessagingDraft>(EMPTY_DRAFT);
  const sendLockRef = React.useRef(createMessagingSendLock());

  const scopeKey = authorizedScope ? messagingDraftScopeKey(authorizedScope) : null;

  React.useEffect(() => {
    scopeRef.current = authorizedScope;
    requestId.current += 1;
    draftLoadVersion.current += 1;
    draftEditedVersion.current += 1;
    draftStateRef.current = EMPTY_DRAFT;
    setMessages([]);
    setDraft('');
    setDraftState(EMPTY_DRAFT);
    setHasOlder(false);
    setLoadError(null);
    setSendError(null);
    setIsSending(false);
    setIsLoadingDraft(Boolean(authorizedScope));
    sendLockRef.current.release();
  }, [scopeKey]);

  // A route parameter is only a navigation hint. The inbox RPC authorizes the
  // selected conversation and supplies its actual gym before any draft, history,
  // acknowledgement, or send work can begin.
  React.useEffect(() => {
    if (!enabled || !conversationId || !role || !userId || isResolvingAccess || accessError) {
      setAuthorizedScope(null);
      setIsResolvingConversation(false);
      return;
    }
    let active = true;
    setAuthorizedScope(null);
    setConversationError(null);
    setIsResolvingConversation(true);
    const expectedUserId = userId;
    const expectedRole = role;
    const expectedGymId = gymId;
    void (async () => {
      try {
        const conversations = expectedRole === 'staff'
          ? expectedGymId ? await listStaffMessagingConversations(expectedGymId) : []
          : await listFamilyMessagingConversations();
        const conversation = conversations.find((item) => item.conversationId === conversationId) ?? null;
        if (!conversation) throw new Error('This conversation is no longer available for the selected account.');
        if (!active || session?.user.id !== expectedUserId) return;
        setAuthorizedScope(scopeFromConversation(expectedUserId, expectedRole, conversation));
      } catch {
        if (active) setConversationError('This conversation could not be verified. Return to Messages and reopen it.');
      } finally {
        if (active) setIsResolvingConversation(false);
      }
    })();
    return () => { active = false; };
  }, [accessError, conversationId, enabled, gymId, isResolvingAccess, role, session?.user.id, userId]);

  React.useEffect(() => {
    if (!authorizedScope || !scopeKey) {
      setIsLoadingDraft(false);
      return;
    }
    const loadVersion = ++draftLoadVersion.current;
    const editVersionAtStart = draftEditedVersion.current;
    let active = true;
    void loadMessagingDraft(authorizedScope).then((saved) => {
      if (!active || loadVersion !== draftLoadVersion.current || editVersionAtStart !== draftEditedVersion.current || scopeRef.current !== authorizedScope) return;
      const next = saved ?? EMPTY_DRAFT;
      draftStateRef.current = next;
      setDraftState(next);
      setDraft(next.draftBody);
    }).catch(() => {
      if (active && loadVersion === draftLoadVersion.current) setSendError('Saved draft could not be loaded. Do not send until it can be saved again.');
    }).finally(() => {
      if (active && loadVersion === draftLoadVersion.current) setIsLoadingDraft(false);
    });
    return () => { active = false; };
  }, [authorizedScope, scopeKey]);

  const persistDraft = React.useCallback(async (scope: AuthorizedConversationScope, next: PersistedMessagingDraft) => {
    draftStateRef.current = next;
    setDraftState(next);
    await saveMessagingDraft(scope, next);
  }, []);

  const updateDraft = React.useCallback((value: string) => {
    if (sendLockRef.current.isInFlight) return;
    draftEditedVersion.current += 1;
    setDraft(value);
    setSendError(null);
    const scope = scopeRef.current;
    if (!scope) return;
    const previous = draftStateRef.current;
    const changedFromRetry = previous.retryKey && normalizedBody(value) !== normalizedBody(previous.draftBody);
    const pendingAttempt = changedFromRetry && previous.retryKey
      ? { body: previous.draftBody, retryKey: previous.retryKey, status: 'unknown' as const }
      : previous.pendingAttempt;
    const next: PersistedMessagingDraft = {
      draftBody: value,
      retryKey: changedFromRetry ? null : previous.retryKey,
      pendingAttempt,
    };
    void persistDraft(scope, next).catch(() => {
      if (scopeRef.current === scope) setSendError('Draft changes could not be saved. Do not send until saving succeeds.');
    });
  }, [persistDraft]);

  const load = React.useCallback(async () => {
    const scope = scopeRef.current;
    if (!scope) return;
    const request = ++requestId.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const history = await listMessagingHistory(scope.conversationId, scope.role);
      let unread = await openUnreadMessagingPage(scope.conversationId, scope.role);
      const unreadMessages: MessagingMessage[] = [];
      while (unread.cursorId && unread.throughMessageId) {
        unreadMessages.push(...unread.messages);
        await acknowledgeMessagingRead(scope.conversationId, scope.role, unread.cursorId, unread.throughMessageId);
        if (!unread.hasMore) break;
        unread = await openUnreadMessagingPage(scope.conversationId, scope.role);
      }
      if (request !== requestId.current || scopeRef.current !== scope) return;
      setMessages(mergeMessages(history.messages, unreadMessages));
      setHasOlder(history.hasMore);
    } catch {
      if (request !== requestId.current || scopeRef.current !== scope) return;
      setMessages([]);
      setLoadError('Conversation history could not be loaded. No messages were marked read.');
    } finally {
      if (request === requestId.current && scopeRef.current === scope) setIsLoading(false);
    }
  }, []);

  useFocusEffect(React.useCallback(() => { void load(); return undefined; }, [load, scopeKey]));

  const loadOlder = React.useCallback(async () => {
    const scope = scopeRef.current;
    if (!scope || isLoadingOlder || !hasOlder || messages.length === 0) return;
    setIsLoadingOlder(true);
    try {
      const older = await listMessagingHistory(scope.conversationId, scope.role, messages[0]?.messageId ?? null);
      if (scopeRef.current === scope) {
        setMessages((current) => mergeMessages(older.messages, current));
        setHasOlder(older.hasMore);
      }
    } catch {
      if (scopeRef.current === scope) setLoadError('Older messages could not be loaded. Try again.');
    } finally {
      if (scopeRef.current === scope) setIsLoadingOlder(false);
    }
  }, [hasOlder, isLoadingOlder, messages]);

  const send = React.useCallback(async () => {
    if (!sendLockRef.current.tryAcquire()) return;
    const scope = scopeRef.current;
    const body = normalizedBody(draft);
    if (!scope || !body || !canSendPersistedMessagingDraft(draftStateRef.current)) {
      sendLockRef.current.release();
      return;
    }
    setIsSending(true);
    setSendError(null);
    try {
      const retryKey = draftStateRef.current.retryKey ?? createMessagingIdempotencyKey();
      const requestState: PersistedMessagingDraft = { draftBody: body, retryKey, pendingAttempt: null };
      // This awaited write is the durable hand-off before any server request.
      await persistDraft(scope, requestState);

      const currentScope = scopeRef.current;
      if (currentScope !== scope || !isCurrentMessagingScope(scope, {
        userId: session?.user.id ?? null,
        role,
        staffGymId: accessStatus === 'staff' ? gymId : null,
        familyGymIds: linkedGyms.map((item) => item.gym_id),
      })) {
        throw new Error('Your account or academy access changed before this message could be sent.');
      }

      if (scope.role === 'family') await sendFamilyMessagingMessage(scope.gymId, body, retryKey);
      else await sendStaffMessagingMessage(scope.conversationId, body, retryKey);

      if (scopeRef.current !== scope) return;
      try {
        await clearMessagingDraft(scope);
        draftStateRef.current = EMPTY_DRAFT;
        setDraftState(EMPTY_DRAFT);
        setDraft('');
        await load();
      } catch {
        const cleanupRequired: PersistedMessagingDraft = {
          draftBody: '',
          retryKey: null,
          pendingAttempt: { body, retryKey, status: 'sent_cleanup_required' },
        };
        draftStateRef.current = cleanupRequired;
        setDraftState(cleanupRequired);
        setDraft('');
        try {
          await saveMessagingDraft(scope, cleanupRequired);
        } catch {
          // Keep the original key in memory. A later explicit retry remains
          // idempotent rather than creating a second server-side message.
        }
        setSendError('Message was sent, but its local retry record needs cleanup. Sending is paused until it is safely cleared.');
      }
    } catch (error) {
      if (scopeRef.current === scope) {
        const message = error instanceof Error && error.message.includes('Secure message retry-key')
          ? error.message
          : 'Message was not sent or its result is unknown. Retry will use the same secure request key.';
        setSendError(message);
      }
    } finally {
      if (scopeRef.current === scope) setIsSending(false);
      sendLockRef.current.release();
    }
  }, [accessStatus, draft, gymId, linkedGyms, load, persistDraft, session?.user.id]);

  if (!enabled) return <Unavailable />;
  if (!conversationId) return <SafeAreaView className="flex-1 items-center justify-center bg-background px-6"><Text className="text-center text-sm text-destructive">This conversation link is invalid.</Text></SafeAreaView>;
  if (!role) return <SafeAreaView className="flex-1 items-center justify-center bg-background px-6"><Text className="text-center text-sm text-muted-foreground">Choose your Family or Staff Messages inbox before opening a conversation.</Text></SafeAreaView>;

  const isReadOnlyStaffConversation = authorizedScope?.role === 'staff' && !authorizedScope.canReply;
  const hasUnresolvedAttempt = Boolean(draftState.pendingAttempt);
  const canCompose = Boolean(authorizedScope) && !isLoadingDraft && !isSending && !loadError && !isReadOnlyStaffConversation && !hasUnresolvedAttempt;
  const headerRole = authorizedScope?.role ?? role;

  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><View className="flex-1">
    <View className="flex-row items-center border-b border-border px-5 py-3"><Pressable accessibilityRole="button" accessibilityLabel="Back to messages" onPress={() => { if (router.canGoBack()) router.back(); else router.replace({ pathname: '/messages', params: { accessRole: role } }); }} className="mr-3 h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable><View className="flex-1"><Text className="text-lg font-bold text-foreground">Private messages</Text><Text className="text-xs text-muted-foreground">{headerRole === 'staff' ? 'Replying as academy staff' : 'Conversation with your academy'}</Text></View></View>
    {isResolvingConversation ? <View className="mx-5 mt-4 rounded-2xl border border-border bg-card px-4 py-3"><Text className="text-sm text-muted-foreground">Verifying this conversation…</Text></View> : null}
    {conversationError ? <View className="mx-5 mt-4 rounded-2xl bg-destructive/10 px-4 py-3"><Text className="text-sm text-destructive">{conversationError}</Text></View> : null}
    {isReadOnlyStaffConversation ? <View className="mx-5 mt-4 rounded-2xl border border-border bg-card px-4 py-3"><Text className="text-sm font-bold text-foreground">Conversation is read-only</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">This family no longer has an approved link to this academy. Message history remains available, but new replies are disabled.</Text></View> : null}
    {hasUnresolvedAttempt ? <View className="mx-5 mt-4 rounded-2xl border border-border bg-card px-4 py-3"><Text className="text-sm font-bold text-foreground">Message needs reconciliation</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">{draftState.pendingAttempt?.status === 'sent_cleanup_required' ? 'The message was confirmed sent, but its local retry record could not be cleared.' : 'A prior send may still be pending. Its retry identity has been preserved and new messages are paused.'}</Text></View> : null}
    {loadError ? <View className="mx-5 mt-4 rounded-2xl bg-destructive/10 px-4 py-3"><Text className="text-sm text-destructive">{loadError}</Text><Pressable accessibilityRole="button" onPress={() => void load()} className="mt-3 self-start rounded-lg border border-destructive/30 px-3 py-2"><Text className="text-sm font-bold text-foreground">Retry</Text></Pressable></View> : null}
    <FlatList data={messages} keyExtractor={(item) => String(item.messageId)} contentContainerClassName="flex-grow px-5 py-4" renderItem={({ item }) => <MessageBubble message={item} mine={item.senderKind === (headerRole === 'staff' ? 'staff' : 'family')} />} ListHeaderComponent={hasOlder ? <Pressable accessibilityRole="button" disabled={isLoadingOlder} onPress={() => void loadOlder()} className="mb-4 self-center rounded-xl border border-border bg-card px-4 py-2"><Text className="text-sm font-bold text-foreground">{isLoadingOlder ? 'Loading…' : 'Load older messages'}</Text></Pressable> : null} ListEmptyComponent={isLoading || isResolvingConversation ? <View className="flex-1 items-center justify-center py-20"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading conversation…</Text></View> : !loadError && !conversationError ? <View className="flex-1 items-center justify-center py-20"><Text className="text-center text-sm text-muted-foreground">No messages yet. Start the conversation below.</Text></View> : null} />
    <View className="border-t border-border bg-background px-5 pb-4 pt-3"><TextInput accessibilityLabel="Message" value={draft} onChangeText={updateDraft} placeholder="Write a message…" placeholderTextColor="hsl(150 8% 46%)" multiline maxLength={4000} editable={canCompose} className="min-h-12 max-h-32 rounded-2xl border border-border bg-card px-4 py-3 text-base text-foreground" />{isLoadingDraft ? <Text className="mt-2 text-xs text-muted-foreground">Preparing your saved draft…</Text> : null}{sendError ? <Text className="mt-2 text-xs text-destructive">{sendError}</Text> : null}<Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={!normalizedBody(draft) || !canCompose} onPress={() => void send()} className={`mt-3 flex-row items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 ${!normalizedBody(draft) || !canCompose ? 'opacity-50' : 'active:opacity-90'}`}><LucideIcon name="Send" className="h-4 w-4 text-primary-foreground" /><Text className="font-bold text-primary-foreground">{isSending ? 'Sending…' : 'Send'}</Text></Pressable></View>
  </View></SafeAreaView>;
}

function MessageBubble({ message, mine }: { message: MessagingMessage; mine: boolean }) { return <View className={`mb-3 max-w-[86%] rounded-2xl px-4 py-3 ${mine ? 'self-end bg-primary' : 'self-start border border-border bg-card'}`}><Text className={`text-xs font-bold ${mine ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{message.senderLabel}</Text><Text className={`mt-1 text-sm leading-5 ${mine ? 'text-primary-foreground' : 'text-foreground'}`}>{message.body}</Text><Text className={`mt-2 text-[11px] ${mine ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{timeLabel(message.createdAt)}</Text></View>; }
function Unavailable() { return <SafeAreaView className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><Text className="text-center text-lg font-bold text-foreground">Messages unavailable</Text><Text className="mt-2 text-center text-sm text-muted-foreground">{messagingCapability.reason}</Text></View></SafeAreaView>; }
