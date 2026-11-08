import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import LucideIcon from '@/lib/icons/LucideIcon';
import { AppHeader } from '@/components/gym/AppHeader';
import { SectionTitle } from '@/components/gym/SectionTitle';
import { database, resolveActiveGymMembership } from '@/lib/database';
import { fullName, type Student } from '@/lib/students';
import { formatTimestampDate } from '@/lib/date';

type PaymentRecord = {
  id: number;
  created_at: string;
  student_id: number | null;
  amount: number | string;
  payment_method: string | null;
  payment_status: string | null;
  payment_type: string | null;
  vistor_name?: string | null;
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount);
}

function normalizedStatus(payment: PaymentRecord) {
  return payment.payment_status?.trim().toLowerCase() ?? '';
}

function isThisMonth(value: string, now: Date) {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function paymentDate(value: string) {
  return formatTimestampDate(value);
}

export default function FinanceScreen() {
  const router = useRouter();
  const [payments, setPayments] = React.useState<PaymentRecord[]>([]);
  const [students, setStudents] = React.useState<Student[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [isBillingAdmin, setIsBillingAdmin] = React.useState(false);

  useFocusEffect(
    React.useCallback(() => {
      let isActive = true;

      async function loadFinance() {
        setIsLoading(true);
        setErrorMessage(null);
        try {
          const [paymentRecords, studentRecords, membership] = await Promise.all([
            database.listPayments<PaymentRecord>(),
            database.listStudents<Student>(),
            resolveActiveGymMembership(),
          ]);
          if (!isActive) return;
          setPayments([...paymentRecords].sort((first, second) => new Date(second.created_at).getTime() - new Date(first.created_at).getTime()));
          setStudents(studentRecords);
          setIsBillingAdmin(membership.role === 'admin');
        } catch {
          if (isActive) {
            setPayments([]);
            setStudents([]);
            setIsBillingAdmin(false);
            setErrorMessage('Live payment data could not be loaded. Try again.');
          }
        } finally {
          if (isActive) setIsLoading(false);
        }
      }

      void loadFinance();
      return () => {
        isActive = false;
      };
    }, [refreshKey]),
  );

  const now = new Date();
  const thisMonthsPayments = React.useMemo(
    () => payments.filter((payment) => isThisMonth(payment.created_at, now)),
    [payments, now.getFullYear(), now.getMonth()],
  );
  const paidThisMonth = React.useMemo(
    () => thisMonthsPayments.filter((payment) => normalizedStatus(payment) === 'paid'),
    [thisMonthsPayments],
  );
  const outstandingPayments = React.useMemo(
    () => payments.filter((payment) => ['pending', 'late', 'overdue'].includes(normalizedStatus(payment))),
    [payments],
  );
  const collectedTotal = React.useMemo(
    () => paidThisMonth.reduce((total, payment) => total + Number(payment.amount), 0),
    [paidThisMonth],
  );
  const outstandingTotal = React.useMemo(
    () => outstandingPayments.reduce((total, payment) => total + Number(payment.amount), 0),
    [outstandingPayments],
  );
  const recordedMonthTotal = React.useMemo(
    () => thisMonthsPayments.reduce((total, payment) => total + Number(payment.amount), 0),
    [thisMonthsPayments],
  );
  const completionRate = payments.length
    ? Math.round((payments.filter((payment) => normalizedStatus(payment) === 'paid').length / payments.length) * 100)
    : 0;
  const studentsById = React.useMemo(() => new Map(students.map((student) => [student.studentId, student])), [students]);
  const recentPayments = payments.slice(0, 3);
  const monthName = now.toLocaleDateString(undefined, { month: 'long' }).toUpperCase();

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-8">
        <View className="w-full max-w-2xl self-center pt-4">
          <AppHeader title="Finance" dataLabel={isLoading ? 'Loading payments' : errorMessage ? 'Payment data unavailable' : 'Live payment data'} />
          <View className="mb-7">
            <Text className="text-3xl font-bold tracking-tight text-foreground">Finance</Text>
            <Text className="mt-1 text-sm leading-5 text-muted-foreground">Live payment activity for your active academy.</Text>
          </View>

          {isLoading ? <LoadingState /> : null}
          {errorMessage ? <ErrorState message={errorMessage} onRetry={() => setRefreshKey((key) => key + 1)} /> : null}
          {!isLoading && !errorMessage ? <>
            <View className="mb-5 overflow-hidden rounded-3xl bg-primary">
              <View className="h-1 bg-primary-foreground/35" />
              <View className="p-5">
                <View className="flex-row items-center justify-between gap-3">
                  <View className="flex-1"><Text className="text-sm font-bold uppercase tracking-wide text-primary-foreground/75">Collected this month</Text><Text className="mt-2 text-4xl font-bold tracking-tight text-primary-foreground">{formatMoney(collectedTotal)}</Text></View>
                  <View className="h-12 w-12 items-center justify-center rounded-2xl bg-primary-foreground/15"><LucideIcon name="CircleDollarSign" className="h-6 w-6 text-primary-foreground" /></View>
                </View>
                <Text className="mt-4 text-sm leading-5 text-primary-foreground/75">{paidThisMonth.length} paid payment{paidThisMonth.length === 1 ? '' : 's'} recorded in {monthName.toLocaleLowerCase()}.</Text>
              </View>
            </View>

            <View className="mb-8 gap-3">
              <Summary icon="BadgeDollarSign" value={formatMoney(outstandingTotal)} label="Outstanding" detail="Pending, late, and overdue · all loaded records" />
              <Summary icon="UserRoundPlus" value={formatMoney(recordedMonthTotal)} label="Recorded this month" detail="All payment statuses · current calendar month" />
              <Summary icon="RefreshCw" value={`${completionRate}%`} label="Payment completion" detail="Paid-record percentage · all loaded records" />
            </View>

            <SectionTitle title="Recent payment activity" detail="Newest first" />
            {recentPayments.length ? <View className="gap-3">{recentPayments.map((payment) => <TransactionRow key={payment.id} payment={payment} student={payment.student_id === null ? undefined : studentsById.get(payment.student_id)} />)}</View> : <EmptyState />}

            <View className="mt-8"><SectionTitle title="Finance tools" detail="Active academy" /></View>
            <View className="gap-3">
              <FinanceTool icon="CircleDollarSign" title="Financial reports" detail="Live payment activity and totals" onPress={() => router.push('/financial-reports')} />
              <FinanceTool icon="ReceiptText" title="Monthly payment tracking" detail="Individual and family accounts" onPress={() => router.push('/payment-tracking')} />
              {isBillingAdmin ? <FinanceTool icon="Landmark" title="Billing" detail="Member balances and billing contacts" onPress={() => router.push('/billing')} /> : null}
              <FinanceTool icon="Settings" title="Settings" detail="Gym information and administration" onPress={() => router.push('/settings')} />
            </View>

            <View className="mt-7 rounded-2xl border border-tertiary/30 bg-tertiary/10 p-4"><View className="flex-row gap-3"><LucideIcon name="CircleDollarSign" className="mt-0.5 h-5 w-5 text-tertiary" /><View className="flex-1"><Text className="font-bold text-foreground">Live payment summary</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">Totals reflect only payment records available to your active gym.</Text></View></View></View>
          </> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LoadingState() {
  return <View className="items-center py-24"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading live payments…</Text></View>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <View className="items-center rounded-3xl bg-destructive/10 px-6 py-10"><LucideIcon name="CircleAlert" className="mb-3 h-7 w-7 text-destructive" /><Text className="text-center font-bold text-foreground">Finance unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{message}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry payment loading" onPress={onRetry} className="mt-5 rounded-xl bg-primary px-4 py-2.5"><Text className="font-bold text-primary-foreground">Retry</Text></Pressable></View>;
}

function EmptyState() {
  return <View className="items-center rounded-2xl border border-border bg-card px-6 py-10"><View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary"><LucideIcon name="ReceiptText" className="h-6 w-6 text-tertiary" /></View><Text className="mt-4 text-lg font-bold text-foreground">No payments recorded</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">New payment activity for this gym will appear here.</Text></View>;
}

function Summary({ icon, value, label, detail }: { icon: 'BadgeDollarSign' | 'RefreshCw' | 'UserRoundPlus'; value: string; label: string; detail: string }) {
  return <View className="flex-row items-center gap-4 rounded-2xl border border-border bg-card px-4 py-3.5"><View className="h-10 w-10 items-center justify-center rounded-xl bg-tertiary/15"><LucideIcon name={icon} className="h-5 w-5 text-tertiary" /></View><View className="min-w-0 flex-1"><Text className="text-sm font-bold text-foreground">{label}</Text><Text className="mt-0.5 text-xs leading-4 text-muted-foreground">{detail}</Text></View><Text className="shrink-0 text-lg font-bold text-card-foreground">{value}</Text></View>;
}

function FinanceTool({ icon, title, detail, onPress }: { icon: 'CircleDollarSign' | 'ReceiptText' | 'Landmark' | 'Settings'; title: string; detail: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title}`} onPress={onPress} className="flex-row items-center justify-between rounded-2xl border border-border bg-card px-4 py-3.5 active:bg-accent"><View className="min-w-0 flex-1 flex-row items-center gap-3"><View className="h-10 w-10 items-center justify-center rounded-xl bg-tertiary/15"><LucideIcon name={icon} className="h-5 w-5 text-tertiary" /></View><View className="min-w-0 flex-1"><Text className="font-bold text-foreground">{title}</Text><Text numberOfLines={1} className="mt-0.5 text-xs text-muted-foreground">{detail}</Text></View></View><LucideIcon name="ChevronRight" className="ml-3 h-5 w-5 text-muted-foreground" /></Pressable>;
}

function paymentStatusPresentation(payment: PaymentRecord) {
  const status = normalizedStatus(payment);
  if (status === 'paid') return { label: 'Paid', chip: 'bg-success/15', text: 'text-success', icon: 'ArrowDownLeft' as const };
  if (status === 'pending') return { label: 'Pending', chip: 'bg-warning/15', text: 'text-warning', icon: 'Clock3' as const };
  if (status === 'late') return { label: 'Late', chip: 'bg-destructive/15', text: 'text-destructive', icon: 'CircleAlert' as const };
  if (status === 'overdue') return { label: 'Overdue', chip: 'bg-destructive/15', text: 'text-destructive', icon: 'CircleAlert' as const };
  return { label: payment.payment_status?.trim() || 'Status unavailable', chip: 'bg-secondary', text: 'text-secondary-foreground', icon: 'ReceiptText' as const };
}

function TransactionRow({ payment, student }: { payment: PaymentRecord; student?: Student }) {
  const status = paymentStatusPresentation(payment);
  const paymentDetail = [payment.payment_type, payment.payment_method].filter(Boolean).join(' · ') || 'Payment details unavailable';
  const visitorName = payment.vistor_name?.trim();
  const name = student ? fullName(student) : visitorName || (payment.student_id === null ? 'Visitor payment' : `Student ID ${payment.student_id}`);
  return <View className="flex-row items-center rounded-2xl border border-border bg-card px-4 py-3.5"><View className={`h-10 w-10 items-center justify-center rounded-xl ${status.chip}`}><LucideIcon name={status.icon} className={`h-5 w-5 ${status.text}`} /></View><View className="ml-3 min-w-0 flex-1"><View className="flex-row items-start justify-between gap-3"><Text numberOfLines={1} className="flex-1 font-bold text-foreground">{name}</Text><Text className="shrink-0 text-sm font-bold text-foreground">{formatMoney(Number(payment.amount))}</Text></View><Text numberOfLines={1} className="mt-0.5 text-xs text-muted-foreground">{paymentDetail} · {paymentDate(payment.created_at)}</Text><View className={`mt-2 self-start rounded-full px-2.5 py-1 ${status.chip}`}><Text className={`text-[11px] font-bold ${status.text}`}>{status.label}</Text></View></View></View>;
}
