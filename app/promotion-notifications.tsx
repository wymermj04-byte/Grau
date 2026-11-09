import * as React from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/gym/AppHeader';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import {
  listPromotionNotifications,
  markPromotionNotificationRead,
  type PromotionNotification,
  type PromotionNotificationAudience,
} from '@/lib/promotion-notifications';
import { isPromotionNotificationsEnabled, promotionNotificationsCapability } from '@/lib/promotion-notifications-feature';
import { formatTimestampDate } from '@/lib/date';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess, type LinkedMember } from '@/providers/GymAccessProvider';

function notificationAudience(
  accessStatus: ReturnType<typeof useGymAccess>['accessStatus'],
): PromotionNotificationAudience | null {
  if (accessStatus === 'family') return 'family';
  return null;
}

function notificationCopy(notification: PromotionNotification, audience: PromotionNotificationAudience) {
  if (notification.eventKind === 'promotion_celebration') {
    return {
      title: 'Promotion celebration',
      detail: audience === 'family'
        ? 'A promotion celebration has been recorded for your family.'
        : 'An official Gym 4 promotion has been recorded.',
    };
  }
  if (notification.eventKind === 'five_remaining') {
    return {
      title: 'Five classes remaining',
      detail: 'A Gym 4 member is five qualifying classes from the next promotion milestone.',
    };
  }
  return {
    title: 'Promotion review ready',
    detail: 'A Gym 4 member has reached a promotion review milestone.',
  };
}

function memberName(member: LinkedMember | undefined) {
  const name = [member?.first_name, member?.last_name].filter(Boolean).join(' ').trim();
  return name || null;
}

function currentRank(member: LinkedMember | undefined) {
  if (!member?.belt_rank) return null;
  const stripeCount = typeof member.stripes === 'number' && Number.isSafeInteger(member.stripes) && member.stripes >= 0
    ? member.stripes
    : null;
  const stripes = stripeCount !== null
    ? ` · ${stripeCount} ${stripeCount === 1 ? 'stripe' : 'stripes'}`
    : '';
  return `${member.belt_rank} belt${stripes}`;
}

function isRolloutDisabledError(error: unknown) {
  return error instanceof Error
    && 'code' in error
    && (error as { code?: unknown }).code === '42501'
    && error.message === 'Promotion notifications are not enabled for this gym.';
}

export default function PromotionNotificationsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { accessStatus, linkedGyms, linkedMembers, isResolvingAccess, accessError } = useGymAccess();
  const audience = notificationAudience(accessStatus);
  const hasGym4Access = audience === 'family'
    && linkedGyms.some((gym) => gym.gym_id === promotionNotificationsCapability.gymId);
  const canLoad = Boolean(session && !isResolvingAccess && !accessError && isPromotionNotificationsEnabled() && audience !== null && hasGym4Access);
  const [notifications, setNotifications] = React.useState<PromotionNotification[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [markingId, setMarkingId] = React.useState<number | null>(null);
  const requestVersionRef = React.useRef(0);
  const markingRef = React.useRef<number | null>(null);
  const scope = `${session?.user.id ?? 'signed-out'}:${accessStatus}:${linkedGyms.map((gym) => gym.gym_id).join(',')}:${isResolvingAccess}:${accessError ?? ''}`;
  const membersById = React.useMemo(
    () => new Map(linkedMembers.map((member) => [member.student_id, member])),
    [linkedMembers],
  );

  React.useEffect(() => {
    requestVersionRef.current += 1;
    markingRef.current = null;
    setNotifications([]);
    setIsLoading(true);
    setIsRefreshing(false);
    setLoadError(null);
    setMarkingId(null);
  }, [scope]);

  const loadNotifications = React.useCallback(async (refresh = false) => {
    const requestVersion = ++requestVersionRef.current;
    if (!canLoad || !audience) {
      setNotifications([]);
      setLoadError(null);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError(null);
    try {
      const nextNotifications = await listPromotionNotifications(audience);
      if (requestVersion !== requestVersionRef.current) return;
      setNotifications(nextNotifications);
    } catch (error: unknown) {
      if (requestVersion !== requestVersionRef.current) return;
      setNotifications([]);
      setLoadError(isRolloutDisabledError(error)
        ? 'Promotion notifications are temporarily unavailable.'
        : 'Notifications could not be loaded. Check your connection and try again.');
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [audience, canLoad]);

  useFocusEffect(React.useCallback(() => {
    void loadNotifications();
    return () => {
      requestVersionRef.current += 1;
    };
  }, [loadNotifications]));

  const markRead = React.useCallback(async (notification: PromotionNotification) => {
    if (!canLoad || !audience || notification.readAt || markingRef.current !== null) return;
    markingRef.current = notification.id;
    setMarkingId(notification.id);
    try {
      await markPromotionNotificationRead(audience, notification.id);
      setNotifications((current) => current.map((item) => (
        item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item
      )));
    } catch (error: unknown) {
      setLoadError(isRolloutDisabledError(error)
        ? 'Promotion notifications are temporarily unavailable.'
        : 'This notification is still unread. Try again when you are ready.');
    } finally {
      markingRef.current = null;
      setMarkingId(null);
    }
  }, [audience, canLoad]);

  const unreadCount = notifications.filter((notification) => !notification.readAt).length;
  const unavailable = !canLoad;

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <FlatList
        data={unavailable || isLoading || loadError ? [] : notifications}
        keyExtractor={(notification) => String(notification.id)}
        contentContainerClassName="px-5 pb-10"
        showsVerticalScrollIndicator={false}
        refreshing={isRefreshing}
        onRefresh={() => { void loadNotifications(true); }}
        renderItem={({ item }) => {
          const unread = !item.readAt;
          const isMarking = markingId === item.id;
          const copy = notificationCopy(item, audience ?? 'staff');
          const member = audience === 'family' ? membersById.get(item.studentId) : undefined;
          const name = memberName(member);
          const rank = currentRank(member);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${unread ? 'Unread ' : ''}${copy.title.toLowerCase()} from ${formatTimestampDate(item.createdAt)}`}
              accessibilityState={{ disabled: isMarking }}
              disabled={!unread || isMarking}
              onPress={() => { void markRead(item); }}
              className={`mb-3 overflow-hidden rounded-2xl border border-border bg-card ${unread ? 'active:bg-accent' : 'opacity-75'}`}
            >
              <View className={`h-1 ${unread ? 'bg-primary' : 'bg-border'}`} />
              <View className="flex-row p-4">
                <View className="h-11 w-11 items-center justify-center rounded-xl bg-primary/15">
                  <LucideIcon name="Award" className="h-5 w-5 text-primary" />
                </View>
                <View className="ml-3 flex-1">
                  <View className="flex-row items-center justify-between gap-3">
                    <Text className="flex-1 font-bold text-card-foreground">{copy.title}</Text>
                    {unread ? <View className="rounded-full bg-primary/15 px-2 py-1"><Text className="text-xs font-bold text-primary">New</Text></View> : null}
                  </View>
                  <Text className="mt-1 text-sm leading-5 text-muted-foreground">
                    {copy.detail}
                  </Text>
                  {audience === 'family' && name ? <Text className="mt-3 text-sm font-semibold text-foreground">{name}</Text> : null}
                  {audience === 'family' && rank ? <Text className="mt-1 text-xs leading-5 text-muted-foreground">Current recorded rank: {rank}</Text> : null}
                  {audience === 'family' && !name && !rank ? <Text className="mt-3 text-xs leading-5 text-muted-foreground">Current member details are unavailable for this notification.</Text> : null}
                  <View className="mt-3 flex-row items-center justify-between">
                    <Text className="text-xs font-medium text-muted-foreground">{formatTimestampDate(item.createdAt)}</Text>
                    {isMarking ? <Text className="text-xs font-semibold text-muted-foreground">Marking read…</Text> : unread ? <Text className="text-xs font-bold text-primary">Tap to mark read</Text> : <Text className="text-xs font-semibold text-muted-foreground">Read</Text>}
                  </View>
                </View>
              </View>
            </Pressable>
          );
        }}
        ListHeaderComponent={
          <View className="pt-4">
            <AppHeader
              title="Promotion notifications"
              dataLabel="Gym 4"
              backAction={{
                accessibilityLabel: 'Back',
                onPress: () => {
                  if (router.canGoBack()) router.back();
                  else if (audience === 'family') router.replace('/my-members');
                  else router.replace('/(tabs)');
                },
              }}
            />
            <Text className="mt-4 text-3xl font-bold tracking-tight text-foreground">Promotion notifications</Text>
            <Text className="mt-2 text-sm leading-5 text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} unread celebration${unreadCount === 1 ? '' : 's'}.` : 'Your promotion updates will appear here.'}
            </Text>
            {unavailable ? <View className="mt-6 rounded-2xl border border-border bg-card p-5"><LucideIcon name="Lock" className="h-6 w-6 text-muted-foreground" /><Text className="mt-3 font-bold text-foreground">Notifications unavailable</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">{promotionNotificationsCapability.reason}</Text></View> : null}
            {isLoading && !unavailable ? <View className="mt-8 items-center"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading notifications…</Text></View> : null}
            {loadError ? <View className="mt-6 rounded-2xl bg-destructive/10 p-4"><Text className="text-sm leading-5 text-destructive">{loadError}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry notifications" onPress={() => { void loadNotifications(); }} className="mt-3 self-start rounded-lg border border-destructive/30 px-3 py-2 active:bg-destructive/10"><Text className="text-sm font-bold text-destructive">Try again</Text></Pressable></View> : null}
          </View>
        }
        ListEmptyComponent={!unavailable && !isLoading && !loadError ? <View className="mt-8 items-center rounded-2xl border border-dashed border-border bg-card px-6 py-10"><LucideIcon name="Award" className="h-7 w-7 text-muted-foreground" /><Text className="mt-4 text-lg font-bold text-foreground">No promotion notifications yet</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">New qualifying celebrations will appear here after the Gym 4 rollout is enabled.</Text></View> : null}
      />
    </SafeAreaView>
  );
}
