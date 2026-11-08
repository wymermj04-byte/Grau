import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import { AppHeader } from '@/components/gym/AppHeader';
import { PageContent } from '@/components/layout/PageContent';
import { database } from '@/lib/database';

type GymClass = {
  id: number;
  class_name: string;
  coach_name: string | null;
  class_date: string;
  start_time: string;
  end_time: string;
  is_active: boolean | null;
  status: string | null;
};

function formatTime(value: string) {
  const [hour = '0', minute = '00'] = value.split(':');
  return new Date(2000, 0, 1, Number(hour), Number(minute)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatClassDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return 'Date unavailable';
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function CheckInScreen() {
  const router = useRouter();
  const [activeClass, setActiveClass] = React.useState<GymClass | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;
      setIsLoading(true);
      setErrorMessage(null);
      setActiveClass(null);

      async function loadActiveClass() {
        try {
          const classes = await database.listClasses<GymClass>();
          const currentClass = classes.find((gymClass) => gymClass.is_active === true && gymClass.status?.trim().toLowerCase() === 'in progress') ?? null;
          if (isActive) setActiveClass(currentClass);
        } catch {
          if (isActive) setErrorMessage('Live check-in data could not be loaded. Try again.');
        } finally {
          if (isActive) setIsLoading(false);
        }
      }

      void loadActiveClass();
      return () => {
        isActive = false;
      };
    }, []),
  );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="pb-8" showsVerticalScrollIndicator={false}>
        <PageContent className="px-5 pt-4">
          <AppHeader title="Check-in" dataLabel={isLoading ? 'Loading check-in' : errorMessage ? 'Check-in unavailable' : 'Live class data'} />
        </PageContent>
        <PageContent className="px-5">
          <View className="mb-5 overflow-hidden rounded-3xl border border-border bg-card">
            <View className="h-1 bg-primary" />
            <View className="p-5">
              <View className="flex-row items-start justify-between gap-4">
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-bold uppercase tracking-[1.6px] text-primary">Active academy</Text>
                  <Text className="mt-2 text-2xl font-bold tracking-tight text-card-foreground">Take attendance</Text>
                  <Text className="mt-1 text-sm leading-5 text-muted-foreground">Open the live class roster to record arrivals as they happen.</Text>
                </View>
                <View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary/10"><LucideIcon name="ClipboardCheck" className="h-6 w-6 text-primary" /></View>
              </View>
            </View>
          </View>
          {isLoading ? <View className="items-center rounded-3xl border border-border bg-card py-14"><View className="h-11 w-11 items-center justify-center rounded-2xl bg-secondary"><LoadingIndicator /></View><Text className="mt-4 text-sm font-semibold text-foreground">Loading active class</Text><Text className="mt-1 text-sm text-muted-foreground">Checking the live schedule.</Text></View> : null}
          {!isLoading && errorMessage ? <View className="items-center rounded-3xl border border-destructive/20 bg-destructive/10 px-6 py-10"><View className="h-12 w-12 items-center justify-center rounded-2xl bg-destructive/15"><LucideIcon name="CircleAlert" className="h-5 w-5 text-destructive" /></View><Text className="mt-4 font-bold text-foreground">Check-in unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{errorMessage}</Text></View> : null}
          {!isLoading && !errorMessage && !activeClass ? <View className="items-center rounded-3xl border border-dashed border-border bg-card px-6 py-12"><View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary"><LucideIcon name="ScanLine" className="h-6 w-6 text-tertiary" /></View><Text className="mt-4 text-lg font-bold text-foreground">No active class</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">Start a scheduled class to open its live roster for check-in.</Text><Pressable accessibilityRole="button" accessibilityLabel="Open schedule" onPress={() => router.push('/schedule')} className="mt-6 min-h-12 rounded-2xl bg-primary px-5 py-3 active:opacity-85"><Text className="font-bold text-primary-foreground">Open schedule</Text></Pressable></View> : null}
          {!isLoading && !errorMessage && activeClass ? <View className="overflow-hidden rounded-3xl border border-border bg-card"><View className="h-1 bg-primary" /><View className="p-5"><View className="flex-row items-start justify-between gap-4"><View className="min-w-0 flex-1"><View className="flex-row items-center gap-2"><View className="h-2 w-2 rounded-full bg-success" /><Text className="text-xs font-bold uppercase tracking-wide text-success">Live class</Text></View><Text numberOfLines={2} className="mt-2 text-2xl font-bold tracking-tight text-card-foreground">{activeClass.class_name}</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">{formatClassDate(activeClass.class_date)} · {formatTime(activeClass.start_time)} – {formatTime(activeClass.end_time)}</Text><Text className="mt-1 text-sm text-muted-foreground">{activeClass.coach_name ?? 'Coach not assigned'}</Text></View><View className="h-11 w-11 items-center justify-center rounded-2xl bg-secondary"><LucideIcon name="UsersRound" className="h-5 w-5 text-secondary-foreground" /></View></View><Pressable accessibilityRole="button" accessibilityLabel={`Open ${activeClass.class_name} roster`} onPress={() => router.push(`/classes/${activeClass.id}`)} className="mt-5 min-h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 active:opacity-85"><LucideIcon name="ClipboardCheck" className="h-5 w-5 text-primary-foreground" /><Text className="font-bold text-primary-foreground">Open live roster</Text></Pressable></View></View> : null}
        </PageContent>
      </ScrollView>
    </SafeAreaView>
  );
}
