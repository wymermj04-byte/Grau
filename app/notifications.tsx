import * as React from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/gym/AppHeader';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import {
  listFamilyMessagingConversations,
  type MessagingConversation,
} from '@/lib/messaging';
import { isMessagingEnabled } from '@/lib/messaging-feature';
import {
  listPromotionNotifications,
  markPromotionNotificationRead,
  type PromotionNotification,
} from '@/lib/promotion-notifications';
import { isPromotionNotificationsEnabled, promotionNotificationsCapability } from '@/lib/promotion-notifications-feature';
import { formatTimestampDate } from '@/lib/date';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess, type LinkedMember } from '@/providers/GymAccessProvider';

type UnifiedNotification = {
  id: string;
  kind: 'message' | 'promotion';
  unread: boolean;
  timestamp: string | null;
  title: string;
  detail: string;
  conversation?: MessagingConversation;
  promotion?: PromotionNotification;
};

function sortNewestFirst(left: UnifiedNotification, right: UnifiedNotification) {
  const leftTime = left.timestamp ? Date.parse(left.timestamp) : Number.NEGATIVE_INFINITY;
  const rightTime = right.timestamp ? Date.parse(right.timestamp) : Number.NEGATIVE_INFINITY;
  return rightTime - leftTime;
}

function toMessageNotifications(conversations: MessagingConversation[]): UnifiedNotification[] {
  return conversations
    .filter((conversation) => conversation.unreadCount > 0)
    .map((conversation) => ({
      id: `message:${conversation.conversationId}`,
      kind: 'message' as const,
      unread: true,
      timestamp: conversation.latestMessageAt,
      title: conversation.label,
      detail: conversation.latestMessagePreview || 'You have an unread message from your academy.',
      conversation,
    }));
}

function linkedMemberName(member: LinkedMember | undefined) {
  const name = [member?.first_name, member?.last_name].filter(Boolean).join(' ').trim();
  return name || null;
}

function toPromotionNotifications(
  notifications: PromotionNotification[],
  membersById: ReadonlyMap<number, LinkedMember>,
): UnifiedNotification[] {
  return notifications.map((notification) => {
    const studentName = linkedMemberName(membersById.get(notification.studentId));
    return {
      id: `promotion:${notification.id}`,
      kind: 'promotion' as const,
      unread: !notification.readAt,
      timestamp: notification.createdAt,
      title: 'Promotion celebration',
      detail: studentName
        ? `${studentName} has a promotion celebration to share.`
        : 'A promotion celebration has been recorded for your family.',
      promotion: notification,
    };
  });
}

function isRolloutDisabledPromotionError(error: unknown) {
  return error instanceof Error
    && 'code' in error
    && (error as { code?: unknown }).code === '42501'
    && error.message === 'Promotion notifications are not enabled for this gym.';
}

export default function NotificationsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { accessStatus, linkedGyms, linkedMembers, isResolvingAccess, accessError } = useGymAccess();
  const messagesEnabled = isMessagingEnabled() && accessStatus === 'family' && linkedGyms.length > 0;
  const promotionsEnabled = isPromotionNotificationsEnabled()
    && accessStatus === 'family'
    && linkedGyms.some((gym) => gym.gym_id === promotionNotificationsCapability.gymId);
  const canLoad = Boolean(session && !isResolvingAccess && !accessError && (messagesEnabled || promotionsEnabled));
  const scope = `${session?.user.id ?? 'signed-out'}:${accessStatus}:${linkedGyms.map((gym) => gym.gym_id).join(',')}:${isResolvingAccess}:${accessError ?? ''}`;
  const [items, setItems] = React.useState<UnifiedNotification[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [markingPromotionId, setMarkingPromotionId] = React.useState<number | null>(null);
  const requestVersionRef = React.useRef(0);
  const promotionReadLockRef = React.useRef<number | null>(null);
  const membersById = React.useMemo(
    () => new Map(linkedMembers.map((member) => [member.student_id, member])),
    [linkedMembers],
  );

  React.useEffect(() => {
    requestVersionRef.current += 1;
    promotionReadLockRef.current = null;
    setItems([]);
    setIsLoading(true);
    setIsRefreshing(false);
    setErrorMessage(null);
    setMarkingPromotionId(null);
  }, [scope]);

  const load = React.useCallback(async (refresh = false) => {
    const requestVersion = ++requestVersionRef.current;
    if (!canLoad) {
      setItems([]);
      setErrorMessage(null);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setErrorMessage(null);

    const nextItems: UnifiedNotification[] = [];
    const errors: string[] = [];

    if (messagesEnabled) {
      try {
        nextItems.push(...toMessageNotifications(await listFamilyMessagingConversations()));
      } catch {
        errors.push('Messages could not be loaded.');
      }
    }

    if (promotionsEnabled) {
      try {
        nextItems.push(...toPromotionNotifications(await listPromotionNotifications('family'), membersById));
      } catch (error: unknown) {
        errors.push(isRolloutDisabledPromotionError(error)
          ? 'Promotion notifications are temporarily unavailable.'
          : 'Promotion notifications could not be loaded.');
      }
    }

    if (requestVersion !== requestVersionRef.current) return;
    setItems(nextItems.sort(sortNewestFirst));
    setErrorMessage(errors.length > 0 ? errors.join(' ') : null);
    setIsLoading(false);
    setIsRefreshing(false);
  }, [canLoad, membersById, messagesEnabled, promotionsEnabled]);

  useFocusEffect(React.useCallback(() => {
    void load();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [load]));

  const openNotification = React.useCallback(async (item: UnifiedNotification) => {
    if (item.kind === 'message' && item.conversation) {
      router.push({
        pathname: '/messages/[conversationId]',
        params: {
          conversationId: String(item.conversation.conversationId),
          gymId: String(item.conversation.gymId),
          accessRole: 'family',
          canReply: String(item.conversation.canReply),
        },
      });
      return;
    }

    const promotion = item.promotion;
    if (!promotion) return;
    if (promotion.readAt) {
      router.push('/promotion-notifications');
      return;
    }
    if (promotionReadLockRef.current !== null) return;

    promotionReadLockRef.current = promotion.id;
    setMarkingPromotionId(promotion.id);
    setErrorMessage(null);
    try {
      await markPromotionNotificationRead('family', promotion.id);
      setItems((current) => current.map((currentItem) => currentItem.id === item.id
        ? { ...currentItem, unread: false, promotion: { ...promotion, readAt: new Date().toISOString() } }
        : currentItem));
      router.push('/promotion-notifications');
    } catch (error: unknown) {
      setErrorMessage(isRolloutDisabledPromotionError(error)
        ? 'Promotion notifications are temporarily unavailable.'
        : 'This promotion notification is still unread. Try again when you are ready.');
    } finally {
      promotionReadLockRef.current = null;
      setMarkingPromotionId(null);
    }
  }, [router]);

  const unreadCount = items.filter((item) => item.unread).length;
  const unavailable = !canLoad;

  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><FlatList
    data={unavailable || isLoading ? [] : items}
    keyExtractor={(item) => item.id}
    contentContainerClassName="px-5 pb-10"
    showsVerticalScrollIndicator={false}
    refreshing={isRefreshing}
    onRefresh={() => { void load(true); }}
    renderItem={({ item }) => {
      const isMarking = item.kind === 'promotion' && markingPromotionId === item.promotion?.id;
      return <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.unread ? 'Unread ' : ''}${item.kind === 'message' ? 'message' : 'promotion'} notification: ${item.title}`}
        accessibilityState={{ disabled: isMarking }}
        disabled={isMarking}
        onPress={() => { void openNotification(item); }}
        className={`mb-3 overflow-hidden rounded-2xl border border-border bg-card ${isMarking ? 'opacity-60' : 'active:bg-accent'}`}
      >
        <View className={`h-1 ${item.unread ? 'bg-primary' : 'bg-border'}`} />
        <View className="flex-row p-4"><View className={`h-11 w-11 items-center justify-center rounded-xl ${item.kind === 'message' ? 'bg-tertiary/15' : 'bg-primary/15'}`}><LucideIcon name={item.kind === 'message' ? 'MessageCircle' : 'Award'} className={`h-5 w-5 ${item.kind === 'message' ? 'text-tertiary' : 'text-primary'}`} /></View><View className="ml-3 flex-1"><View className="flex-row items-center justify-between gap-3"><Text className="flex-1 font-bold text-foreground" numberOfLines={1}>{item.title}</Text><View className={`rounded-full px-2 py-1 ${item.kind === 'message' ? 'bg-tertiary/15' : 'bg-primary/15'}`}><Text className={`text-xs font-bold ${item.kind === 'message' ? 'text-tertiary' : 'text-primary'}`}>{item.kind === 'message' ? 'Message' : 'Promotion'}</Text></View></View><Text className="mt-1 text-sm leading-5 text-muted-foreground" numberOfLines={2}>{item.detail}</Text><View className="mt-3 flex-row items-center justify-between gap-3"><Text className="text-xs font-medium text-muted-foreground">{formatTimestampDate(item.timestamp)}</Text>{isMarking ? <Text className="text-xs font-semibold text-muted-foreground">Marking read…</Text> : item.unread ? <Text className="text-xs font-bold text-primary">{item.kind === 'message' ? 'Open conversation' : 'Open details'}</Text> : <Text className="text-xs font-semibold text-muted-foreground">Read</Text>}</View></View></View>
      </Pressable>;
    }}
    ListHeaderComponent={<View className="pt-4"><AppHeader title="Notifications" dataLabel="Family" backAction={{ accessibilityLabel: 'Back', onPress: () => { if (router.canGoBack()) router.back(); else router.replace('/my-members'); } }} /><Text className="mt-4 text-3xl font-bold tracking-tight text-foreground">Notifications</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">{unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}.` : 'Messages and promotion celebrations appear here when available.'}</Text>{unavailable ? <View className="mt-6 rounded-2xl border border-border bg-card p-5"><LucideIcon name="Lock" className="h-6 w-6 text-muted-foreground" /><Text className="mt-3 font-bold text-foreground">Notifications unavailable</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">No authorized notification category is available for this account.</Text></View> : null}{isLoading && !unavailable ? <View className="mt-8 items-center"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading notifications…</Text></View> : null}{errorMessage ? <View className="mt-6 rounded-2xl bg-destructive/10 p-4"><Text className="text-sm leading-5 text-destructive">{errorMessage}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry notifications" onPress={() => { void load(); }} className="mt-3 self-start rounded-lg border border-destructive/30 px-3 py-2 active:bg-destructive/10"><Text className="text-sm font-bold text-destructive">Try again</Text></Pressable></View> : null}</View>}
    ListEmptyComponent={!unavailable && !isLoading && !errorMessage ? <View className="mt-8 items-center rounded-2xl border border-dashed border-border bg-card px-6 py-10"><LucideIcon name="Bell" className="h-7 w-7 text-muted-foreground" /><Text className="mt-4 text-lg font-bold text-foreground">You’re all caught up</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">New messages and promotion celebrations will appear here when their features are available.</Text></View> : null}
  /></SafeAreaView>;
}
