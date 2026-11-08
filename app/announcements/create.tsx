import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { AppHeader } from '@/components/gym/AppHeader';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { Text } from '@/components/ui/text';
import { ThemedTextInput } from '@/components/ui/themed-text-input';
import { createAnnouncement, type AnnouncementAudienceInput } from '@/lib/announcements';
import LucideIcon from '@/lib/icons/LucideIcon';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';

const TITLE_LIMIT = 160;
const MESSAGE_LIMIT = 10_000;

type AudienceOption = {
  value: AnnouncementAudienceInput;
  label: 'Everyone' | 'Kids' | 'Adults';
  description: string;
};

const audiences: AudienceOption[] = [
  { value: 'all', label: 'Everyone', description: 'All academy members' },
  { value: 'kids', label: 'Kids', description: 'Kids program families' },
  { value: 'adults', label: 'Adults', description: 'Adult program members' },
];

export default function CreateAnnouncementScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { accessError, accessStatus, isResolvingAccess, staffRole } = useGymAccess();
  const [title, setTitle] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [audience, setAudience] = React.useState<AnnouncementAudienceInput | null>(null);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = React.useState<string | null>(null);
  const [isPublishing, setIsPublishing] = React.useState(false);
  const publishRequestIdRef = React.useRef(0);
  const successNavigationTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmedTitle = title.trim();
  const trimmedMessage = message.trim();
  const hasActivePublisherRole = Boolean(
    session
    && !isResolvingAccess
    && !accessError
    && accessStatus === 'staff'
    && (staffRole === 'admin' || staffRole === 'coach'),
  );
  const publisherScope = hasActivePublisherRole && session?.user.id
    ? `${session.user.id}:${staffRole}`
    : null;
  const publisherScopeRef = React.useRef<string | null>(publisherScope);
  const isTitleValid = trimmedTitle.length >= 1 && trimmedTitle.length <= TITLE_LIMIT;
  const isMessageValid = trimmedMessage.length >= 1 && trimmedMessage.length <= MESSAGE_LIMIT;
  const isPublishEnabled = isTitleValid && isMessageValid && Boolean(audience) && hasActivePublisherRole && !isPublishing;

  React.useEffect(() => {
    publisherScopeRef.current = publisherScope;
    publishRequestIdRef.current += 1;
    setIsPublishing(false);
    setPublishError(null);
    setPublishSuccess(null);
    if (successNavigationTimeoutRef.current) {
      clearTimeout(successNavigationTimeoutRef.current);
      successNavigationTimeoutRef.current = null;
    }
    if (!publisherScope) {
      setTitle('');
      setMessage('');
      setAudience(null);
    }
  }, [publisherScope]);

  React.useEffect(() => () => {
    if (successNavigationTimeoutRef.current) clearTimeout(successNavigationTimeoutRef.current);
  }, []);

  const updateTitle = (value: string) => {
    setTitle(value.slice(0, TITLE_LIMIT));
    setPublishError(null);
    setPublishSuccess(null);
  };

  const updateMessage = (value: string) => {
    setMessage(value.slice(0, MESSAGE_LIMIT));
    setPublishError(null);
    setPublishSuccess(null);
  };

  const handlePublish = async () => {
    const requestScope = publisherScope;
    if (!isPublishEnabled || !requestScope || !audience) return;

    const requestId = ++publishRequestIdRef.current;
    setIsPublishing(true);
    setPublishError(null);

    try {
      await createAnnouncement(trimmedTitle, trimmedMessage, audience);
      if (requestId !== publishRequestIdRef.current || requestScope !== publisherScopeRef.current) return;
      setTitle('');
      setMessage('');
      setAudience(null);
      setPublishSuccess('Announcement published. Returning to announcements…');
      successNavigationTimeoutRef.current = setTimeout(() => {
        if (requestId === publishRequestIdRef.current && requestScope === publisherScopeRef.current) {
          router.replace('/announcements');
        }
      }, 550);
    } catch {
      if (requestId !== publishRequestIdRef.current || requestScope !== publisherScopeRef.current) return;
      setPublishError('The announcement could not be published. Check your connection and try again.');
    } finally {
      if (requestId === publishRequestIdRef.current && requestScope === publisherScopeRef.current) {
        setIsPublishing(false);
      }
    }
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pb-10"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center justify-between pt-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to announcements"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/announcements');
            }}
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
          >
            <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
          </Pressable>
          <Text className="text-lg font-bold text-foreground">Create announcement</Text>
          <View className="h-10 w-10" />
        </View>

        <View className="pt-6">
          <AppHeader title="GRAU" dataLabel="Communication Center" />
          <Text className="text-3xl font-bold tracking-tight text-foreground">Create Announcement</Text>
          <Text className="mt-2 max-w-xl text-sm leading-5 text-muted-foreground">Share a clear update with the people who need it.</Text>
        </View>

        <View className="mt-7 rounded-3xl border border-border bg-card p-5">
          <FormFieldHeader label="Announcement Title" count={title.length} limit={TITLE_LIMIT} />
          <ThemedTextInput
            accessibilityLabel="Announcement Title"
            value={title}
            onChangeText={updateTitle}
            maxLength={TITLE_LIMIT}
            autoCapitalize="sentences"
            placeholder="What should your academy know?"
            returnKeyType="next"
            className="mt-2 rounded-2xl border border-border bg-background px-4 py-3.5 text-base text-foreground"
          />

          <View className="mt-7">
            <Text className="text-base font-bold text-foreground">Audience</Text>
            <Text className="mt-1 text-sm leading-5 text-muted-foreground">Choose who should receive this update.</Text>
            <View className="mt-4 gap-3">
              {audiences.map((option) => {
                const selected = audience === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${option.label}: ${option.description}`}
                    onPress={() => {
                      setAudience(option.value);
                      setPublishError(null);
                      setPublishSuccess(null);
                    }}
                    className={`flex-row items-center rounded-2xl border px-4 py-3.5 ${selected ? 'border-primary bg-primary/10' : 'border-border bg-background active:bg-accent'}`}
                  >
                    <View className={`h-5 w-5 items-center justify-center rounded-full border ${selected ? 'border-primary bg-primary' : 'border-muted-foreground'}`}>
                      {selected ? <View className="h-2 w-2 rounded-full bg-primary-foreground" /> : null}
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="font-bold text-foreground">{option.label}</Text>
                      <Text className="mt-0.5 text-sm text-muted-foreground">{option.description}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="mt-7">
            <FormFieldHeader label="Message" count={message.length} limit={MESSAGE_LIMIT} />
            <ThemedTextInput
              accessibilityLabel="Message"
              value={message}
              onChangeText={updateMessage}
              maxLength={MESSAGE_LIMIT}
              multiline
              textAlignVertical="top"
              autoCapitalize="sentences"
              placeholder="Write the announcement your members need."
              className="mt-2 min-h-48 rounded-2xl border border-border bg-background px-4 py-3.5 text-base leading-6 text-foreground"
            />
          </View>

          {publishError ? (
            <View className="mt-5 flex-row gap-3 rounded-2xl bg-destructive/10 px-4 py-3.5">
              <LucideIcon name="CircleAlert" className="mt-0.5 h-5 w-5 text-destructive" />
              <Text className="flex-1 text-sm leading-5 text-foreground">{publishError}</Text>
            </View>
          ) : null}

          {publishSuccess ? (
            <View className="mt-5 flex-row gap-3 rounded-2xl bg-tertiary/15 px-4 py-3.5">
              <LucideIcon name="CircleCheck" className="mt-0.5 h-5 w-5 text-tertiary" />
              <Text className="flex-1 text-sm leading-5 text-foreground">{publishSuccess}</Text>
            </View>
          ) : null}

          {isPublishing ? (
            <View className="mt-5 flex-row items-center gap-2">
              <LoadingIndicator size="small" />
              <Text className="text-sm text-muted-foreground">Publishing announcement…</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Publish Announcement"
            accessibilityState={{ disabled: !isPublishEnabled }}
            disabled={!isPublishEnabled}
            onPress={() => { void handlePublish(); }}
            className={`mt-7 flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4 ${isPublishEnabled ? 'active:opacity-90' : 'opacity-50'}`}
          >
            {isPublishing ? <LoadingIndicator tone="on-primary" size="small" /> : <LucideIcon name="Send" className="h-5 w-5 text-primary-foreground" />}
            <Text className="font-bold text-primary-foreground">{isPublishing ? 'Publishing…' : 'Publish Announcement'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel and return to announcements"
            onPress={() => router.replace('/announcements')}
            className="mt-3 items-center justify-center rounded-2xl border border-border bg-card py-4 active:bg-accent"
          >
            <Text className="font-bold text-foreground">Cancel</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FormFieldHeader({ label, count, limit }: { label: string; count: number; limit: number }) {
  return (
    <View className="flex-row items-baseline justify-between gap-4">
      <Text className="text-base font-bold text-foreground">{label}</Text>
      <Text className="text-xs font-medium text-muted-foreground">{count.toLocaleString()} / {limit.toLocaleString()}</Text>
    </View>
  );
}
