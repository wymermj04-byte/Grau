import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import { AppHeader } from '@/components/gym/AppHeader';
import { RecentAnnouncements } from '@/components/gym/RecentAnnouncements';
import { MemberAvatar } from '@/components/gym/MemberAvatar';
import { SectionTitle } from '@/components/gym/SectionTitle';
import { database } from '@/lib/database';
import { fullName, studentInitials, type Student } from '@/lib/students';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess } from '@/providers/GymAccessProvider';
import { formatTimestampDate } from '@/lib/date';
import { useAnnouncementSummary } from '@/lib/use-announcement-summary';

type GymClass = {
  id: number;
  class_name: string;
  coach_name: string | null;
  class_date: string;
  start_time: string;
  end_time: string;
  max_students: number | null;
  class_type: string | null;
  notes: string | null;
  is_active: boolean | null;
  status: string | null;
};

type AttendanceRecord = {
  id: number;
  student_id: number;
  class_type: string | null;
  check_in_date: string;
  notes: string | null;
  class_id: number | null;
};

type PaymentRecord = {
  id: number;
  created_at: string;
  amount: number;
  payment_status: string | null;
};

type GymSettings = {
  logo_url: string | null;
  gym_name: string | null;
};

type DashboardData = {
  students: Student[];
  activeMembers: number;
  scheduledToday: number;
  classesInProgress: number;
  currentClass: GymClass | null;
  nextClass: GymClass | null;
  attendanceToday: AttendanceRecord[];
  paidThisMonth: number;
  logoUrl: string | null;
  gymName: string | null;
};

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function classDateKey(value: string) {
  return value.slice(0, 10);
}

function classTimestamp(gymClass: GymClass) {
  return new Date(`${classDateKey(gymClass.class_date)}T${gymClass.start_time}`).getTime();
}

function formatTime(value: string) {
  const [hour = '0', minute = '00'] = value.split(':');
  return new Date(2000, 0, 1, Number(hour), Number(minute)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function isSameLocalDay(value: string, today: Date) {
  const date = new Date(value);
  return localDateKey(date) === localDateKey(today);
}

function savedMetadataText(metadata: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function coachGreeting(metadata: Record<string, unknown> | undefined) {
  const title = savedMetadataText(metadata, ['preferred_title', 'preferredTitle', 'title']);
  const name = savedMetadataText(metadata, ['display_name', 'displayName', 'full_name', 'fullName']);
  return [title, name].filter((value): value is string => Boolean(value)).join(' ') || 'Coach';
}

export default function TodayScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { accessError, accessStatus, isResolvingAccess, staffRole } = useGymAccess();
  const { announcements, error: announcementError, isLoading: isLoadingAnnouncements, readAnnouncementIds, unreadCount } = useAnnouncementSummary();
  const [dashboard, setDashboard] = React.useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  useFocusEffect(React.useCallback(() => {
    let isActive = true;
    async function loadDashboard() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const [studentsResponse, classesResponse, attendanceResponse, paymentsResponse, gymSettingsResponse] = await Promise.all([
          database.listStudents<Student>(),
          database.listClasses<GymClass>(),
          database.listAttendance<AttendanceRecord>(),
          database.listPayments<PaymentRecord>(),
          database.listGymSettings<GymSettings>(),
        ]);
        const students = studentsResponse as Student[];
        const classes = classesResponse as GymClass[];
        const attendance = attendanceResponse as AttendanceRecord[];
        const payments = paymentsResponse as PaymentRecord[];
        const gymSettings = gymSettingsResponse as GymSettings[];
        const now = new Date();
        const today = localDateKey(now);
        const scheduledToday = classes.filter((gymClass) => classDateKey(gymClass.class_date) === today && gymClass.status?.trim().toLowerCase() === 'scheduled');
        const nextClass = scheduledToday.filter((gymClass) => classTimestamp(gymClass) >= now.getTime()).sort((first, second) => classTimestamp(first) - classTimestamp(second))[0] ?? null;
        const activeClasses = classes.filter((gymClass) => gymClass.is_active === true && gymClass.status?.trim().toLowerCase() === 'in progress');
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const paidThisMonth = payments.filter((payment) => {
          const paymentDate = new Date(payment.created_at);
          return payment.payment_status?.trim().toLowerCase() === 'paid' && paymentDate.getMonth() === currentMonth && paymentDate.getFullYear() === currentYear;
        }).reduce((total, payment) => total + Number(payment.amount || 0), 0);

        const nextDashboard = {
          students,
          activeMembers: students.filter((student) => student.membership_status.trim().toLowerCase() === 'active').length,
          scheduledToday: scheduledToday.length,
          classesInProgress: activeClasses.length,
          currentClass: activeClasses[0] ?? null,
          nextClass,
          attendanceToday: attendance.filter((record) => isSameLocalDay(record.check_in_date, now)).sort((first, second) => new Date(second.check_in_date).getTime() - new Date(first.check_in_date).getTime()),
          paidThisMonth,
          logoUrl: gymSettings.length === 1 ? gymSettings[0]?.logo_url ?? null : null,
          gymName: gymSettings.length === 1 ? gymSettings[0]?.gym_name ?? null : null,
        };
        if (isActive) setDashboard(nextDashboard);
      } catch {
        if (isActive) setErrorMessage('Live dashboard data could not be loaded. Try again.');
      } finally {
        if (isActive) setIsLoading(false);
      }
    }
    loadDashboard();
    return () => { isActive = false; };
  }, [refreshKey]));

  const todayLabel = formatTimestampDate(new Date().toISOString());
  const greeting = coachGreeting(session?.user.user_metadata);
  const canCreateAnnouncements = Boolean(
    session
    && !isResolvingAccess
    && !accessError
    && accessStatus === 'staff'
    && (staffRole === 'admin' || staffRole === 'coach'),
  );

  return <SafeAreaView edges={['top']} className="flex-1 bg-background"><ScrollView className="flex-1" contentContainerClassName="px-5 pb-8" showsVerticalScrollIndicator={false}><View className="w-full max-w-3xl self-center pt-4"><AppHeader title={dashboard?.gymName?.trim() || 'GRAU'} dataLabel={isLoading ? 'Loading today' : errorMessage ? 'Dashboard unavailable' : 'Live gym data'} logoUrl={dashboard?.logoUrl} announcementUnreadCount={unreadCount} onOpenAnnouncements={() => router.push('/announcements')} /><View className="mb-6"><Text className="text-sm font-medium text-muted-foreground">{todayLabel}</Text><Text className="mt-1 text-3xl font-bold tracking-tight text-foreground">{`Welcome back, ${greeting}.`}</Text><Text className="mt-1 text-base font-medium text-muted-foreground">Your mat-side command center.</Text></View>{isLoading ? <View className="items-center py-24"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading live dashboard…</Text></View> : null}{errorMessage ? <View className="items-center rounded-3xl border border-destructive/20 bg-destructive/10 px-6 py-10"><LucideIcon name="CircleAlert" className="mb-3 h-7 w-7 text-destructive" /><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{errorMessage}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry dashboard loading" onPress={() => setRefreshKey((key) => key + 1)} className="mt-5 rounded-xl bg-primary px-4 py-2.5"><Text className="font-bold text-primary-foreground">Retry</Text></Pressable></View> : null}{dashboard ? <DashboardContent dashboard={dashboard} onOpenSchedule={() => router.push('/schedule')} onOpenCheckIn={() => router.push('/checkin')} onOpenMembers={() => router.push('/members')} onOpenFinance={() => router.push('/finance')} onOpenAttendanceReports={() => router.push('/attendance-reports')} /> : null}<RecentAnnouncements announcements={announcements} readAnnouncementIds={readAnnouncementIds} isLoading={isLoadingAnnouncements} error={announcementError} onOpenAnnouncements={() => router.push('/announcements')} onCreateAnnouncement={canCreateAnnouncements ? () => router.push('/announcements/create') : undefined} /></View></ScrollView></SafeAreaView>;
}

function DashboardContent({ dashboard, onOpenSchedule, onOpenCheckIn, onOpenMembers, onOpenFinance, onOpenAttendanceReports }: { dashboard: DashboardData; onOpenSchedule: () => void; onOpenCheckIn: () => void; onOpenMembers: () => void; onOpenFinance: () => void; onOpenAttendanceReports: () => void }) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 720;
  const studentById = new Map(dashboard.students.map((student) => [student.studentId, student]));
  const classIsLive = dashboard.classesInProgress > 0;
  const featuredClass = dashboard.currentClass ?? dashboard.nextClass;
  return <>
    <View className="mb-5 overflow-hidden rounded-3xl border border-border bg-card">
      <View className="h-1.5 bg-primary" />
      <View className="p-5">
        <View className="flex-row items-start justify-between gap-4">
          <View className="flex-1"><Text className="text-sm font-bold text-primary">{classIsLive ? 'Class in progress' : 'Next on the mat'}</Text>{featuredClass ? <><Text className="mt-2 text-3xl font-bold tracking-tight text-card-foreground">{featuredClass.class_name}</Text><Text className="mt-1 text-sm font-medium text-muted-foreground">{formatTime(featuredClass.start_time)} with {featuredClass.coach_name ?? 'Coach not assigned'}</Text></> : <><Text className="mt-2 text-2xl font-bold tracking-tight text-card-foreground">The mat is clear</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">No more scheduled classes today. Review the class schedule when you are ready.</Text></>}</View>
          <View className="h-11 w-11 items-center justify-center rounded-2xl bg-primary/15"><LucideIcon name={classIsLive ? 'Activity' : 'Timer'} className="h-5 w-5 text-primary" /></View>
        </View>
        <View className="mt-5 flex-row flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><Text className="text-sm font-semibold text-muted-foreground">{featuredClass && featuredClass.max_students !== null ? `Capacity ${featuredClass.max_students}` : classIsLive ? 'Live roster is ready' : 'No active class'}</Text><Pressable accessibilityRole="button" accessibilityLabel={classIsLive ? 'Open live class check-in' : 'Open class schedule'} onPress={classIsLive ? onOpenCheckIn : onOpenSchedule} className="flex-row items-center gap-2 rounded-xl bg-primary px-4 py-2.5 active:opacity-80"><LucideIcon name={classIsLive ? 'ClipboardCheck' : 'CalendarDays'} className="h-4 w-4 text-primary-foreground" /><Text className="text-sm font-bold text-primary-foreground">{classIsLive ? 'Open live check-in' : 'Open classes'}</Text></Pressable></View>
      </View>
    </View>

    <View className="mb-6 flex-row flex-wrap gap-3"><Metric icon="UsersRound" value={String(dashboard.activeMembers)} label="active members" /><Metric icon="CalendarDays" value={String(dashboard.scheduledToday)} label="scheduled today" /><Metric icon="Play" value={String(dashboard.classesInProgress)} label="in progress" /></View>

    <SectionTitle title="Quick actions" detail="Staff tools" />
    <View className="mb-7 flex-row flex-wrap gap-3"><QuickAction icon="ClipboardCheck" title="Check-in" detail="Open the live roster" onPress={onOpenCheckIn} isTablet={isTablet} emphasized /><QuickAction icon="CalendarDays" title="Classes" detail="View today’s schedule" onPress={onOpenSchedule} isTablet={isTablet} /><QuickAction icon="UsersRound" title="Members" detail="Manage the roster" onPress={onOpenMembers} isTablet={isTablet} /><QuickAction icon="CircleDollarSign" title="Finance" detail="Review payments" onPress={onOpenFinance} isTablet={isTablet} /></View>

    <View className="mb-3 flex-row items-end justify-between"><View><Text className="text-xl font-bold tracking-tight text-foreground">Checked in today</Text><Text className="mt-0.5 text-sm text-muted-foreground">Live arrivals from today’s classes.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Open attendance reports" onPress={onOpenAttendanceReports} className="rounded-lg px-1 py-1 active:bg-accent"><Text className="text-sm font-bold text-primary">View reports</Text></Pressable></View>
    <View className="mb-7 overflow-hidden rounded-2xl border border-border bg-card px-4">{dashboard.attendanceToday.length ? dashboard.attendanceToday.map((record, index) => <ArrivalRow key={record.id} record={record} student={studentById.get(record.student_id)} last={index === dashboard.attendanceToday.length - 1} />) : <View className="flex-row items-center py-5"><View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-secondary"><LucideIcon name="UserRoundCheck" className="h-5 w-5 text-primary" /></View><View className="flex-1"><Text className="font-bold text-foreground">No check-ins yet</Text><Text className="mt-0.5 text-sm leading-5 text-muted-foreground">Today’s arrivals will appear here.</Text></View></View>}</View>

    <View className="mb-3 flex-row items-end justify-between"><View><Text className="text-xl font-bold tracking-tight text-foreground">Finance</Text><Text className="mt-0.5 text-sm text-muted-foreground">Current month, from recorded payments.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Open finance" onPress={onOpenFinance} className="rounded-lg px-1 py-1 active:bg-accent"><Text className="text-sm font-bold text-primary">Open finance</Text></Pressable></View>
    <View className="rounded-2xl border border-border bg-card p-4"><View className="flex-row items-center"><View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-primary/15"><LucideIcon name="CircleDollarSign" className="h-5 w-5 text-primary" /></View><View><Text className="text-2xl font-bold tracking-tight text-card-foreground">${dashboard.paidThisMonth.toLocaleString()}</Text><Text className="mt-0.5 text-sm text-muted-foreground">Paid this month</Text></View></View></View>
  </>;
}

function ArrivalRow({ record, student, last }: { record: AttendanceRecord; student?: Student; last: boolean }) {
  const detail = [record.class_type, new Date(record.check_in_date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })].filter(Boolean).join(' · ');
  return <View className={`flex-row items-center py-3.5 ${last ? '' : 'border-b border-border'}`}><MemberAvatar initials={student ? studentInitials(student) : '?'} photoUrl={student?.photo_url} /><View className="ml-3 flex-1"><Text className="font-bold text-foreground">{student ? fullName(student) : 'Member record unavailable'}</Text><Text className="mt-0.5 text-xs text-muted-foreground">{detail}</Text></View><View className="rounded-full bg-success/15 px-2.5 py-1"><Text className="text-xs font-bold text-success">Checked in</Text></View></View>;
}

function Metric({ icon, value, label }: { icon: 'UsersRound' | 'CalendarDays' | 'Play'; value: string; label: string }) {
  return <View className="min-w-[96px] flex-1 rounded-2xl border border-border bg-card p-3.5"><LucideIcon name={icon} className="mb-3 h-4 w-4 text-primary" /><Text className="text-xl font-bold tracking-tight text-card-foreground">{value}</Text><Text className="mt-0.5 text-xs leading-4 text-muted-foreground">{label}</Text></View>;
}

function QuickAction({ icon, title, detail, onPress, isTablet, emphasized = false }: { icon: 'ClipboardCheck' | 'CalendarDays' | 'UsersRound' | 'CircleDollarSign'; title: string; detail: string; onPress: () => void; isTablet: boolean; emphasized?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={isTablet ? styles.tabletQuickAction : styles.phoneQuickAction} className={`flex-row items-center rounded-2xl border px-4 py-3.5 active:opacity-80 ${emphasized ? 'border-primary bg-primary' : 'border-border bg-card active:bg-accent'}`}><View className={`h-10 w-10 items-center justify-center rounded-xl ${emphasized ? 'bg-primary-foreground/15' : 'bg-primary/15'}`}><LucideIcon name={icon} className={`h-5 w-5 ${emphasized ? 'text-primary-foreground' : 'text-primary'}`} /></View><View className="ml-3 flex-1"><Text className={`font-bold ${emphasized ? 'text-primary-foreground' : 'text-card-foreground'}`}>{title}</Text><Text className={`mt-0.5 text-xs ${emphasized ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{detail}</Text></View><LucideIcon name="ChevronRight" className={`h-4 w-4 ${emphasized ? 'text-primary-foreground/70' : 'text-muted-foreground'}`} /></Pressable>;
}

const styles = StyleSheet.create({
  phoneQuickAction: { width: '100%' },
  tabletQuickAction: { width: '48.8%' },
});
