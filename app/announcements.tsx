import * as React from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '@/components/gym/AppHeader';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { Text } from '@/components/ui/text';
import {
  listAnnouncements,
  listMyReadReceipts,
  markAnnouncementRead,
  type Announcement,
  type AnnouncementAudience,
} from '@/lib/announcements';
import { formatTimestampDate } from '@/lib/date';
import LucideIcon from '@/lib/icons/LucideIcon';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';

const isDevelopmentPreview = process.env.NODE_ENV === 'development';

type AnnouncementRequestError = {
  code?: string;
  message: string;
  status?: number;
};

function announcementRequestError(error: unknown): AnnouncementRequestError {
  if (!error || typeof error !== 'object') {
    return { message: typeof error === 'string' ? error : 'Unknown announcement request error.' };
  }

  const candidate = error as { code?: unknown; message?: unknown; status?: unknown };
  return {
    ...(typeof candidate.code === 'string' ? { code: candidate.code } : {}),
    message: typeof candidate.message === 'string' ? candidate.message : 'Unknown announcement request error.',
    ...(typeof candidate.status === 'number' ? { status: candidate.status } : {}),
  };
}

function logAnnouncementRequestError(operation: 'listAnnouncements' | 'listMyReadReceipts', error: unknown) {
  if (!isDevelopmentPreview) return;
  // eslint-disable-next-line no-console
  console.warn('[announcements] request failed', {
    operation,
    ...announcementRequestError(error),
  });
}

function readableAnnouncementDate(announcement: Announcement) {
  return formatTimestampDate(announcement.publishedAt ?? announcement.createdAt);
}

export default function AnnouncementsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { accessError, accessStatus, isResolvingAccess, staffRole } = useGymAccess();
  const [announcements, setAnnouncements] = React.useState<Announcement[]>([]);
  const [readAnnouncementIds, setReadAnnouncementIds] = React.useState<Set<number>>(new Set());
  const [selectedAnnouncementId, setSelectedAnnouncementId] = React.useState<number | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [isMarkingReadId, setIsMarkingReadId] = React.useState<number | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const requestIdRef = React.useRef(0);
  const markRequestIdRef = React.useRef(0);
  const hasLoadedRef = React.useRef(false);

  const protectedScope = session?.user.id && !isResolvingAccess && !accessError && (accessStatus === 'staff' || accessStatus === 'family')
    ? `${session.user.id}:${accessStatus}`
    : null;
  const canCreateAnnouncements = Boolean(
    session
    && !isResolvingAccess
    && !accessError
    && accessStatus === 'staff'
    && (staffRole === 'admin' || staffRole === 'coach'),
  );
  const protectedScopeRef = React.useRef<string | null>(protectedScope);

  React.useEffect(() => {
    protectedScopeRef.current = protectedScope;
    requestIdRef.current += 1;
    markRequestIdRef.current += 1;
    hasLoadedRef.current = false;
    setAnnouncements([]);
    setReadAnnouncementIds(new Set());
    setSelectedAnnouncementId(null);
    setLoadError(null);
    setReadError(null);
    setIsMarkingReadId(null);
    setIsRefreshing(false);
    setIsLoading(Boolean(protectedScope));
  }, [protectedScope]);

  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;
      const requestScope = protectedScope;
      const requestId = ++requestIdRef.current;

      if (!requestScope) {
        setIsLoading(false);
        setIsRefreshing(false);
        return () => {
          isActive = false;
        };
      }

      async function loadAnnouncements() {
        if (!hasLoadedRef.current) setIsLoading(true);
        setLoadError(null);

        try {
          const [announcementsResult, readReceiptsResult] = await Promise.allSettled([
            listAnnouncements(),
            listMyReadReceipts(),
          ]);
          if (announcementsResult.status === 'rejected') {
            logAnnouncementRequestError('listAnnouncements', announcementsResult.reason);
          }
          if (readReceiptsResult.status === 'rejected') {
            logAnnouncementRequestError('listMyReadReceipts', readReceiptsResult.reason);
          }
          if (announcementsResult.status === 'rejected') throw announcementsResult.reason;
          if (readReceiptsResult.status === 'rejected') throw readReceiptsResult.reason;
          if (!isActive || requestId !== requestIdRef.current || requestScope !== protectedScopeRef.current) return;

          const nextAnnouncements = announcementsResult.value;
          const readReceipts = readReceiptsResult.value;
          setAnnouncements(nextAnnouncements);
          setReadAnnouncementIds(new Set(readReceipts.map((receipt) => receipt.announcementId)));
          setSelectedAnnouncementId((currentId) => (
            currentId && !nextAnnouncements.some((announcement) => announcement.id === currentId)
              ? null
              : currentId
          ));
          hasLoadedRef.current = true;
        } catch {
          if (!isActive || requestId !== requestIdRef.current || requestScope !== protectedScopeRef.current) return;
          setAnnouncements([]);
          setReadAnnouncementIds(new Set());
          setSelectedAnnouncementId(null);
          setLoadError('Announcements could not be loaded. Check your connection and try again.');
        } finally {
          if (isActive && requestId === requestIdRef.current && requestScope === protectedScopeRef.current) {
            setIsLoading(false);
            setIsRefreshing(false);
          }
        }
      }

      void loadAnnouncements();
      return () => {
        isActive = false;
      };
    }, [protectedScope, refreshKey]),
  );

  const refreshAnnouncements = React.useCallback(() => {
    if (!protectedScope) return;
    setIsRefreshing(true);
    setRefreshKey((key) => key + 1);
  }, [protectedScope]);

  const openAnnouncement = React.useCallback(async (announcement: Announcement) => {
    const requestScope = protectedScope;
    if (!requestScope) return;

    setSelectedAnnouncementId(announcement.id);
    setReadError(null);
    if (readAnnouncementIds.has(announcement.id)) return;

    const markRequestId = ++markRequestIdRef.current;
    setIsMarkingReadId(announcement.id);
    try {
      await markAnnouncementRead(announcement.id);
      if (markRequestId !== markRequestIdRef.current || requestScope !== protectedScopeRef.current) return;
      setReadAnnouncementIds((currentIds) => new Set([...currentIds, announcement.id]));
    } catch {
      if (markRequestId !== markRequestIdRef.current || requestScope !== protectedScopeRef.current) return;
      setReadError('This announcement is still unread. Try again when you are ready.');
    } finally {
      if (markRequestId === markRequestIdRef.current && requestScope === protectedScopeRef.current) {
        setIsMarkingReadId(null);
      }
    }
  }, [protectedScope, readAnnouncementIds]);

  const selectedAnnouncement = React.useMemo(
    () => announcements.find((announcement) => announcement.id === selectedAnnouncementId) ?? null,
    [announcements, selectedAnnouncementId],
  );

  if (selectedAnnouncement) {
    return (
      <AnnouncementReader
        announcement={selectedAnnouncement}
        isMarkingRead={isMarkingReadId === selectedAnnouncement.id}
        readError={readError}
        unread={!readAnnouncementIds.has(selectedAnnouncement.id)}
        onBack={() => {
          setSelectedAnnouncementId(null);
          setReadError(null);
        }}
        onRetryMarkRead={() => { void openAnnouncement(selectedAnnouncement); }}
      />
    );
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <FlatList
        data={loadError || isLoading ? [] : announcements}
        keyExtractor={(announcement) => String(announcement.id)}
        contentContainerClassName="px-5 pb-10"
        showsVerticalScrollIndicator={false}
        refreshing={isRefreshing}
        onRefresh={refreshAnnouncements}
        renderItem={({ item }) => (
          <AnnouncementCard
            announcement={item}
            unread={!readAnnouncementIds.has(item.id)}
            onPress={() => { void openAnnouncement(item); }}
          />
        )}
        ListHeaderComponent={
          <View className="pt-4">
            <View className="flex-row items-center justify-between">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                onPress={() => {
                  if (router.canGoBack()) router.back();
                  else if (accessStatus === 'family') router.replace('/my-members');
                  else router.replace('/(tabs)');
                }}
                className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
              >
                <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
              </Pressable>
              <Text className="text-lg font-bold text-foreground">Announcements</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh announcements"
                disabled={isRefreshing || isLoading}
                onPress={refreshAnnouncements}
                className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent disabled:opacity-50"
              >
                <LucideIcon name="RefreshCw" className="h-5 w-5 text-foreground" />
              </Pressable>
            </View>

            <View className="mt-6">
              <AppHeader
                title="GRAU"
                dataLabel="Academy updates"
                accountAction={accessStatus === 'family' ? {
                  accessibilityLabel: 'Open family account menu',
                  icon: 'CircleUserRound',
                  onPress: () => router.push('/my-members'),
                } : undefined}
              />
              <Text className="text-3xl font-bold tracking-tight text-foreground">Announcements</Text>
              <Text className="mt-2 text-sm leading-5 text-muted-foreground">Stay up to date with your academy.</Text>
              {canCreateAnnouncements ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Create a new announcement" onPress={() => router.push('/announcements/create')} className="mt-5 flex-row items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3.5 active:opacity-90">
                  <LucideIcon name="Plus" className="h-5 w-5 text-primary-foreground" />
                  <Text className="font-bold text-primary-foreground">New Announcement</Text>
                </Pressable>
              ) : null}
            </View>
            {isLoading ? <LoadingState /> : null}
            {loadError ? <ErrorState onRetry={refreshAnnouncements} /> : null}
          </View>
        }
        ListEmptyComponent={!isLoading && !loadError ? <EmptyState /> : null}
      />
    </SafeAreaView>
  );
}

function AnnouncementCard({ announcement, unread, onPress }: { announcement: Announcement; unread: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread ' : ''}${announcement.audience} announcement: ${announcement.title}`}
      accessibilityHint="Opens the full announcement"
      onPress={onPress}
      className="mt-4 overflow-hidden rounded-2xl border border-border bg-card active:bg-accent"
    >
      <View className="flex-row items-start px-4 pb-4 pt-4">
        {unread ? <View accessibilityLabel="Unread announcement" className="mr-3 mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" /> : <View className="mr-3 w-2.5" />}
        <View className="flex-1">
          <Text className="text-base font-bold text-foreground" numberOfLines={2}>{announcement.title}</Text>
          <Text className="mt-1.5 text-xs font-medium text-muted-foreground">{readableAnnouncementDate(announcement)}</Text>
          <Text className="mt-3 text-sm leading-5 text-muted-foreground" numberOfLines={3}>{announcement.body}</Text>
          <View className="mt-4 flex-row items-center justify-between">
            <AudienceBadge audience={announcement.audience} />
            <LucideIcon name="ChevronRight" className="h-5 w-5 text-muted-foreground" />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function AnnouncementReader({
  announcement,
  unread,
  isMarkingRead,
  readError,
  onBack,
  onRetryMarkRead,
}: {
  announcement: Announcement;
  unread: boolean;
  isMarkingRead: boolean;
  readError: string | null;
  onBack: () => void;
  onRetryMarkRead: () => void;
}) {
  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView contentContainerClassName="px-5 pb-10" showsVerticalScrollIndicator={false}>
        <View className="pt-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to announcements"
            onPress={onBack}
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
          >
            <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
          </Pressable>

          <View className="mt-8 border-l-2 border-primary pl-4">
            <View className="flex-row items-center gap-2">
              <AudienceBadge audience={announcement.audience} />
              {unread ? <Text className="text-xs font-semibold text-primary">Unread</Text> : null}
            </View>
            <Text className="mt-4 text-3xl font-bold leading-9 tracking-tight text-foreground">{announcement.title}</Text>
            <Text className="mt-3 text-sm font-medium text-muted-foreground">{readableAnnouncementDate(announcement)}</Text>
          </View>

          <View className="mt-8 rounded-2xl border border-border bg-card px-5 py-6">
            <Text className="text-base leading-7 text-foreground">{announcement.body}</Text>
          </View>

          {isMarkingRead ? (
            <View className="mt-5 flex-row items-center gap-2">
              <LoadingIndicator size="small" />
              <Text className="text-sm text-muted-foreground">Marking as read…</Text>
            </View>
          ) : null}
          {readError ? (
            <View className="mt-5 rounded-xl bg-destructive/10 p-4">
              <Text className="text-sm leading-5 text-destructive">{readError}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Try marking announcement as read again" onPress={onRetryMarkRead} className="mt-3 self-start rounded-lg border border-destructive/30 px-3 py-2 active:bg-destructive/10">
                <Text className="text-sm font-bold text-destructive">Try again</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AudienceBadge({ audience }: { audience: AnnouncementAudience }) {
  if (audience === 'Everyone') {
    return <View className="rounded-full bg-secondary px-2.5 py-1"><Text className="text-xs font-bold text-secondary-foreground">Everyone</Text></View>;
  }
  if (audience === 'Kids') {
    return <View className="rounded-full bg-tertiary/15 px-2.5 py-1"><Text className="text-xs font-bold text-tertiary">Kids</Text></View>;
  }
  return <View className="rounded-full bg-primary/10 px-2.5 py-1"><Text className="text-xs font-bold text-primary">Adults</Text></View>;
}

function LoadingState() {
  return (
    <View className="items-center py-24">
      <LoadingIndicator />
      <Text className="mt-3 text-sm text-muted-foreground">Loading announcements…</Text>
    </View>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="mt-8 items-center rounded-3xl bg-destructive/10 px-6 py-10">
      <LucideIcon name="CircleAlert" className="mb-3 h-7 w-7 text-destructive" />
      <Text className="text-center font-bold text-foreground">Announcements unavailable</Text>
      <Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">Announcements could not be loaded. Check your connection and try again.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry announcement loading" onPress={onRetry} className="mt-5 rounded-xl bg-primary px-4 py-2.5 active:opacity-90">
        <Text className="font-bold text-primary-foreground">Retry</Text>
      </Pressable>
    </View>
  );
}

function EmptyState() {
  return (
    <View className="mt-12 items-center rounded-3xl border border-border bg-card px-6 py-12">
      <View className="h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <LucideIcon name="Bell" className="h-6 w-6 text-primary" />
      </View>
      <Text className="mt-5 text-lg font-bold text-foreground">No announcements yet.</Text>
      <Text className="mt-2 max-w-[280px] text-center text-sm leading-5 text-muted-foreground">When your academy shares an update, you’ll find it here.</Text>
    </View>
  );
}
