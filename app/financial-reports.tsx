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
import { formatTimestampDate } from '@/lib/date';

type PaymentRecord = {
  id: number;
  created_at: string;
  student_id: number;
  amount: number;
  payment_method: string | null;
  payment_status: string | null;
  payment_type: string | null;
  notes: string | null;
  vistor_name: string | null;
};

type Timeframe = 'today' | 'week' | 'month' | 'all';

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function isWithinTimeframe(value: string, timeframe: Timeframe, now: Date) {
  if (timeframe === 'all') return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  if (timeframe === 'today') return localDateKey(date) === localDateKey(now);
  const days = timeframe === 'week' ? 7 : 30;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return date.getTime() >= start.getTime() && date.getTime() <= now.getTime();
}

function timeframeLabel(timeframe: Timeframe) {
  if (timeframe === 'today') return 'Today';
  if (timeframe === 'week') return 'Last 7 days';
  if (timeframe === 'month') return 'Last 30 days';
  return 'All time';
}

function normalizedStatus(payment: PaymentRecord) {
  return payment.payment_status?.trim().toLowerCase() ?? '';
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount);
}

function paymentDate(value: string) {
  return formatTimestampDate(value);
}

export default function FinancialReportsScreen() {
  const router = useRouter();
  const [payments, setPayments] = React.useState<PaymentRecord[]>([]);
  const [students, setStudents] = React.useState<Student[]>([]);
  const [timeframe, setTimeframe] = React.useState<Timeframe>('month');
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
          const [paymentsResponse, studentsResponse] = await Promise.all([
            database.listPayments<PaymentRecord>(),
            database.listStudents<Student>(),
          ]);
          if (!isActive) return;
          setPayments((paymentsResponse as PaymentRecord[]).sort((first, second) => new Date(second.created_at).getTime() - new Date(first.created_at).getTime()));
          setStudents(studentsResponse as Student[]);
        } catch {
          if (isActive) setErrorMessage('Live payment data could not be loaded. Try again.');
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
  const filteredPayments = React.useMemo(
    () => payments.filter((payment) => isWithinTimeframe(payment.created_at, timeframe, now)),
    [payments, timeframe, now.getDate(), now.getMonth(), now.getFullYear()],
  );
  const studentsById = React.useMemo(() => new Map(students.map((student) => [student.studentId, student])), [students]);
  const paidPayments = React.useMemo(() => filteredPayments.filter((payment) => normalizedStatus(payment) === 'paid'), [filteredPayments]);
  const pendingPayments = React.useMemo(() => filteredPayments.filter((payment) => normalizedStatus(payment) === 'pending'), [filteredPayments]);
  const latePayments = React.useMemo(() => filteredPayments.filter((payment) => ['late', 'overdue'].includes(normalizedStatus(payment))), [filteredPayments]);
  const paidTotal = React.useMemo(() => paidPayments.reduce((total, payment) => total + Number(payment.amount), 0), [paidPayments]);
  const pendingTotal = React.useMemo(() => pendingPayments.reduce((total, payment) => total + Number(payment.amount), 0), [pendingPayments]);
  const lateTotal = React.useMemo(() => latePayments.reduce((total, payment) => total + Number(payment.amount), 0), [latePayments]);
  const methodTotals = React.useMemo(() => {
    const byMethod = new Map<string, { count: number; amount: number }>();
    filteredPayments.forEach((payment) => {
      const method = payment.payment_method?.trim() || 'Method unavailable';
      const current = byMethod.get(method) ?? { count: 0, amount: 0 };
      byMethod.set(method, { count: current.count + 1, amount: current.amount + Number(payment.amount) });
    });
    return Array.from(byMethod.entries()).map(([method, totals]) => ({ method, ...totals })).sort((first, second) => second.amount - first.amount);
  }, [filteredPayments]);

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <FlatList
        data={isLoading || errorMessage ? [] : filteredPayments}
        keyExtractor={(payment) => String(payment.id)}
        contentContainerClassName="px-5 pb-8"
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => <TransactionRow payment={item} student={studentsById.get(item.student_id)} first={index === 0} last={index === filteredPayments.length - 1} />}
        ListHeaderComponent={
          <View className="pt-4">
            <View className="flex-row items-center justify-between">
              <Pressable accessibilityRole="button" accessibilityLabel="Back to finance" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/finance'); }} className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent">
                <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
              </Pressable>
              <Text className="text-lg font-bold text-foreground">Financial reports</Text>
              <View className="h-10 w-10" />
            </View>
            <View className="mt-6">
              <AppHeader title="GRAU" dataLabel="Live payment data" />
              <Text className="text-3xl font-bold tracking-tight text-foreground">Financial reports</Text>
              <Text className="mt-2 text-sm leading-5 text-muted-foreground">A live summary of recorded member payments.</Text>
            </View>
            <View className="mt-6 flex-row flex-wrap gap-2">
              {(['today', 'week', 'month', 'all'] as Timeframe[]).map((option) => {
                const selected = timeframe === option;
                return <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`Show ${timeframeLabel(option).toLowerCase()} payments`} onPress={() => setTimeframe(option)} className={`rounded-full px-3.5 py-2 ${selected ? 'bg-primary' : 'border border-border bg-card active:bg-accent'}`}><Text className={`text-xs font-bold ${selected ? 'text-primary-foreground' : 'text-muted-foreground'}`}>{timeframeLabel(option)}</Text></Pressable>;
              })}
            </View>
            {isLoading ? <LoadingState /> : null}
            {errorMessage ? <ErrorState message={errorMessage} onRetry={() => setRefreshKey((key) => key + 1)} /> : null}
            {!isLoading && !errorMessage ? <>
              <View className="mt-7 overflow-hidden rounded-3xl bg-primary p-5"><Text className="text-sm font-semibold text-primary-foreground/70">RECEIVED · {timeframeLabel(timeframe).toUpperCase()}</Text><Text className="mt-2 text-4xl font-bold tracking-tight text-primary-foreground">{formatMoney(paidTotal)}</Text><Text className="mt-2 text-sm text-primary-foreground/75">{paidPayments.length} paid payment{paidPayments.length === 1 ? '' : 's'} received</Text></View>
              <View className="mt-4 flex-row gap-3"><Metric value={`${pendingPayments.length} · ${formatMoney(pendingTotal)}`} label="pending" tone="warning" /><Metric value={`${latePayments.length} · ${formatMoney(lateTotal)}`} label="late / overdue" tone="destructive" /></View>
              <View className="mb-3 mt-8 flex-row items-end justify-between"><Text className="text-xl font-bold tracking-tight text-foreground">By payment method</Text><Text className="text-sm font-medium text-tertiary">Recorded totals</Text></View>
              {methodTotals.length ? <View className="rounded-2xl border border-border bg-card px-4">{methodTotals.map((methodTotal, index) => <MethodRow key={methodTotal.method} {...methodTotal} last={index === methodTotals.length - 1} />)}</View> : <UnavailableMethodState />}
              <View className="mb-3 mt-8 flex-row items-end justify-between"><Text className="text-xl font-bold tracking-tight text-foreground">Recent transactions</Text><Text className="text-sm font-medium text-tertiary">Newest first</Text></View>
            </> : null}
          </View>
        }
        ListEmptyComponent={!isLoading && !errorMessage ? <EmptyState timeframe={timeframe} /> : null}
      />
    </SafeAreaView>
  );
}

function LoadingState() {
  return <View className="items-center py-24"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading live payments…</Text></View>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <View className="mt-8 items-center rounded-3xl bg-destructive/10 px-6 py-10"><LucideIcon name="CircleAlert" className="mb-3 h-7 w-7 text-destructive" /><Text className="text-center font-bold text-foreground">Financial reports unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{message}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry payment loading" onPress={onRetry} className="mt-5 rounded-xl bg-primary px-4 py-2.5"><Text className="font-bold text-primary-foreground">Retry</Text></Pressable></View>;
}

function Metric({ value, label, tone }: { value: string; label: string; tone: 'warning' | 'destructive' }) {
  const icon = tone === 'warning' ? 'Clock3' : 'CircleAlert';
  const iconColor = tone === 'warning' ? 'text-warning' : 'text-destructive';
  const iconBackground = tone === 'warning' ? 'bg-warning/15' : 'bg-destructive/10';
  return <View className="flex-1 rounded-2xl border border-border bg-card p-4"><View className={`mb-5 h-9 w-9 items-center justify-center rounded-xl ${iconBackground}`}><LucideIcon name={icon} className={`h-4 w-4 ${iconColor}`} /></View><Text className="text-lg font-bold text-foreground">{value}</Text><Text className="mt-1 text-xs leading-4 text-muted-foreground">{label}</Text></View>;
}

function MethodRow({ method, count, amount, last }: { method: string; count: number; amount: number; last: boolean }) {
  return <View className={`flex-row items-center py-4 ${last ? '' : 'border-b border-border'}`}><View className="h-10 w-10 items-center justify-center rounded-xl bg-tertiary/15"><LucideIcon name="CreditCard" className="h-4 w-4 text-tertiary" /></View><View className="ml-3 flex-1"><Text className="font-bold text-foreground">{method}</Text><Text className="mt-0.5 text-xs text-muted-foreground">{count} recorded payment{count === 1 ? '' : 's'}</Text></View><Text className="text-sm font-bold text-foreground">{formatMoney(amount)}</Text></View>;
}

function TransactionRow({ payment, student, first, last }: { payment: PaymentRecord; student?: Student; first: boolean; last: boolean }) {
  const status = payment.payment_status?.trim() || 'Status unavailable';
  const statusTone = normalizedStatus(payment) === 'paid' ? 'success' : ['late', 'overdue'].includes(normalizedStatus(payment)) ? 'destructive' : 'warning';
  const pillClass = statusTone === 'success' ? 'bg-success/15 text-success' : statusTone === 'destructive' ? 'bg-destructive/10 text-destructive' : 'bg-warning/15 text-warning';
  const paymentDetail = [payment.payment_type, payment.payment_method].filter(Boolean).join(' · ') || 'Payment details unavailable';
  return <View className={`flex-row border-border bg-card px-4 py-4 ${first ? 'rounded-t-2xl' : ''} ${last ? 'rounded-b-2xl' : 'border-b'}`}><MemberAvatar initials={student ? studentInitials(student) : '?'} photoUrl={student?.photo_url} /><View className="ml-3 flex-1"><View className="flex-row items-start justify-between gap-3"><Text className="flex-1 font-bold text-foreground">{student ? fullName(student) : `Student ID ${payment.student_id}`}</Text><Text className="text-sm font-bold text-foreground">{formatMoney(Number(payment.amount))}</Text></View><Text className="mt-1 text-sm text-muted-foreground">{paymentDetail}</Text><View className="mt-2 flex-row items-center justify-between"><Text className="text-xs text-muted-foreground">{paymentDate(payment.created_at)}</Text><View className={`rounded-full px-2.5 py-1 ${pillClass.split(' ')[0]}`}><Text className={`text-xs font-bold ${pillClass.split(' ')[1]}`}>{status}</Text></View></View></View></View>;
}

function UnavailableMethodState() {
  return <View className="items-center rounded-2xl border border-border bg-card px-6 py-8"><Text className="font-bold text-foreground">Payment methods unavailable</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">There are no recorded payment methods for this period.</Text></View>;
}

function EmptyState({ timeframe }: { timeframe: Timeframe }) {
  return <View className="items-center rounded-2xl border border-border bg-card px-6 py-12"><View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary"><LucideIcon name="ReceiptText" className="h-6 w-6 text-tertiary" /></View><Text className="mt-4 text-lg font-bold text-foreground">No payments found</Text><Text className="mt-2 max-w-[280px] text-center text-sm leading-5 text-muted-foreground">No payment records were created during {timeframeLabel(timeframe).toLowerCase()}.</Text></View>;
}
