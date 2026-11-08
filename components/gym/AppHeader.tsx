import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import LucideIcon, { type IconName } from "@/lib/icons/LucideIcon";
import { useAuth } from "@/providers/AuthProvider";
import { GymLogo } from '@/components/gym/GymLogo';
import { useGymAccess } from '@/providers/GymAccessProvider';

type HeaderAction = "add" | "filter" | "promotions" | "createClass";

function getCoachInitials(metadata: Record<string, unknown> | undefined) {
  const savedInitials = metadata?.initials;
  if (typeof savedInitials === "string") {
    const initials = savedInitials.trim().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toLocaleUpperCase();
    if (initials) return initials;
  }

  const savedName = metadata?.display_name ?? metadata?.full_name;
  if (typeof savedName !== "string") return null;

  const nameParts = savedName.trim().split(/\s+/).filter(Boolean);
  const initials = nameParts
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toLocaleUpperCase();

  return initials || null;
}

export function AppHeader({
  title,
  action,
  secondaryAction,
  dataLabel = "Live gym data",
  logoUrl,
  backAction,
  accountAction,
  announcementUnreadCount = 0,
  onOpenAnnouncements,
}: {
  title: string;
  action?: HeaderAction;
  secondaryAction?: HeaderAction;
  dataLabel?: string;
  logoUrl?: string | null;
  backAction?: {
    accessibilityLabel: string;
    onPress: () => void;
  };
  accountAction?: {
    accessibilityLabel: string;
    icon: IconName;
    onPress: () => void;
  };
  announcementUnreadCount?: number;
  onOpenAnnouncements?: () => void;
}) {
  const router = useRouter();
  const { session } = useAuth();
  const { accessError, accessStatus, isResolvingAccess } = useGymAccess();
  const coachInitials = getCoachInitials(session?.user.user_metadata);
  const canOpenAnnouncements = Boolean(
    session
    && !isResolvingAccess
    && !accessError
    && (accessStatus === 'staff' || accessStatus === 'family')
    && onOpenAnnouncements,
  );
  const safeUnreadCount = Math.max(0, Math.floor(announcementUnreadCount));
  const actionLabel = (item: HeaderAction) =>
    item === "add"
      ? "Add student"
      : item === "promotions"
        ? "Open promotions"
        : item === "createClass"
          ? "Create class"
          : "Filter schedule";
  const actionPath = (item: HeaderAction) =>
    item === "promotions"
      ? "/promotions"
      : item === "add"
        ? "/members/add"
        : item === "createClass"
          ? "/classes/add"
          : "/schedule";
  const actionIcon = (item: HeaderAction) =>
    item === "add" || item === "createClass"
      ? "Plus"
      : item === "promotions"
        ? "Award"
        : "SlidersHorizontal";
  return (
    <View className="mb-6 flex-row items-center justify-between gap-3">
      <View className="flex-1 flex-row items-center gap-3">
        <View className="shrink-0"><GymLogo source={logoUrl} /></View>
        <View className="flex-1">
          <Text numberOfLines={1} className="text-lg font-bold text-foreground">{title}</Text>
          <View className="mt-0.5 flex-row items-center gap-1.5">
            <View className="h-1.5 w-1.5 rounded-full bg-tertiary" />
            <Text className="text-xs text-muted-foreground">{dataLabel}</Text>
          </View>
        </View>
      </View>
      {backAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backAction.accessibilityLabel}
          onPress={backAction.onPress}
          className="h-11 shrink-0 flex-row items-center justify-center gap-1.5 rounded-full border border-border bg-card px-4 active:bg-accent"
        >
          <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
          <Text className="font-bold text-foreground">Back</Text>
        </Pressable>
      ) : action ? (
        <View className="shrink-0 flex-row gap-2">
          {[action, secondaryAction]
            .filter((item): item is HeaderAction => Boolean(item))
            .map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={actionLabel(item)}
                onPress={() => router.push(actionPath(item))}
                className="h-11 w-11 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
              >
                <LucideIcon name={actionIcon(item)} className="h-5 w-5 text-foreground" />
              </Pressable>
            ))}
        </View>
      ) : (
        <View className="shrink-0 flex-row gap-2">
          {canOpenAnnouncements ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={safeUnreadCount > 0 ? `Open announcements, ${safeUnreadCount} unread` : 'Open announcements'}
              onPress={onOpenAnnouncements}
              className="relative h-11 w-11 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
            >
              <LucideIcon name="Bell" className="h-5 w-5 text-foreground" />
              {safeUnreadCount > 0 ? <View className="absolute -right-1 -top-1 min-w-5 items-center rounded-full bg-primary px-1 py-0.5"><Text className="text-[10px] font-bold text-primary-foreground">{safeUnreadCount > 99 ? '99+' : safeUnreadCount}</Text></View> : null}
            </Pressable>
          ) : null}
          {accountAction ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={accountAction.accessibilityLabel}
              onPress={accountAction.onPress}
              className="h-11 w-11 items-center justify-center rounded-full bg-secondary active:opacity-80"
            >
              <LucideIcon name={accountAction.icon} className="h-5 w-5 text-secondary-foreground" />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Settings"
              onPress={() => router.push('/settings')}
              className="h-11 w-11 items-center justify-center rounded-full bg-secondary active:opacity-80"
            >
              {coachInitials ? (
                <Text className="text-sm font-bold text-secondary-foreground">{coachInitials}</Text>
              ) : (
                <LucideIcon name="UserRound" className="h-5 w-5 text-secondary-foreground" />
              )}
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
