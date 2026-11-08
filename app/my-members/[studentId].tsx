import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/ui/text';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { AcademyIdentity } from '@/components/gym/AcademyIdentity';
import { RankProgress } from '@/components/gym/RankProgress';
import LucideIcon from '@/lib/icons/LucideIcon';
import { formatCalendarDate } from '@/lib/date';
import { getBeltColorProfile } from '@/lib/belt-colors';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useGymAccess, type LinkedMember } from '@/providers/GymAccessProvider';
import { useTheme } from '@/theming/ThemeProvider';
import { formatMemberProgram } from '@/lib/students';

type FamilyAttendance = {
  class_name: string | null;
  class_date: string | null;
  attendance_status: string;
};

type AttendanceMonth = {
  key: string;
  label: string;
  records: FamilyAttendance[];
};

function isCalendarDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseFamilyAttendance(data: unknown): FamilyAttendance[] | null {
  if (!Array.isArray(data)) return null;

  const records: FamilyAttendance[] = [];
  for (const record of data) {
    if (!record || typeof record !== 'object') return null;
    const { class_name, class_date, attendance_status } = record as Record<string, unknown>;
    if ((class_name !== null && typeof class_name !== 'string') ||
      (class_date !== null && (typeof class_date !== 'string' || !isCalendarDate(class_date))) ||
      typeof attendance_status !== 'string') {
      return null;
    }
    records.push({ class_name, class_date, attendance_status });
  }
  return records;
}

function memberInitials(member: LinkedMember) {
  return [member.first_name, member.last_name]
    .filter(Boolean)
    .map((part) => part?.[0])
    .join('')
    .toUpperCase() || 'M';
}

function attendanceMonth(record: FamilyAttendance) {
  if (!record.class_date) return { key: 'undated', label: 'Date unavailable' };
  const [year, month] = record.class_date.split('-').map(Number);
  if (!year || !month) return { key: 'undated', label: 'Date unavailable' };
  const label = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC', year: 'numeric' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return { key: record.class_date.slice(0, 7), label };
}

function groupAttendance(records: FamilyAttendance[]): AttendanceMonth[] {
  const groups = new Map<string, AttendanceMonth>();
  for (const record of records) {
    const month = attendanceMonth(record);
    const group = groups.get(month.key);
    if (group) {
      group.records.push(record);
    } else {
      groups.set(month.key, { ...month, records: [record] });
    }
  }
  return [...groups.values()];
}

function DetailField({ label, value, icon }: { label: string; value: string; icon: 'UsersRound' | 'FileCheck' }) {
  return (
    <View className="flex-1 rounded-2xl border border-border bg-card p-4">
      <View className="h-9 w-9 items-center justify-center rounded-xl bg-muted"><LucideIcon name={icon} className="h-4 w-4 text-foreground" /></View>
      <Text className="mt-4 text-xs font-semibold text-muted-foreground">{label}</Text>
      <Text className="mt-1 text-base font-bold text-foreground">{value}</Text>
    </View>
  );
}

export default function FamilyMemberDetail() {
  const router = useRouter();
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const { theme } = useTheme();
  const { session } = useAuth();
  const { linkedMembers, linkedGyms, isResolvingAccess } = useGymAccess();
  const [attendance, setAttendance] = React.useState<FamilyAttendance[]>([]);
  const [isLoadingAttendance, setIsLoadingAttendance] = React.useState(false);
  const [attendanceError, setAttendanceError] = React.useState<string | null>(null);
  const [attendanceScope, setAttendanceScope] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const requestVersion = React.useRef(0);

  const member = linkedMembers.find((item) => String(item.student_id) === studentId);
  const memberId = member?.student_id ?? null;
  const memberGym = member ? linkedGyms.find((gym) => gym.gym_id === member.gym_id) : undefined;
  const userId = session?.user.id ?? null;
  const currentScope = userId && memberId !== null ? `${userId}:${memberId}` : null;
  const back = () => router.canGoBack() ? router.back() : router.replace('/my-members');

  const refreshAttendance = React.useCallback(() => {
    requestVersion.current += 1;
    setAttendance([]);
    setAttendanceError(null);
    setAttendanceScope(null);
    setRefreshKey((key) => key + 1);
  }, []);

  useFocusEffect(React.useCallback(() => {
    refreshAttendance();
  }, [refreshAttendance]));

  React.useEffect(() => {
    const requestId = ++requestVersion.current;
    let isCurrent = true;
    const clearAttendance = () => {
      setAttendance([]);
      setAttendanceError(null);
      setAttendanceScope(null);
      setIsLoadingAttendance(false);
    };

    if (!userId || memberId === null || isResolvingAccess) {
      clearAttendance();
      return () => {
        isCurrent = false;
      };
    }

    setIsLoadingAttendance(true);
    setAttendanceError(null);

    const loadAttendance = async () => {
      const { data, error, status, statusText } = await supabase.rpc('my_linked_member_attendance', {
        p_student_id: memberId,
      });

      if (!isCurrent || requestVersion.current !== requestId) return;

      if (error) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[family attendance] my_linked_member_attendance failed', { studentId: memberId, status, statusText, code: error.code, message: error.message, details: error.details, hint: error.hint });
        }
        setAttendance([]);
        setAttendanceError('Attendance could not be loaded. Try again.');
        setAttendanceScope(currentScope);
        setIsLoadingAttendance(false);
        return;
      }

      const parsedAttendance = parseFamilyAttendance(data);
      if (!parsedAttendance) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[family attendance] my_linked_member_attendance returned an invalid response', { studentId: memberId, status, statusText });
        }
        setAttendance([]);
        setAttendanceError('Attendance could not be loaded. Try again.');
        setAttendanceScope(currentScope);
        setIsLoadingAttendance(false);
        return;
      }

      setAttendance(parsedAttendance);
      setAttendanceScope(currentScope);
      setIsLoadingAttendance(false);
    };

    void loadAttendance();
    return () => {
      isCurrent = false;
      requestVersion.current += 1;
    };
  }, [currentScope, isResolvingAccess, memberId, refreshKey, userId]);

  if (!member) {
    return (
      <SafeAreaView edges={['top']} className="flex-1 bg-background px-5">
        <View className="flex-1 items-center justify-center">
          <LucideIcon name="UserRoundX" className="h-8 w-8 text-muted-foreground" />
          <Text className="mt-4 text-xl font-bold text-foreground">Member unavailable</Text>
          <Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">This member is no longer linked to your account.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to My family" onPress={back} className="mt-6 rounded-xl bg-primary px-5 py-3"><Text className="font-bold text-primary-foreground">Back to My family</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Member';
  const belt = getBeltColorProfile(member.belt_rank, {
    primaryColor: theme.colors.secondary ?? '#E4E5DF',
    borderColor: theme.colors.border ?? '#7B837D',
    textColor: theme.colors.secondaryForeground ?? '#171B1A',
  });
  const scopedAttendance = attendanceScope === currentScope ? attendance : [];
  const attendanceGroups = groupAttendance(scopedAttendance);

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView contentContainerClassName="px-5 pb-12" showsVerticalScrollIndicator={false}>
        <View className="w-full max-w-3xl self-center pt-4">
          <View className="flex-row items-center justify-between">
            <Pressable accessibilityRole="button" accessibilityLabel="Back to My family" onPress={back} className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5"><LucideIcon name="ArrowLeft" className="h-4 w-4 text-foreground" /><Text className="font-semibold text-foreground">My family</Text></Pressable>
            <View className="h-10 w-10" />
            <Pressable accessibilityRole="button" accessibilityLabel="Refresh attendance" disabled={isLoadingAttendance || isResolvingAccess} onPress={refreshAttendance} className={`h-10 w-10 items-center justify-center rounded-xl border border-border bg-card ${isLoadingAttendance || isResolvingAccess ? 'opacity-60' : ''}`}><LucideIcon name="RefreshCw" className="h-4 w-4 text-foreground" /></Pressable>
          </View>

          <View className="mt-6 overflow-hidden rounded-[32px] border border-border bg-card">
            <View className="h-1.5 bg-primary" />
            <View className="px-5 pb-6 pt-5">
              <AcademyIdentity name={memberGym?.gym_name} logoUrl={memberGym?.logo_url} label="Training at" />
              <View className="mt-6 flex-row items-center">
                <View style={[styles.heroInitials, { backgroundColor: belt.primaryColor, borderColor: belt.borderColor }]}><Text style={[styles.heroInitialsText, { color: belt.textColor }]}>{memberInitials(member)}</Text></View>
                <View className="ml-4 flex-1"><Text className="text-3xl font-bold tracking-tight text-foreground">{name}</Text><Text className="mt-1 text-sm text-muted-foreground">{member.membership_status ?? 'Membership status unavailable'}</Text></View>
              </View>
              <View className="mt-6 border-t border-border pt-5"><RankProgress beltRank={member.belt_rank} stripes={member.stripes} variant="athlete" /></View>
            </View>
          </View>

          <View className="mt-6 flex-row gap-3">
            <DetailField label="Programs" value={member.programs?.length ? member.programs.map(formatMemberProgram).join(', ') : 'Not recorded'} icon="UsersRound" />
            <DetailField label="Waiver" value={member.waiver_signed ? 'Signed' : 'Not recorded'} icon="FileCheck" />
          </View>

          <AttendanceSection
            groups={attendanceGroups}
            isLoading={isLoadingAttendance || isResolvingAccess || attendanceScope !== currentScope}
            errorMessage={attendanceScope === currentScope ? attendanceError : null}
            onRetry={refreshAttendance}
            attendanceCount={scopedAttendance.length}
            attendancePeriods={attendanceGroups.length}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AttendanceSection({ groups, isLoading, errorMessage, onRetry, attendanceCount, attendancePeriods }: { groups: AttendanceMonth[]; isLoading: boolean; errorMessage: string | null; onRetry: () => void; attendanceCount: number; attendancePeriods: number }) {
  return (
    <View className="mt-9 rounded-[28px] border border-border bg-card p-5">
      <View className="flex-row items-center justify-between">
        <View><Text className="text-2xl font-bold tracking-tight text-foreground">Attendance</Text><Text className="mt-1 text-sm text-muted-foreground">Recorded class check-ins</Text></View>
        <View className="h-11 w-11 items-center justify-center rounded-2xl bg-success/15"><LucideIcon name="CircleCheck" className="h-5 w-5 text-success" /></View>
      </View>

      {!isLoading && !errorMessage && attendanceCount > 0 ? <View className="mt-6 flex-row gap-3"><AttendanceSummary value={String(attendanceCount)} label="recorded check-ins" /><AttendanceSummary value={String(attendancePeriods)} label={attendancePeriods === 1 ? 'month with activity' : 'months with activity'} /></View> : null}

      {isLoading ? <View className="items-center py-12"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading attendance…</Text></View> : null}
      {!isLoading && errorMessage ? <View className="mt-5 items-center rounded-3xl bg-destructive/10 px-6 py-8"><LucideIcon name="CircleAlert" className="h-7 w-7 text-destructive" /><Text className="mt-3 text-center font-bold text-foreground">Attendance unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{errorMessage}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry attendance loading" onPress={onRetry} className="mt-5 rounded-xl bg-primary px-4 py-2.5"><Text className="font-bold text-primary-foreground">Retry</Text></Pressable></View> : null}
      {!isLoading && !errorMessage && !groups.length ? <View className="mt-5 items-center rounded-3xl border border-dashed border-border bg-card px-6 py-9"><LucideIcon name="CalendarX2" className="h-7 w-7 text-muted-foreground" /><Text className="mt-4 text-center font-bold text-foreground">No attendance recorded yet</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">Recorded class check-ins will appear here.</Text></View> : null}

      {!isLoading && !errorMessage ? groups.map((group) => (
        <View key={group.key} className="mt-7">
          <Text className="mb-2 text-sm font-semibold text-muted-foreground">{group.label}</Text>
          <View className="overflow-hidden rounded-2xl border border-border bg-background/30">
            {group.records.map((record, index) => <AttendanceRow key={`${record.class_name ?? 'attendance'}-${record.class_date ?? 'undated'}-${index}`} record={record} last={index === group.records.length - 1} />)}
          </View>
        </View>
      )) : null}
    </View>
  );
}

function AttendanceSummary({ value, label }: { value: string; label: string }) {
  return <View className="flex-1 rounded-2xl border border-border bg-background/30 px-4 py-4"><Text className="text-3xl font-bold tracking-tight text-foreground">{value}</Text><Text className="mt-1 text-xs leading-4 text-muted-foreground">{label}</Text></View>;
}

function AttendanceRow({ record, last }: { record: FamilyAttendance; last: boolean }) {
  const className = record.class_name?.trim() || 'Class name unavailable';
  const status = record.attendance_status === 'checked_in' ? 'Checked in' : 'Attendance recorded';
  return (
    <View className={`flex-row items-center px-4 py-4 ${last ? '' : 'border-b border-border'}`}>
      <View className="h-10 w-10 items-center justify-center rounded-xl bg-success/15"><LucideIcon name="Check" className="h-5 w-5 text-success" strokeWidth={3} /></View>
      <View className="ml-3 flex-1 pr-3"><Text className="font-bold text-foreground">{className}</Text><Text className="mt-1 text-sm text-muted-foreground">{formatCalendarDate(record.class_date)}</Text></View>
      <View className="rounded-full bg-success/15 px-2.5 py-1"><Text className="text-xs font-bold text-success">{status}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroInitials: { alignItems: 'center', borderRadius: 36, borderWidth: 1, height: 72, justifyContent: 'center', width: 72 },
  heroInitialsText: { fontSize: 25, fontWeight: '800', letterSpacing: -0.4 },
});
