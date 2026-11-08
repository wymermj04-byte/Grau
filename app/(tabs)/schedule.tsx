import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import { AppHeader } from '@/components/gym/AppHeader';
import { SectionTitle } from '@/components/gym/SectionTitle';
import { PageContent } from '@/components/layout/PageContent';
import { database } from '@/lib/database';

type GymClass = {
  id: number;
  class_name: string;
  coach_name: string | null;
  class_date: string;
  start_time: string;
  end_time: string;
  max_students: number | null;
  class_type: string | null;
  class_audience: string | null;
  notes: string | null;
  is_active: boolean | null;
  status: string | null;
};

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfWeek(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function daysForWeek(value: Date) {
  const start = startOfWeek(value);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function addDays(value: Date, amount: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function classTimestamp(gymClass: GymClass) {
  return new Date(`${gymClass.class_date.slice(0, 10)}T${gymClass.start_time}`).getTime();
}

function formatTime(value: string) {
  const [hour = '0', minute = '00'] = value.split(':');
  const date = new Date(2000, 0, 1, Number(hour), Number(minute));
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatClassAudience(value: unknown) {
  if (typeof value !== 'string') return null;
  const audience = value.trim().toLowerCase();
  return audience === 'kids' || audience === 'adults' || audience === 'mixed'
    ? `${audience[0].toUpperCase()}${audience.slice(1)}`
    : null;
}

export default function ScheduleScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isTablet = width >= 720;
  const [classes, setClasses] = React.useState<GymClass[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [selectedDate, setSelectedDate] = React.useState(() => new Date());
  const [visibleWeekStart, setVisibleWeekStart] = React.useState(() => startOfWeek(new Date()));

  useFocusEffect(React.useCallback(() => {
    let isMounted = true;
    async function loadClasses() {
      setIsLoading(true);
      setErrorMessage(null);
      setClasses([]);
      try {
        const response = await database.listClasses<GymClass>();
        const liveClasses = response.sort((first, second) => classTimestamp(first) - classTimestamp(second));
        if (isMounted) {
          setClasses(liveClasses);
        }
      } catch {
        if (isMounted) {
          setErrorMessage('Live schedule data could not be loaded. Try again.');
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    void loadClasses();
    return () => { isMounted = false; };
  }, []));

  const calendarDays = React.useMemo(() => daysForWeek(visibleWeekStart), [visibleWeekStart]);
  const selectedClasses = classes.filter((gymClass) => gymClass.class_date.slice(0, 10) === dateKey(selectedDate)).sort((first, second) => classTimestamp(first) - classTimestamp(second));
  const heading = `${selectedDate.toLocaleDateString(undefined, { weekday: 'long' })} classes`;
  const monthYear = selectedDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const weekOf = calendarDays[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const goToToday = () => {
    const today = new Date();
    setSelectedDate(today);
    setVisibleWeekStart(startOfWeek(today));
  };
  const moveWeek = (amount: number) => {
    setVisibleWeekStart((current) => addDays(current, amount));
    setSelectedDate((current) => addDays(current, amount));
  };

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="pb-8" showsVerticalScrollIndicator={false}>
        <PageContent className="px-5 pt-4"><AppHeader title="Classes" action="filter" secondaryAction="createClass" /></PageContent>
        <PageContent className="flex-row flex-wrap items-center justify-between gap-y-3 px-5 pb-4">
          <View className="flex-1">
            <Text className="text-xl font-bold tracking-tight text-foreground">{monthYear}</Text>
            <Text className="mt-0.5 text-xs text-muted-foreground">Week of {weekOf}</Text>
          </View>
          <View className="flex-row items-center gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous week"
              onPress={() => moveWeek(-7)}
              className="h-9 w-9 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
            >
              <LucideIcon name="ChevronLeft" className="h-5 w-5 text-foreground" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go to today"
              onPress={goToToday}
              className="rounded-full bg-secondary px-3 py-2 active:bg-accent"
            >
              <Text className="text-xs font-bold text-secondary-foreground">Today</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next week"
              onPress={() => moveWeek(7)}
              className="h-9 w-9 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
            >
              <LucideIcon name="ChevronRight" className="h-5 w-5 text-foreground" />
            </Pressable>
          </View>
        </PageContent>
        <PageContent className="flex-row gap-1.5 px-5 pb-7">
          {calendarDays.map((date) => {
            const active = dateKey(selectedDate) === dateKey(date);
            return <Pressable key={dateKey(date)} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setSelectedDate(date)} className={`min-h-[68px] flex-1 items-center justify-center rounded-2xl ${active ? 'border-2 border-primary bg-primary shadow-sm' : 'border border-border bg-card active:bg-accent'}`}><Text numberOfLines={1} className={`text-[10px] font-bold ${active ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2).toUpperCase()}</Text><Text className={`mt-1 text-lg font-bold ${active ? 'text-primary-foreground' : 'text-foreground'}`}>{date.getDate()}</Text>{active ? <View className="mt-1 h-1 w-4 rounded-full bg-primary-foreground/80" /> : null}</Pressable>;
          })}
        </PageContent>
        <PageContent className="px-5">
          <SectionTitle title={heading} detail={isLoading ? 'Loading…' : `${selectedClasses.length} ${selectedClasses.length === 1 ? 'session' : 'sessions'}`} />
          {isLoading ? <View className="items-center rounded-3xl border border-border bg-card py-14"><View className="h-11 w-11 items-center justify-center rounded-2xl bg-secondary"><LoadingIndicator /></View><Text className="mt-4 text-sm font-semibold text-foreground">Loading schedule</Text><Text className="mt-1 text-sm text-muted-foreground">Pulling in the day’s sessions.</Text></View> : null}
          {!isLoading && errorMessage ? <View className="items-center rounded-3xl border border-destructive/20 bg-destructive/10 px-6 py-10"><View className="h-11 w-11 items-center justify-center rounded-2xl bg-destructive/15"><LucideIcon name="CircleAlert" className="h-5 w-5 text-destructive" /></View><Text className="mt-4 font-bold text-foreground">Classes unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{errorMessage}</Text></View> : null}
          {!isLoading && !errorMessage && !selectedClasses.length ? <View className="items-center rounded-3xl border border-dashed border-border bg-card px-5 py-12"><View className="h-12 w-12 items-center justify-center rounded-2xl bg-secondary"><LucideIcon name="CalendarX2" className="h-5 w-5 text-tertiary" /></View><Text className="mt-4 font-bold text-foreground">No classes scheduled</Text><Text className="mt-1 text-center text-sm leading-5 text-muted-foreground">There are no class records for this day.</Text></View> : null}
          {!isLoading && !errorMessage && selectedClasses.length ? <View className="flex-row flex-wrap gap-3">{selectedClasses.map((session, index) => {
            return <ClassCard key={session.id} gymClass={session} index={index} isTablet={isTablet} onPress={() => router.push(`/classes/${session.id}`)} />;
          })}</View> : null}
          <View className="mt-7 rounded-2xl border border-dashed border-border px-4 py-5"><View className="flex-row items-center gap-3"><View className="h-9 w-9 items-center justify-center rounded-xl bg-secondary"><LucideIcon name="CalendarPlus" className="h-4 w-4 text-tertiary" /></View><View className="flex-1"><Text className="font-bold text-foreground">Need another session?</Text><Text className="mt-0.5 text-xs text-muted-foreground">Add an open mat or special seminar.</Text></View><LucideIcon name="ChevronRight" className="h-5 w-5 text-muted-foreground" /></View></View>
        </PageContent>
      </ScrollView>
    </SafeAreaView>
  );
}

function classStatus(gymClass: GymClass) {
  const label = gymClass.status?.trim() || (gymClass.is_active ? 'Active' : 'Inactive');
  const normalized = label.toLowerCase();
  if (normalized === 'completed') return { label, icon: 'CircleCheck' as const, badge: 'bg-success/15', text: 'text-success', rail: 'bg-success' };
  if (normalized === 'in progress' || gymClass.is_active) return { label, icon: 'Activity' as const, badge: 'bg-primary/15', text: 'text-primary', rail: 'bg-primary' };
  return { label, icon: 'Clock3' as const, badge: 'bg-secondary', text: 'text-secondary-foreground', rail: 'bg-border' };
}

function ClassCard({ gymClass, isTablet, onPress }: { gymClass: GymClass; index: number; isTablet: boolean; onPress?: () => void }) {
  const notes = gymClass.notes?.trim();
  const status = classStatus(gymClass);
  const isInProgress = gymClass.is_active === true && gymClass.status?.trim().toLowerCase() === 'in progress';
  const isCompleted = gymClass.status?.trim().toLowerCase() === 'completed';
  const actionLabel = isCompleted ? 'View attendance' : isInProgress ? 'Open class roster' : 'Start class';
  const audienceLabel = formatClassAudience(gymClass.class_audience);

  return <Pressable accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={onPress ? `${actionLabel}: ${gymClass.class_name}` : undefined} onPress={onPress} disabled={!onPress} style={isTablet ? styles.tabletClassCard : styles.phoneClassCard} className={`overflow-hidden rounded-3xl border border-border bg-card ${onPress ? 'active:bg-accent' : ''}`}><View className="flex-row"><View className={`w-1.5 ${status.rail}`} /><View className="min-w-0 flex-1 p-4"><View className="flex-row items-start justify-between gap-3"><View className="min-w-0 flex-1"><Text className="text-xs font-bold text-primary">{formatTime(gymClass.start_time)} – {formatTime(gymClass.end_time)}</Text><Text numberOfLines={2} className="mt-1 text-xl font-bold tracking-tight text-card-foreground">{gymClass.class_name}</Text></View><View className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${status.badge}`}><LucideIcon name={status.icon} className={`h-3.5 w-3.5 ${status.text}`} /><Text className={`text-[11px] font-bold ${status.text}`}>{status.label}</Text></View></View><View className="mt-4 flex-row flex-wrap items-center gap-2"><View className="rounded-md bg-secondary px-2.5 py-1"><Text className="text-xs font-semibold text-secondary-foreground">{gymClass.class_type ?? 'Program not specified'}</Text></View>{audienceLabel ? <View className="rounded-md bg-primary/10 px-2.5 py-1"><Text className="text-xs font-bold text-primary">{audienceLabel}</Text></View> : null}{gymClass.max_students !== null ? <Text className="text-xs font-medium text-muted-foreground">Capacity {gymClass.max_students}</Text> : null}</View><View className="mt-3 flex-row items-center"><LucideIcon name="UserRound" className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" /><Text numberOfLines={1} className="flex-1 text-sm text-muted-foreground">{gymClass.coach_name ?? 'Coach not assigned'}</Text></View>{notes ? <Text numberOfLines={2} className="mt-3 text-sm leading-5 text-muted-foreground">{notes}</Text> : null}{onPress ? <View className="mt-4 flex-row items-center justify-between border-t border-border pt-3"><Text className="text-sm font-bold text-primary">{actionLabel}</Text><View className="h-7 w-7 items-center justify-center rounded-full bg-primary"><LucideIcon name="ArrowUpRight" className="h-3.5 w-3.5 text-primary-foreground" /></View></View> : <View className="mt-4 border-t border-border pt-3"><Text className="text-sm font-semibold text-muted-foreground">This class is complete</Text></View>}</View></View></Pressable>;
}

const styles = StyleSheet.create({
  phoneClassCard: { width: '100%' },
  tabletClassCard: { width: '48.8%' },
});
