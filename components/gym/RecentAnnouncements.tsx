import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { type Announcement } from '@/lib/announcements';
import { formatTimestampDate } from '@/lib/date';
import LucideIcon from '@/lib/icons/LucideIcon';

type RecentAnnouncementsProps = {
  announcements: Announcement[];
  readAnnouncementIds: Set<number>;
  isLoading: boolean;
  error: string | null;
  onOpenAnnouncements: () => void;
  onCreateAnnouncement?: () => void;
};

function announcementDate(announcement: Announcement) {
  return formatTimestampDate(announcement.publishedAt ?? announcement.createdAt);
}

export function RecentAnnouncements({
  announcements,
  readAnnouncementIds,
  isLoading,
  error,
  onOpenAnnouncements,
  onCreateAnnouncement,
}: RecentAnnouncementsProps) {
  const recentAnnouncements = announcements.slice(0, 2);

  return (
    <View className="mt-8">
      <View className="mb-3 flex-row items-center justify-between gap-3">
        <View className="flex-row items-center gap-2">
          <LucideIcon name="Megaphone" className="h-4 w-4 text-primary" />
          <Text className="text-lg font-bold tracking-tight text-foreground">Recent announcements</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View all announcements"
          onPress={onOpenAnnouncements}
          className="rounded-lg px-2 py-1 active:bg-accent"
        >
          <Text className="text-sm font-bold text-primary">View all</Text>
        </Pressable>
      </View>

      {onCreateAnnouncement ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create a new announcement"
          onPress={onCreateAnnouncement}
          className="mb-3 flex-row items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 active:opacity-90"
        >
          <LucideIcon name="Plus" className="h-5 w-5 text-primary-foreground" />
          <Text className="font-bold text-primary-foreground">New Announcement</Text>
        </Pressable>
      ) : null}

      {isLoading ? (
        <View className="flex-row items-center rounded-2xl border border-border bg-card px-4 py-4">
          <LucideIcon name="LoaderCircle" className="h-4 w-4 text-muted-foreground" />
          <Text className="ml-2 text-sm text-muted-foreground">Loading announcements…</Text>
        </View>
      ) : error ? (
        <View className="rounded-2xl border border-border bg-card px-4 py-4">
          <Text className="text-sm font-medium text-foreground">Announcements are unavailable.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Open announcements" onPress={onOpenAnnouncements} className="mt-2 self-start rounded-lg px-1 py-1 active:bg-accent">
            <Text className="text-sm font-bold text-primary">Open announcements</Text>
          </Pressable>
        </View>
      ) : recentAnnouncements.length === 0 ? (
        <View className="rounded-2xl border border-dashed border-border bg-card px-4 py-5">
          <Text className="text-sm font-medium text-foreground">No announcements yet.</Text>
          <Text className="mt-1 text-sm leading-5 text-muted-foreground">Updates from your academy will appear here.</Text>
        </View>
      ) : (
        <View className="overflow-hidden rounded-2xl border border-border bg-card">
          {recentAnnouncements.map((announcement, index) => {
            const isUnread = !readAnnouncementIds.has(announcement.id);
            return (
              <Pressable
                key={announcement.id}
                accessibilityRole="button"
                accessibilityLabel={`Open announcement: ${announcement.title}${isUnread ? ', unread' : ''}`}
                onPress={onOpenAnnouncements}
                className={`flex-row items-center px-4 py-4 active:bg-accent ${index > 0 ? 'border-t border-border' : ''}`}
              >
                <View className={`mr-3 h-2 w-2 rounded-full bg-primary ${isUnread ? 'opacity-100' : 'opacity-0'}`} />
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className={`text-base tracking-tight text-foreground ${isUnread ? 'font-bold' : 'font-semibold'}`}>{announcement.title}</Text>
                  <Text numberOfLines={1} className="mt-1 text-xs text-muted-foreground">{announcementDate(announcement)} · {announcement.audience}</Text>
                </View>
                <LucideIcon name="ChevronRight" className="ml-3 h-4 w-4 text-muted-foreground" />
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
