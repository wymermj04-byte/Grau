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
import { useGymAccess } from '@/providers/GymAccessProvider';

function notificationAudience(
  accessStatus: ReturnType<typeof useGymAccess>['accessStatus'],
): PromotionNotificationAudience | null {
  if (accessStatus === 'family') return 'family';
  if (accessStatus === 'staff') return 'staff';
  return null;
}

function notificationCopy(notification: PromotionNotification, audience: PromotionNotificationAudience) {
  if (notification.eventKind === 'promotion_celebration') {
    return {
      title: 'Promotion recorded',
      detail: audience === 'family'
        ? 'A promotion has been recorded for one of your linked members.'
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

export default function PromotionNotificationsScreen() {
  const router = useRouter();
  const { accessStatus, gymId, linkedGyms, staffRole } = useGymAccess();
  const audience = notificationAudience(accessStatus);
  const hasGym4Access = audience === 'family'
    ? linkedGyms.some((gym) => gym.gym_id === promotionNotificationsCapability.gymId)
    : audience === 'staff'
      ? gymId === promotionNotificationsCapability.gymId && (staffRole === 'admin' || staffRole === 'coach')
      : false;
  const canLoad = isPromotionNotificationsEnabled() && audience !== null && hasGym4Access;
  const [notifications, setNotifications] = React.useState<PromotionNotification[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [markingId, setMarkingId] = React.useState<number | null>(null);
  const requestVersionRef = React.useRef(0);

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
    } catch {
      if (requestVersion !== requestVersionRef.current) return;
      setNotifications([]);
      setLoadError('Notifications could not be loaded. Check your connection and try again.');
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
    if (!canLoad || !audience || notification.readAt || markingId !== null) return;
    setMarkingId(notification.id);
    try {
      await markPromotionNotificationRead(audience, notification.id);
      setNotifications((current) => current.map((item) => (
        item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item
      )));
    } catch {
      setLoadError('This notification is still unread. Try again when you are ready.');
    } finally {
      setMarkingId(null);
    }
  }, [audience, canLoad, markingId]);

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
