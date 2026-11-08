import * as React from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import { getOrCreateFamilyConversation, listFamilyMessagingConversations, listStaffMessagingConversations, type MessagingConversation } from '@/lib/messaging';
import { isMessagingEnabled, messagingCapability } from '@/lib/messaging-feature';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';

function relativeTimestamp(value: string | null) {
  if (!value) return 'No messages yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recent' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function parseAccessRole(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === 'family' || candidate === 'staff' ? candidate : null;
}

export default function MessagesIndexScreen() {
  const router = useRouter();
  const { accessRole: routeAccessRole } = useLocalSearchParams<{ accessRole?: string | string[] }>();
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
  const scope = enabled && session?.user.id && !isResolvingAccess && !accessError && role ? `${session.user.id}:${role}:${gymId ?? linkedGyms.map((gym) => gym.gym_id).join(',')}` : null;
  const [conversations, setConversations] = React.useState<MessagingConversation[]>([]);
  const [isLoading, setIsLoading] = React.useState(Boolean(scope));
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [creatingGymId, setCreatingGymId] = React.useState<number | null>(null);
  const requestId = React.useRef(0);
  const scopeRef = React.useRef<string | null>(scope);

  React.useEffect(() => {
    scopeRef.current = scope;
    requestId.current += 1;
    setConversations([]); setError(null); setCreatingGymId(null); setIsRefreshing(false); setIsLoading(Boolean(scope));
  }, [scope]);

  const load = React.useCallback(async () => {
    if (!scope || !role) return;
    const request = ++requestId.current;
    setError(null);
    try {
      const rows = role === 'staff' ? gymId ? await listStaffMessagingConversations(gymId) : [] : await listFamilyMessagingConversations();
      if (request !== requestId.current || scope !== scopeRef.current) return;
      setConversations(rows);
    } catch {
      if (request !== requestId.current || scope !== scopeRef.current) return;
      setConversations([]); setError('Messages could not be loaded. Check your connection and try again.');
    } finally {
      if (request === requestId.current && scope === scopeRef.current) { setIsLoading(false); setIsRefreshing(false); }
    }
  }, [gymId, role, scope]);

  useFocusEffect(React.useCallback(() => { void load(); return undefined; }, [load]));

  const startFamilyConversation = React.useCallback(async (targetGymId: number) => {
    if (!scope || creatingGymId !== null) return;
    setCreatingGymId(targetGymId); setError(null);
    try {
      const conversation = await getOrCreateFamilyConversation(targetGymId);
      if (scope !== scopeRef.current) return;
      router.push({ pathname: '/messages/[conversationId]', params: { conversationId: String(conversation.conversationId), gymId: String(conversation.gymId), accessRole: 'family', canReply: 'true' } });
    } catch {
      if (scope === scopeRef.current) setError('A conversation could not be started. Try again.');
    } finally { if (scope === scopeRef.current) setCreatingGymId(null); }
  }, [creatingGymId, router, scope]);

  if (!enabled) return <Unavailable />;
  if (!role) return <RoleSelection hasFamilyRole={familyAvailable} hasStaffRole={staffAvailable} onSelect={(accessRole) => router.replace({ pathname: '/messages', params: { accessRole } })} />;
  const linkedGymIds = new Set(conversations.map((conversation) => conversation.gymId));
  const startableGyms = role === 'family' ? linkedGyms.filter((gym) => !linkedGymIds.has(gym.gym_id)) : [];

  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><FlatList
    data={isLoading || error ? [] : conversations}
    keyExtractor={(item) => String(item.conversationId)}
    contentContainerClassName="px-5 pb-10"
    refreshing={isRefreshing}
    onRefresh={() => { if (scope) { setIsRefreshing(true); void load(); } }}
    renderItem={({ item }) => <ConversationCard conversation={item} onPress={() => router.push({ pathname: '/messages/[conversationId]', params: { conversationId: String(item.conversationId), gymId: String(item.gymId), accessRole: role, canReply: String(item.canReply) } })} />}
    ListHeaderComponent={<InboxHeader role={role} error={error} onBack={() => { if (router.canGoBack()) router.back(); else if (role === 'family') router.replace('/my-members'); else router.replace('/(tabs)'); }} onRefresh={() => { if (scope) { setIsRefreshing(true); void load(); } }} onRetry={() => void load()} />}
    ListEmptyComponent={isLoading ? <View className="items-center py-20"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading messages…</Text></View> : !error ? <EmptyInbox role={role} /> : null}
    ListFooterComponent={startableGyms.length > 0 ? <View className="mt-3 gap-3">{startableGyms.map((gym) => <Pressable key={gym.gym_id} accessibilityRole="button" accessibilityLabel={`Message ${gym.gym_name ?? 'academy'}`} disabled={creatingGymId !== null} onPress={() => void startFamilyConversation(gym.gym_id)} className={`flex-row items-center justify-between rounded-2xl bg-primary px-4 py-4 ${creatingGymId !== null ? 'opacity-60' : 'active:opacity-90'}`}><View><Text className="font-bold text-primary-foreground">{creatingGymId === gym.gym_id ? 'Opening conversation…' : `Message ${gym.gym_name ?? 'academy'}`}</Text><Text className="mt-1 text-xs text-primary-foreground/80">Private conversation with academy staff</Text></View><LucideIcon name="Send" className="h-5 w-5 text-primary-foreground" /></Pressable>)}</View> : null}
  /></SafeAreaView>;
}

function InboxHeader({ role, error, onBack, onRefresh, onRetry }: { role: 'staff' | 'family' | null; error: string | null; onBack: () => void; onRefresh: () => void; onRetry: () => void }) {
  return <View className="pb-5 pt-4"><View className="flex-row items-center justify-between"><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Refresh messages" onPress={onRefresh} className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"><LucideIcon name="RefreshCw" className="h-4 w-4 text-foreground" /></Pressable></View><Text className="mt-5 text-3xl font-bold tracking-tight text-foreground">{role === 'staff' ? 'Messages' : 'Academy messages'}</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">{role === 'staff' ? 'Private family conversations for your active academy.' : 'Private messages with each academy linked to your family account.'}</Text>{error ? <View className="mt-5 rounded-2xl bg-destructive/10 px-4 py-3"><Text className="text-sm text-destructive">{error}</Text><Pressable accessibilityRole="button" onPress={onRetry} className="mt-3 self-start rounded-lg border border-destructive/30 px-3 py-2"><Text className="text-sm font-bold text-foreground">Retry</Text></Pressable></View> : null}</View>;
}

function ConversationCard({ conversation, onPress }: { conversation: MessagingConversation; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open conversation with ${conversation.label}${conversation.unreadCount ? `, ${conversation.unreadCount} unread` : ''}`} onPress={onPress} className="mb-3 rounded-2xl border border-border bg-card px-4 py-4 active:bg-accent"><View className="flex-row items-start"><View className="mr-3 mt-0.5 h-10 w-10 items-center justify-center rounded-xl bg-primary/10"><LucideIcon name="MessageCircle" className="h-5 w-5 text-primary" /></View><View className="min-w-0 flex-1"><View className="flex-row items-center justify-between gap-3"><Text className="flex-1 font-bold text-foreground" numberOfLines={1}>{conversation.label}</Text><Text className="text-xs text-muted-foreground">{relativeTimestamp(conversation.latestMessageAt)}</Text></View><Text className="mt-1 text-sm text-muted-foreground" numberOfLines={2}>{conversation.latestMessagePreview || 'Start a private conversation with your academy.'}</Text></View>{conversation.unreadCount > 0 ? <View className="ml-3 min-w-6 items-center rounded-full bg-primary px-1.5 py-1"><Text className="text-xs font-bold text-primary-foreground">{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</Text></View> : null}</View></Pressable>;
}

function EmptyInbox({ role }: { role: 'staff' | 'family' | null }) {
  return <View className="rounded-3xl border border-border bg-card px-6 py-10"><LucideIcon name="MessageCircle" className="h-7 w-7 self-center text-muted-foreground" /><Text className="mt-4 text-center text-lg font-bold text-foreground">No conversations yet</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{role === 'staff' ? 'Family messages for this academy will appear here.' : 'Start a conversation with your academy when you need help.'}</Text></View>;
}

function RoleSelection({ hasFamilyRole, hasStaffRole, onSelect }: { hasFamilyRole: boolean; hasStaffRole: boolean; onSelect: (role: 'family' | 'staff') => void }) {
  return <SafeAreaView className="flex-1 bg-background"><View className="flex-1 justify-center px-6"><Text className="text-center text-2xl font-bold text-foreground">Open Messages as</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">Choose which role to use. Family and staff message states are kept separate.</Text><View className="mt-7 gap-3">{hasFamilyRole ? <Pressable accessibilityRole="button" onPress={() => onSelect('family')} className="rounded-2xl border border-border bg-card px-5 py-4 active:bg-accent"><Text className="font-bold text-foreground">Family</Text><Text className="mt-1 text-sm text-muted-foreground">Message your linked academies as a parent or guardian.</Text></Pressable> : null}{hasStaffRole ? <Pressable accessibilityRole="button" onPress={() => onSelect('staff')} className="rounded-2xl border border-border bg-card px-5 py-4 active:bg-accent"><Text className="font-bold text-foreground">Academy staff</Text><Text className="mt-1 text-sm text-muted-foreground">View and reply to family conversations for your academy.</Text></Pressable> : null}</View></View></SafeAreaView>;
}

function Unavailable() { return <SafeAreaView className="flex-1 bg-background"><View className="flex-1 items-center justify-center px-6"><Text className="text-center text-lg font-bold text-foreground">Messages unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{messagingCapability.reason}</Text></View></SafeAreaView>; }
