import * as React from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { AppHeader } from '@/components/gym/AppHeader';
import { MemberAvatar } from '@/components/gym/MemberAvatar';
import LucideIcon from '@/lib/icons/LucideIcon';
import { database } from '@/lib/database';
import { fullName, studentInitials, type Student } from '@/lib/students';
import { formatTimestampDate, formatTimestampTime } from '@/lib/date';

type AttendanceRecord = {
  id: number;
  created_at: string;
  student_id: number;
  class_type: string | null;
  check_in_date: string;
  notes: string | null;
  class_id: number | null;
};

type GymClass = {
  id: number;
  class_name: string;
  class_date: string;
  start_time: string;
  end_time: string;
  max_students: number | null;
  class_type: string | null;
  coach_name: string | null;
  notes: string | null;
  is_active: boolean | null;
  status: string | null;
};

type Timeframe = 'today' | 'week' | 'all';

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function isWithinTimeframe(value: string, timeframe: Timeframe, now: Date) {
  if (timeframe === 'all') return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  if (timeframe === 'today') return localDateKey(date) === localDateKey(now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  return date.getTime() >= start.getTime() && date.getTime() <= now.getTime();
}

function formatCheckIn(value: string) {
  return {
    day: formatTimestampDate(value),
    time: formatTimestampTime(value),
  };
}

function timeframeLabel(timeframe: Timeframe) {
  if (timeframe === 'today') return 'Today';
  if (timeframe === 'week') return 'Last 7 days';
  return 'All time';
}

export default function AttendanceReportsScreen() {
  const router = useRouter();
  const [attendance, setAttendance] = React.useState<AttendanceRecord[]>([]);
  const [students, setStudents] = React.useState<Student[]>([]);
  const [classes, setClasses] = React.useState<GymClass[]>([]);
  const [timeframe, setTimeframe] = React.useState<Timeframe>('today');
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;

      async function loadReport() {
        setIsLoading(true);
        setErrorMessage(null);
        try {
          const [attendanceResponse, studentsResponse, classesResponse] = await Promise.all([
            database.listAttendance<AttendanceRecord>(),
            database.listStudents<Student>(),
            database.listClasses<GymClass>(),
          ]);
          if (!isActive) return;
          setAttendance((attendanceResponse as AttendanceRecord[]).sort((first, second) => new Date(second.check_in_date).getTime() - new Date(first.check_in_date).getTime()));
          setStudents(studentsResponse as Student[]);
          setClasses(classesResponse as GymClass[]);
        } catch {
          if (isActive) setErrorMessage('Live attendance data could not be loaded. Try again.');
        } finally {
          if (isActive) setIsLoading(false);
        }
      }

      loadReport();
      return () => {
        isActive = false;
      };
    }, [refreshKey]),
  );

  const now = new Date();
  const records = React.useMemo(
    () => attendance.filter((record) => isWithinTimeframe(record.check_in_date, timeframe, now)),
    [attendance, timeframe, now.getDate(), now.getMonth(), now.getFullYear()],
  );
  const studentsById = React.useMemo(() => new Map(students.map((student) => [student.studentId, student])), [students]);
  const classesById = React.useMemo(() => new Map(classes.map((gymClass) => [gymClass.id, gymClass])), [classes]);
  const uniqueStudentCount = React.useMemo(() => new Set(records.map((record) => record.student_id)).size, [records]);
  const scheduledClassCheckIns = React.useMemo(() => records.filter((record) => record.class_id !== null).length, [records]);

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <FlatList
        data={isLoading || errorMessage ? [] : records}
        keyExtractor={(record) => String(record.id)}
        contentContainerClassName="px-5 pb-8"
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <AttendanceRow
            record={item}
            student={studentsById.get(item.student_id)}
            gymClass={item.class_id === null ? undefined : classesById.get(item.class_id)}
            first={index === 0}
            last={index === records.length - 1}
          />
        )}
        ListHeaderComponent={
          <View className="pt-4">
            <View className="flex-row items-center justify-between">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to dashboard"
                onPress={() => {
                  if (router.canGoBack()) router.back();
                  else router.replace('/');
                }}
                className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent">
                <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
              </Pressable>
              <Text className="text-lg font-bold text-foreground">Attendance reports</Text>
              <View className="h-10 w-10" />
            </View>
            <View className="mt-6">
              <AppHeader title="GRAU" dataLabel="Live attendance data" />
              <Text className="text-3xl font-bold tracking-tight text-foreground">Attendance reports</Text>
              <Text className="mt-2 text-sm leading-5 text-muted-foreground">A live view of member arrivals and class check-ins.</Text>
            </View>
            <View className="mt-6 flex-row gap-2">
              {(['today', 'week', 'all'] as Timeframe[]).map((option) => {
                const selected = timeframe === option;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Show ${timeframeLabel(option).toLowerCase()} attendance`}
                    onPress={() => setTimeframe(option)}
                    className={`rounded-full px-3.5 py-2 ${selected ? 'bg-primary' : 'border border-border bg-card active:bg-accent'}`}>
                    <Text className={`text-xs font-bold ${selected ? 'text-primary-foreground' : 'text-muted-foreground'}`}>{timeframeLabel(option)}</Text>
                  </Pressable>
                );
              })}
            </View>
            {isLoading ? (
              <View className="items-center py-24">
                <LoadingIndicator />
                <Text className="mt-3 text-sm text-muted-foreground">Loading live attendance…</Text>
              </View>
            ) : null}
            {errorMessage ? (
              <View className="mt-8 items-center rounded-3xl bg-destructive/10 px-6 py-10">
                <LucideIcon name="CircleAlert" className="mb-3 h-7 w-7 text-destructive" />
                <Text className="text-center font-bold text-foreground">Attendance unavailable</Text>
                <Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{errorMessage}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Retry attendance loading" onPress={() => setRefreshKey((key) => key + 1)} className="mt-5 rounded-xl bg-primary px-4 py-2.5">
                  <Text className="font-bold text-primary-foreground">Retry</Text>
                </Pressable>
              </View>
            ) : null}
            {!isLoading && !errorMessage ? (
              <>
                <View className="mt-7 flex-row flex-wrap gap-3">
                  <Metric value={String(records.length)} label="check-ins" icon="UserRoundCheck" />
                  <Metric value={String(uniqueStudentCount)} label="members" icon="UsersRound" />
                  <Metric value={String(scheduledClassCheckIns)} label="class check-ins" icon="CalendarDays" />
                </View>
                <View className="mb-3 mt-8 flex-row items-end justify-between">
                  <Text className="text-xl font-bold tracking-tight text-foreground">Recent activity</Text>
                  <Text className="text-sm font-medium text-tertiary">{timeframeLabel(timeframe)}</Text>
                </View>
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={!isLoading && !errorMessage ? <EmptyState timeframe={timeframe} /> : null}
      />
    </SafeAreaView>
  );
}

function Metric({ value, label, icon }: { value: string; label: string; icon: 'UserRoundCheck' | 'UsersRound' | 'CalendarDays' }) {
  return <View className="min-w-[140px] flex-1 rounded-2xl border border-border bg-card p-3.5"><LucideIcon name={icon} className="mb-4 h-4 w-4 text-tertiary" /><Text className="text-lg font-bold text-card-foreground">{value}</Text><Text className="mt-0.5 text-xs leading-4 text-muted-foreground">{label}</Text></View>;
}

function AttendanceRow({ record, student, gymClass, first, last }: { record: AttendanceRecord; student?: Student; gymClass?: GymClass; first: boolean; last: boolean }) {
  const date = formatCheckIn(record.check_in_date);
  const note = record.notes?.trim();
  const classLabel = gymClass?.class_name ?? record.class_type ?? 'Attendance check-in';
  return (
    <View className={`flex-row border-border bg-card px-4 py-4 ${first ? 'rounded-t-2xl' : ''} ${last ? 'rounded-b-2xl' : 'border-b'}`}>
      <MemberAvatar initials={student ? studentInitials(student) : '?'} photoUrl={student?.photo_url} />
      <View className="ml-3 flex-1">
        <View className="flex-row items-start justify-between gap-3">
          <Text className="flex-1 font-bold text-foreground">{student ? fullName(student) : `Student ID ${record.student_id}`}</Text>
          <Text className="text-xs font-medium text-muted-foreground">{date.time}</Text>
        </View>
        <Text className="mt-1 text-sm text-muted-foreground">{classLabel}</Text>
        <Text className="mt-1 text-xs text-muted-foreground">{date.day}</Text>
        {note ? <Text className="mt-2 text-sm leading-5 text-muted-foreground">{note}</Text> : null}
      </View>
    </View>
  );
}

function EmptyState({ timeframe }: { timeframe: Timeframe }) {
  return <View className="items-center rounded-2xl border border-border bg-card px-6 py-12"><View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary"><LucideIcon name="CalendarX2" className="h-6 w-6 text-tertiary" /></View><Text className="mt-4 text-lg font-bold text-foreground">No attendance found</Text><Text className="mt-2 max-w-[280px] text-center text-sm leading-5 text-muted-foreground">No check-ins have been recorded for {timeframeLabel(timeframe).toLowerCase()}.</Text></View>;
}
