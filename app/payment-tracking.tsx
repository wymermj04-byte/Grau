import * as React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { AppHeader } from '@/components/gym/AppHeader';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { Text } from '@/components/ui/text';
import { ThemedTextInput } from '@/components/ui/themed-text-input';
import { database, isPaymentTrackingSchemaAbsent, resolveActiveGymMembership } from '@/lib/database';
import LucideIcon from '@/lib/icons/LucideIcon';
import { newPaymentMethods, type NewPaymentMethod } from '@/lib/payment-methods';
import { fullName, type Student } from '@/lib/students';
import { createWaiverIdempotencyKey } from '@/lib/waiver-submission';
import { formatTimestampDate } from '@/lib/date';

type MonthlyAccount = {
  account_id: number;
  account_kind: 'individual' | 'family';
  account_label: string;
  coverage_status: 'active' | 'exempt' | 'inactive';
  month_start: string;
  covered_member_ids: number[];
  manual_status: 'paid' | 'partial' | 'no_payment_recorded';
  timing_status: 'upcoming' | 'grace' | 'overdue';
  display_status: string;
  is_overdue: boolean;
  recorded_payment_count: number | string;
  recorded_payment_total: number | string;
};

type ExistingPayment = {
  id: number;
  student_id: number | null;
  amount: number | string;
  payment_status: string | null;
  payment_type: string | null;
  created_at: string;
};

type ExistingPaymentLinkResult = {
  payment_id: number;
  account_month_id: number;
};

type ManualStatus = MonthlyAccount['manual_status'];

const FIRST_TRACKING_MONTH = new Date(2026, 9, 1);
const paymentTypes = ['Membership', 'Class pack', 'Private lesson', 'Other'] as const;

function isoMonth(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function trackingMonthLabel(monthStart: string) {
  const match = /^(\d{4})-(\d{2})-01$/.exec(monthStart);
  if (!match) return monthStart;

  return monthLabel(new Date(Number(match[1]), Number(match[2]) - 1, 1));
}

function formatMoney(value: number | string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function accountStatusPresentation(account: Pick<MonthlyAccount, 'manual_status' | 'is_overdue'>) {
  if (account.is_overdue) return { label: 'Overdue', tone: 'bg-destructive/10 text-destructive' };
  if (account.manual_status === 'paid') return { label: 'Paid', tone: 'bg-success/15 text-success' };
  if (account.manual_status === 'partial') return { label: 'Partial', tone: 'bg-warning/15 text-warning' };
  return { label: 'No payment recorded', tone: 'bg-secondary text-secondary-foreground' };
}

export default function PaymentTrackingScreen() {
  const router = useRouter();
  const [month, setMonth] = React.useState(() => {
    const now = new Date();
    return now < FIRST_TRACKING_MONTH ? FIRST_TRACKING_MONTH : new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [accounts, setAccounts] = React.useState<MonthlyAccount[]>([]);
  const [students, setStudents] = React.useState<Student[]>([]);
  const [role, setRole] = React.useState<string | null>(null);
  const [state, setState] = React.useState<'loading' | 'ready' | 'setup-needed' | 'error'>('loading');
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<MonthlyAccount | null>(null);
  const [isSettingUpAccount, setIsSettingUpAccount] = React.useState(false);
  const [refreshToken, setRefreshToken] = React.useState(0);

  const load = React.useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const capability = await database.getPaymentTrackingCapability();
      if (capability === 'absent') {
        setAccounts([]);
        setStudents([]);
        setState('setup-needed');
        return;
      }
      const [report, memberRecords, membership] = await Promise.all([
        database.getPaymentTrackingMonthlyReport<MonthlyAccount>(isoMonth(month)),
        database.listStudents<Student>(),
        resolveActiveGymMembership(),
      ]);
      setAccounts(report);
      setStudents(memberRecords);
      setRole(membership.role);
      setState('ready');
    } catch (loadError) {
      if (isPaymentTrackingSchemaAbsent(loadError)) {
        setState('setup-needed');
      } else {
        setState('error');
        setError('Payment tracking could not be loaded. Try again.');
      }
    }
  }, [month]);

  useFocusEffect(React.useCallback(() => {
    void load();
  }, [load, refreshToken]));

  const studentsById = React.useMemo(() => new Map(students.map((student) => [student.studentId, student])), [students]);
  const isAdmin = role === 'admin';
  const canGoPrevious = month.getTime() > FIRST_TRACKING_MONTH.getTime();

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-10" keyboardShouldPersistTaps="handled">
        <View className="w-full max-w-2xl self-center pt-4">
          <AppHeader title="Payment tracking" dataLabel={state === 'ready' ? 'Monthly tracking' : 'Tracking unavailable'} />
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Finance" onPress={() => router.dismissTo('/(tabs)/finance')} className="mb-5 flex-row items-center gap-2 self-start rounded-xl border border-border bg-card px-3 py-2 active:bg-accent">
            <LucideIcon name="ArrowLeft" className="h-4 w-4 text-foreground" />
            <Text className="text-sm font-bold text-foreground">Finance</Text>
          </Pressable>

          {state === 'loading' ? <LoadingState /> : null}
          {state === 'setup-needed' ? <SetupNeeded /> : null}
          {state === 'error' ? <ErrorState message={error} onRetry={() => setRefreshToken((value) => value + 1)} /> : null}
          {state === 'ready' ? (
            <>
              <MonthSelector
                label={monthLabel(month)}
                canGoPrevious={canGoPrevious}
                onPrevious={() => canGoPrevious && setMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))}
                onNext={() => setMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))}
              />
              {!canGoPrevious ? <Text className="-mt-2 mb-5 text-center text-sm leading-5 text-muted-foreground">Monthly payment tracking begins October 2026. To view earlier payments, use Finance.</Text> : null}
              <View className="mb-6 rounded-2xl border border-tertiary/30 bg-tertiary/10 p-4">
                <Text className="font-bold text-foreground">Manual monthly tracking</Text>
                <Text className="mt-1 text-sm leading-5 text-muted-foreground">Monthly status is managed separately by staff. Recorded payments do not automatically mark dues as paid.</Text>
              </View>
              {isAdmin ? <Pressable accessibilityRole="button" accessibilityLabel="Set up a payment tracking account" onPress={() => setIsSettingUpAccount(true)} className="mb-5 flex-row items-center justify-center gap-2 rounded-2xl border border-primary bg-primary py-3.5 active:opacity-85"><LucideIcon name="UserRoundPlus" className="h-5 w-5 text-primary-foreground" /><Text className="font-bold text-primary-foreground">Set up tracking account</Text></Pressable> : null}
              <View className="mb-3 flex-row items-end justify-between gap-3">
                <View><Text className="text-lg font-bold text-foreground">Monthly accounts</Text><Text className="mt-0.5 text-sm text-muted-foreground">{accounts.length} account{accounts.length === 1 ? '' : 's'} for {monthLabel(month)}</Text></View>
                <Text className="text-sm font-semibold text-muted-foreground">Open details</Text>
              </View>
              {accounts.length ? accounts.map((account) => (
                <AccountCard
                  key={account.account_id}
                  account={account}
                  memberNames={account.covered_member_ids.map((id) => studentsById.get(id)).filter(Boolean).map((student) => fullName(student as Student))}
                  onSelect={() => setSelected(account)}
                />
              )) : <EmptyState />}
              {!isAdmin ? <View className="mt-5 rounded-2xl border border-border bg-card p-4"><Text className="font-bold text-foreground">Read-only access</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">Coaches can review monthly tracking. Only active administrators can record payments or change monthly statuses.</Text></View> : null}
            </>
          ) : null}
        </View>
      </ScrollView>

      {selected ? <AccountSheet account={selected} isAdmin={isAdmin} studentsById={studentsById} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); setRefreshToken((value) => value + 1); }} onLinked={() => setRefreshToken((value) => value + 1)} /> : null}
      {isSettingUpAccount && state === 'ready' ? <AccountSetupSheet students={students} onClose={() => setIsSettingUpAccount(false)} onSaved={() => { setIsSettingUpAccount(false); setRefreshToken((value) => value + 1); }} /> : null}
    </SafeAreaView>
  );
}

function MonthSelector({ label, canGoPrevious, onPrevious, onNext }: { label: string; canGoPrevious: boolean; onPrevious: () => void; onNext: () => void }) {
  return <View className="mb-5 flex-row items-center justify-between rounded-2xl border border-border bg-card p-2"><Pressable accessibilityRole="button" accessibilityLabel="Previous tracking month" disabled={!canGoPrevious} onPress={onPrevious} className={`h-10 w-10 items-center justify-center rounded-xl ${canGoPrevious ? 'active:bg-accent' : 'opacity-35'}`}><LucideIcon name="ChevronLeft" className="h-5 w-5 text-foreground" /></Pressable><Text className="font-bold text-foreground">{label}</Text><Pressable accessibilityRole="button" accessibilityLabel="Next tracking month" onPress={onNext} className="h-10 w-10 items-center justify-center rounded-xl active:bg-accent"><LucideIcon name="ChevronRight" className="h-5 w-5 text-foreground" /></Pressable></View>;
}

function AccountCard({ account, memberNames, onSelect }: { account: MonthlyAccount; memberNames: string[]; onSelect: () => void }) {
  const linkedPaymentCount = Number(account.recorded_payment_count) || 0;
  const hasLinkedPayments = linkedPaymentCount > 0;
  const status = accountStatusPresentation(account);

  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${account.account_label} payment tracking`} onPress={onSelect} className="mb-3 rounded-2xl border border-border bg-card p-4 active:bg-accent">
    <View className="flex-row items-start justify-between gap-3">
      <View className="flex-1">
        <Text className="font-bold text-foreground">{account.account_label}</Text>
        <Text className="mt-1 text-sm capitalize text-muted-foreground">{account.account_kind} account · {memberNames.join(', ') || 'No covered members'}</Text>
      </View>
      <View className="items-end">
        <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Monthly status</Text>
        <View className={`mt-1 rounded-full px-2.5 py-1 ${status.tone.split(' ')[0]}`}>
          <Text className={`text-xs font-bold ${status.tone.split(' ').slice(1).join(' ')}`}>{status.label}</Text>
        </View>
      </View>
    </View>
    <View className="mt-4 border-t border-border pt-3">
      <View className="flex-row items-center justify-between gap-3"><View className="flex-1 flex-row items-center gap-2">{hasLinkedPayments ? <LucideIcon name="CircleCheck" className="h-4 w-4 text-success" /> : null}<Text className={`text-sm font-bold ${hasLinkedPayments ? 'text-success' : 'text-muted-foreground'}`}>{hasLinkedPayments ? 'Linked payments' : 'No linked payments'}</Text></View><Text className="font-bold text-foreground">{formatMoney(account.recorded_payment_total)}</Text></View>
      <Text className="mt-1 text-xs text-muted-foreground">{linkedPaymentCount} linked payment{linkedPaymentCount === 1 ? '' : 's'} · {account.timing_status}</Text>
      <View className="mt-3 flex-row items-center gap-1"><Text className="text-sm font-bold text-primary">Open account details</Text><LucideIcon name="ChevronRight" className="h-4 w-4 text-primary" /></View>
    </View>
  </Pressable>;
}

function AccountSetupSheet({ students, onClose, onSaved }: { students: Student[]; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = React.useState<'individual' | 'family'>('individual');
  const [label, setLabel] = React.useState('');
  const [startMonth, setStartMonth] = React.useState(isoMonth(FIRST_TRACKING_MONTH));
  const [coverageStatus, setCoverageStatus] = React.useState<'active' | 'exempt' | 'inactive'>('active');
  const [selectedMemberIds, setSelectedMemberIds] = React.useState<number[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const idempotencyKey = React.useRef<string | null>(null);

  const resetRetry = () => { idempotencyKey.current = null; };
  const chooseKind = (nextKind: 'individual' | 'family') => {
    setKind(nextKind);
    setSelectedMemberIds((memberIds) => nextKind === 'individual' ? memberIds.slice(0, 1) : memberIds);
    resetRetry();
  };
  const toggleMember = (studentId: number) => {
    setSelectedMemberIds((memberIds) => {
      if (kind === 'individual') return memberIds[0] === studentId ? [] : [studentId];
      return memberIds.includes(studentId) ? memberIds.filter((id) => id !== studentId) : [...memberIds, studentId];
    });
    resetRetry();
  };
  const save = async () => {
    const monthParts = /^(\d{4})-(0[1-9]|1[0-2])-01$/.exec(startMonth);
    const parsedMonth = monthParts ? new Date(Number(monthParts[1]), Number(monthParts[2]) - 1, 1) : null;
    if (!label.trim() || !parsedMonth || parsedMonth < FIRST_TRACKING_MONTH || selectedMemberIds.length === 0 || (kind === 'individual' && selectedMemberIds.length !== 1)) {
      setMessage('Choose covered members, enter a label, and use a start month of October 2026 or later.');
      return;
    }
    idempotencyKey.current ??= createWaiverIdempotencyKey();
    setSaving(true);
    setMessage(null);
    try {
      await database.createPaymentTrackingAccount({ accountKind: kind, accountLabel: label.trim(), effectiveStartMonth: startMonth, effectiveEndMonth: null, memberIds: selectedMemberIds, coverageStatus, idempotencyKey: idempotencyKey.current });
      onSaved();
    } catch {
      setMessage('Account setup could not be saved. Retrying preserves this request key.');
    } finally {
      setSaving(false);
    }
  };

  return <View className="absolute inset-0 justify-end bg-foreground/30"><View className="max-h-[90%] rounded-t-3xl bg-background px-5 pb-8 pt-5"><View className="mb-5 flex-row items-start justify-between gap-3"><View className="flex-1"><Text className="text-xl font-bold text-foreground">Set up tracking account</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">Only active-gym members can be covered. This does not create a payment.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close account setup" onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"><LucideIcon name="X" className="h-5 w-5 text-foreground" /></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><Choice label="Account type" value={kind} options={['individual', 'family'] as const} onChange={chooseKind} /><Field label="Account label" value={label} onChange={(value) => { setLabel(value); resetRetry(); }} placeholder="e.g. Melissa Family" /><Field label="Start month" value={startMonth} onChange={(value) => { setStartMonth(value); resetRetry(); }} placeholder="YYYY-MM-01" /><Choice label="Coverage status" value={coverageStatus} options={['active', 'exempt', 'inactive'] as const} onChange={(value) => { setCoverageStatus(value); resetRetry(); }} /><Text className="mb-2 mt-5 text-sm font-bold text-foreground">Covered members</Text><Text className="mb-3 text-sm leading-5 text-muted-foreground">{kind === 'individual' ? 'Choose one member.' : 'Choose one or more members.'}</Text><View className="gap-2">{students.map((student) => { const selected = selectedMemberIds.includes(student.studentId); return <Pressable key={student.studentId} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => toggleMember(student.studentId)} className={`flex-row items-center justify-between rounded-xl border px-3 py-3 ${selected ? 'border-primary bg-primary/10' : 'border-border bg-card active:bg-accent'}`}><Text className="font-semibold text-foreground">{fullName(student)}</Text><LucideIcon name={selected ? 'CircleCheck' : 'Circle'} className={`h-5 w-5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} /></Pressable>; })}</View>{message ? <View className="mt-5 rounded-2xl bg-destructive/10 p-3"><Text className="text-sm text-destructive">{message}</Text></View> : null}<Pressable accessibilityRole="button" disabled={saving} onPress={save} className={`mt-6 items-center rounded-2xl bg-primary py-3.5 ${saving ? 'opacity-60' : ''}`}><Text className="font-bold text-primary-foreground">{saving ? 'Saving…' : 'Create tracking account'}</Text></Pressable></ScrollView></View></View>;
}

function AccountSheet({ account, isAdmin, studentsById, onClose, onSaved, onLinked }: {
  account: MonthlyAccount;
  isAdmin: boolean;
  studentsById: Map<number, Student>;
  onClose: () => void;
  onSaved: () => void;
  onLinked: () => void;
}) {
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState<NewPaymentMethod>('Cash');
  const [paymentType, setPaymentType] = React.useState<(typeof paymentTypes)[number]>('Membership');
  const [payerLabel, setPayerLabel] = React.useState(account.account_label);
  const [receivedOn, setReceivedOn] = React.useState(todayIso());
  const [checkNumber, setCheckNumber] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [isPaymentFormOpen, setIsPaymentFormOpen] = React.useState(false);
  const [isReviewingPayment, setIsReviewingPayment] = React.useState(false);
  const [paymentError, setPaymentError] = React.useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = React.useState<ManualStatus | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const paymentKey = React.useRef<string | null>(null);
  const statusKeys = React.useRef(new Map<string, string>());
  const coverageMonth = trackingMonthLabel(account.month_start);
  const linkedPaymentCount = Number(account.recorded_payment_count) || 0;
  const hasLinkedPayments = linkedPaymentCount > 0;
  const currentStatusLabel = account.manual_status.replace(/_/g, ' ');
  const currentStatus = accountStatusPresentation(account);
  const coveredMemberNames = account.covered_member_ids
    .map((id) => studentsById.get(id))
    .filter((student): student is Student => Boolean(student))
    .map(fullName);
  const resetPaymentRetry = () => { paymentKey.current = null; setPaymentError(null); setIsReviewingPayment(false); };
  const resetStatusRetry = () => { statusKeys.current.clear(); };

  const requestPaymentConfirmation = () => {
    const parsedAmount = Number(amount);
    if (!isAdmin || saving || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || !payerLabel.trim() || !receivedOn) {
      setMessage('Enter an amount, payer, and received date.');
      return;
    }
    setMessage(null);
    setPaymentError(null);
    setIsReviewingPayment(true);
  };

  const recordPayment = async () => {
    const parsedAmount = Number(amount);
    if (!isAdmin || saving || !Number.isFinite(parsedAmount) || parsedAmount <= 0 || !payerLabel.trim() || !receivedOn) {
      setMessage('Enter an amount, payer, and received date.');
      return;
    }
    paymentKey.current ??= createWaiverIdempotencyKey();
    setSaving(true);
    setMessage(null);
    setPaymentError(null);
    try {
      await database.recordPaymentTrackingPayment({ accountId: account.account_id, monthStart: account.month_start, amount: parsedAmount, paymentMethod: method, paymentType, notes: notes.trim(), payerLabel: payerLabel.trim(), receivedOn, checkNumber: checkNumber.trim(), idempotencyKey: paymentKey.current });
      onSaved();
    } catch {
      setPaymentError('Payment could not be recorded. Your retry will use the same request key.');
    } finally {
      setSaving(false);
    }
  };

  const requestStatusConfirmation = (status: ManualStatus) => {
    if (!isAdmin || saving) return;
    const isInitialSet = account.manual_status === 'no_payment_recorded' && status !== 'no_payment_recorded';
    if (!isInitialSet && !reason.trim()) {
      setMessage('A reason is required when correcting an existing monthly status.');
      return;
    }

    setMessage(null);
    setStatusError(null);
    setPendingStatus(status);
  };

  const setStatus = async () => {
    if (!pendingStatus || !isAdmin || saving) return;
    const status = pendingStatus;
    const key = `${status}:${reason.trim()}`;
    const idempotencyKey = statusKeys.current.get(key) ?? createWaiverIdempotencyKey();
    statusKeys.current.set(key, idempotencyKey);
    setSaving(true);
    setMessage(null);
    setStatusError(null);
    try {
      await database.setPaymentTrackingMonthStatus({ accountId: account.account_id, monthStart: account.month_start, status, reason: reason.trim(), idempotencyKey });
      onSaved();
    } catch {
      setStatusError('Monthly status could not be saved. Check the reason if this is a correction, then retry with the same request.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="absolute inset-0 justify-end bg-foreground/30">
      <View className="max-h-[90%] rounded-t-3xl bg-background px-5 pb-8 pt-5">
        <View className="mb-5 flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <Text className="text-xl font-bold text-foreground">{account.account_label}</Text>
            <Text className="mt-1 text-sm text-muted-foreground">{account.account_kind} account · {Number(account.recorded_payment_count) > 0 ? `${formatMoney(account.recorded_payment_total)} in linked payments` : 'No payment recorded'}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close payment tracking" onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card">
            <LucideIcon name="X" className="h-5 w-5 text-foreground" />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerClassName="pb-8">
          <View className="rounded-2xl border border-tertiary/30 bg-tertiary/10 p-4">
            <Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Selected dues month</Text>
            <Text className="mt-1 text-lg font-bold text-foreground">{coverageMonth}</Text>
            <View className="mt-4 flex-row items-center justify-between gap-3">
              <View className="flex-1"><Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Current monthly status</Text><Text className="mt-1 text-sm capitalize text-foreground">{currentStatusLabel}</Text></View>
              <View className={`rounded-full px-2.5 py-1 ${currentStatus.tone.split(' ')[0]}`}><Text className={`text-xs font-bold ${currentStatus.tone.split(' ').slice(1).join(' ')}`}>{currentStatus.label}</Text></View>
            </View>
            <View className="mt-4 border-t border-tertiary/20 pt-3">
              <View className="flex-row items-center justify-between gap-3"><View className="flex-1"><Text className={`text-sm font-bold ${hasLinkedPayments ? 'text-success' : 'text-muted-foreground'}`}>{hasLinkedPayments ? 'Payment recorded' : 'No payment recorded'}</Text><Text className="mt-0.5 text-xs text-muted-foreground">{linkedPaymentCount} linked payment{linkedPaymentCount === 1 ? '' : 's'}</Text></View><Text className="font-bold text-foreground">{formatMoney(account.recorded_payment_total)}</Text></View>
            </View>
          </View>
          {isAdmin ? (
            <>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: isPaymentFormOpen }} disabled={saving} onPress={() => setIsPaymentFormOpen((open) => !open)} className={`mt-5 flex-row items-center justify-center gap-2 rounded-2xl border border-primary bg-primary py-3.5 ${saving ? 'opacity-60' : 'active:opacity-85'}`}>
                <LucideIcon name={isPaymentFormOpen ? 'ChevronUp' : 'Plus'} className="h-5 w-5 text-primary-foreground" />
                <Text className="font-bold text-primary-foreground">{isPaymentFormOpen ? 'Hide payment form' : 'Add payment'}</Text>
              </Pressable>
              {isPaymentFormOpen ? <>
                <Text className="mt-6 text-sm font-bold text-foreground">Record payment</Text>
                <View className="mt-4 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3">
                  <Text className="text-xs font-bold text-primary">Payment covers</Text>
                  <Text className="mt-1 text-lg font-bold text-foreground">{coverageMonth}</Text>
                  <Text className="mt-1 text-sm leading-5 text-muted-foreground">This is the tracking month for this payment, separate from the received date.</Text>
                </View>
                <Field label="Amount" value={amount} onChange={(value) => { setAmount(value); resetPaymentRetry(); }} keyboardType="decimal-pad" placeholder="0.00" />
                <Choice label="Method" value={method} options={newPaymentMethods} onChange={(value) => { setMethod(value); resetPaymentRetry(); }} />
                <Choice label="Payment type" value={paymentType} options={paymentTypes} onChange={(value) => { setPaymentType(value); resetPaymentRetry(); }} />
                <Field label="Payer or family label" value={payerLabel} onChange={(value) => { setPayerLabel(value); resetPaymentRetry(); }} />
                <Field label="Received date" value={receivedOn} onChange={(value) => { setReceivedOn(value); resetPaymentRetry(); }} placeholder="YYYY-MM-DD" />
                <Field label="Check number (optional)" value={checkNumber} onChange={(value) => { setCheckNumber(value); resetPaymentRetry(); }} />
                <Field label="Notes (optional)" value={notes} onChange={(value) => { setNotes(value); resetPaymentRetry(); }} multiline />
                <Pressable accessibilityRole="button" disabled={saving} onPress={requestPaymentConfirmation} className={`mt-5 items-center rounded-2xl bg-primary py-3.5 ${saving ? 'opacity-60' : ''}`}>
                  <Text className="font-bold text-primary-foreground">Review payment</Text>
                </Pressable>
              </> : null}

              <View className="my-7 border-t border-border" />
              <ExistingPaymentLinker
                account={account}
                coveredMemberNames={coveredMemberNames}
                studentsById={studentsById}
                disabled={saving}
                onSuccess={onLinked}
              />

              <View className="my-7 border-t border-border" />
              <Text className="text-sm font-bold text-foreground">Monthly status</Text>
              <Text className="mt-1 text-sm leading-5 text-muted-foreground">Monthly status is managed separately by staff. A reason is required when correcting the current status.</Text>
              <Field label="Status change reason" value={reason} onChange={(value) => { setReason(value); resetStatusRetry(); setPendingStatus(null); setStatusError(null); }} placeholder="Required for corrections" multiline />
              <View className="mt-3 flex-row flex-wrap gap-2">
                {(['paid', 'partial', 'no_payment_recorded'] as const).map((status) => (
                  <Pressable key={status} accessibilityRole="button" accessibilityState={{ selected: status === account.manual_status }} disabled={saving} onPress={() => requestStatusConfirmation(status)} className={`rounded-xl border px-3 py-2 ${status === account.manual_status ? 'border-primary bg-primary/10' : 'border-border bg-card active:bg-accent'}`}>
                    <Text className="text-sm font-bold capitalize text-foreground">{status.replace(/_/g, ' ')}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <Text className="text-sm leading-5 text-muted-foreground">Only an active administrator can record payments or change this month’s status.</Text>
          )}
          {message ? <View className="mt-5 rounded-2xl bg-destructive/10 p-3"><Text className="text-sm text-destructive">{message}</Text></View> : null}
        </ScrollView>
      </View>
      {pendingStatus ? (
        <ConfirmationDialog
          title="Confirm monthly status"
          description="Review this manual status change before saving it."
          footer={<View className="flex-row gap-2">
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel monthly status change" disabled={saving} onPress={() => { setPendingStatus(null); setStatusError(null); }} className={`flex-1 items-center rounded-xl border border-border bg-card px-4 py-3 ${saving ? 'opacity-60' : 'active:bg-accent'}`}>
              <Text className="font-bold text-foreground">Cancel</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Confirm monthly status change" disabled={saving} onPress={() => void setStatus()} className={`flex-1 items-center rounded-xl bg-primary px-4 py-3 ${saving ? 'opacity-60' : 'active:opacity-85'}`}>
              <Text className="font-bold text-primary-foreground">{saving ? 'Saving status…' : 'Confirm status'}</Text>
            </Pressable>
          </View>}>
          <View className="gap-3 rounded-xl border border-border bg-card p-4">
            <StatusConfirmationDetail label="Account" value={account.account_label} />
            <StatusConfirmationDetail label="Dues month" value={coverageMonth} />
            <StatusConfirmationDetail label="Current manual status" value={currentStatusLabel} />
            <StatusConfirmationDetail label="Requested status" value={pendingStatus.replace(/_/g, ' ')} />
            <StatusConfirmationDetail label="Linked-payment total" value={hasLinkedPayments ? formatMoney(account.recorded_payment_total) : 'No payment recorded'} />
          </View>
          <View className="rounded-xl border border-tertiary/30 bg-tertiary/10 p-3">
            <Text className="text-sm leading-5 text-foreground">Confirming changes only the manual monthly status. It will not create another payment.</Text>
          </View>
          {statusError ? <View className="rounded-xl bg-destructive/10 p-3"><Text className="text-sm text-destructive">{statusError}</Text></View> : null}
        </ConfirmationDialog>
      ) : null}
      {isReviewingPayment ? (
        <ConfirmationDialog
          title="Review payment"
          description="Confirm the payment details before recording this payment."
          footer={<View className="flex-row gap-2">
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel payment review" disabled={saving} onPress={() => { setIsReviewingPayment(false); setPaymentError(null); }} className={`flex-1 items-center rounded-xl border border-border bg-card px-4 py-3 ${saving ? 'opacity-60' : 'active:bg-accent'}`}><Text className="font-bold text-foreground">Cancel</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Confirm payment" disabled={saving} onPress={() => void recordPayment()} className={`flex-1 items-center rounded-xl bg-primary px-4 py-3 ${saving ? 'opacity-60' : 'active:opacity-85'}`}><Text className="font-bold text-primary-foreground">{saving ? 'Recording payment…' : 'Confirm payment'}</Text></Pressable>
          </View>}>
          <View className="gap-3 rounded-xl border border-border bg-card p-4">
            <StatusConfirmationDetail label="Account" value={account.account_label} />
            <StatusConfirmationDetail label="Dues month" value={coverageMonth} />
            <StatusConfirmationDetail label="Amount" value={formatMoney(amount)} />
            <StatusConfirmationDetail label="Payment method" value={method} />
            <StatusConfirmationDetail label="Payment type" value={paymentType} />
            <StatusConfirmationDetail label="Payer" value={payerLabel.trim()} />
            <StatusConfirmationDetail label="Receipt date" value={receivedOn} />
            {notes.trim() ? <StatusConfirmationDetail label="Notes" value={notes.trim()} /> : null}
          </View>
          {account.manual_status === 'paid' ? <View className="rounded-xl border border-warning/30 bg-warning/10 p-3"><Text className="text-sm leading-5 text-warning">This month is already marked Paid. You may still record another legitimate payment, but this will not change the monthly status automatically.</Text></View> : null}
          <View className="rounded-xl border border-tertiary/30 bg-tertiary/10 p-3"><Text className="text-sm leading-5 text-foreground">The existing payment-recording process will use this receipt date. Confirming creates one payment for this tracking month and does not change the manual monthly status.</Text></View>
          {paymentError ? <View className="rounded-xl bg-destructive/10 p-3"><Text className="text-sm text-destructive">{paymentError}</Text></View> : null}
        </ConfirmationDialog>
      ) : null}
    </View>
  );
}

function ConfirmationDialog({ title, description, children, footer }: { title: string; description: string; children: React.ReactNode; footer: React.ReactNode }) {
  return <View accessibilityViewIsModal className="absolute inset-0 items-center justify-center bg-foreground/45 px-4 py-6">
    <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', android: 'height' })} className="w-full max-w-lg self-center">
      <View className="max-h-[88%] overflow-hidden rounded-2xl border border-border bg-background shadow-lg shadow-foreground/10">
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator contentContainerClassName="gap-4 p-5 pb-4">
          <View>
            <Text className="text-xl font-bold text-foreground">{title}</Text>
            <Text className="mt-1 text-sm leading-5 text-muted-foreground">{description}</Text>
          </View>
          {children}
        </ScrollView>
        <View className="border-t border-border bg-background p-5 pt-4">{footer}</View>
      </View>
    </KeyboardAvoidingView>
  </View>;
}

function StatusConfirmationDetail({ label, value }: { label: string; value: string }) {
  return <View className="flex-row items-start justify-between gap-4"><Text className="flex-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</Text><Text className="flex-1 text-right text-sm font-semibold capitalize text-foreground">{value}</Text></View>;
}

function ExistingPaymentLinker({ account, coveredMemberNames, studentsById, disabled, onSuccess }: {
  account: MonthlyAccount;
  coveredMemberNames: string[];
  studentsById: Map<number, Student>;
  disabled: boolean;
  onSuccess: () => void;
}) {
  const [paymentIdInput, setPaymentIdInput] = React.useState('');
  const [payment, setPayment] = React.useState<ExistingPayment | null>(null);
  const [isLoadingPayment, setIsLoadingPayment] = React.useState(false);
  const [isConfirming, setIsConfirming] = React.useState(false);
  const [isLinking, setIsLinking] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const linkKey = React.useRef<string | null>(null);
  const parsedPaymentId = Number(paymentIdInput.trim());
  const hasValidPaymentId = Number.isSafeInteger(parsedPaymentId) && parsedPaymentId > 0;
  const coverageMonth = trackingMonthLabel(account.month_start);

  const resetSelection = (value: string) => {
    setPaymentIdInput(value);
    setPayment(null);
    setIsConfirming(false);
    setErrorMessage(null);
    setSuccessMessage(null);
    linkKey.current = null;
  };

  const reviewPayment = async () => {
    if (disabled || isLoadingPayment || !hasValidPaymentId) {
      setErrorMessage('Enter a valid existing payment ID.');
      return;
    }
    setIsLoadingPayment(true);
    setPayment(null);
    setIsConfirming(false);
    setErrorMessage(null);
    setSuccessMessage(null);
    linkKey.current = null;
    try {
      const record = await database.getPaymentForTrackingLink<ExistingPayment>(parsedPaymentId);
      if (!record) {
        setErrorMessage('No eligible payment was found in the active academy.');
        return;
      }
      setPayment(record);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Payment details could not be loaded.');
    } finally {
      setIsLoadingPayment(false);
    }
  };

  const linkPayment = async () => {
    if (!payment || disabled || isLinking) return;
    linkKey.current ??= createWaiverIdempotencyKey();
    setIsLinking(true);
    setErrorMessage(null);
    try {
      const result = await database.linkExistingPaymentToTrackingMonth<ExistingPaymentLinkResult>({
        paymentId: payment.id,
        accountId: account.account_id,
        monthStart: account.month_start,
        idempotencyKey: linkKey.current,
      });
      const linked = result[0];
      if (!linked) throw new Error('The payment link did not return a confirmation.');
      setSuccessMessage(`Payment ${linked.payment_id} linked to account-month ${linked.account_month_id}.`);
      onSuccess();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Existing payment could not be linked.');
    } finally {
      setIsLinking(false);
    }
  };

  const student = payment?.student_id === null || payment?.student_id === undefined ? null : studentsById.get(payment.student_id);

  return (
    <View>
      <Text className="text-sm font-bold text-foreground">Link existing payment</Text>
      <Text className="mt-1 text-sm leading-5 text-muted-foreground">Link one already-recorded paid Membership payment. This never creates or modifies a payment.</Text>
      <Field label="Existing payment ID" value={paymentIdInput} onChange={resetSelection} keyboardType="decimal-pad" placeholder="Payment ID" />
      <Pressable accessibilityRole="button" disabled={disabled || isLoadingPayment || !hasValidPaymentId} onPress={() => void reviewPayment()} className={`mt-3 items-center rounded-xl border border-primary bg-card py-3 ${disabled || isLoadingPayment || !hasValidPaymentId ? 'opacity-60' : 'active:bg-accent'}`}>
        <Text className="font-bold text-primary">{isLoadingPayment ? 'Loading payment…' : 'Review payment'}</Text>
      </Pressable>

      {payment ? (
        <View className="mt-4 rounded-2xl border border-tertiary/30 bg-tertiary/10 p-4">
          <Text className="text-xs font-bold uppercase tracking-wide text-tertiary">Review allocation</Text>
          <Text className="mt-2 text-lg font-bold text-foreground">Payment {payment.id} · {formatMoney(payment.amount)}</Text>
          <Text className="mt-1 text-sm text-muted-foreground">{student ? fullName(student) : `Student ID ${payment.student_id ?? 'unavailable'}`}</Text>
          <Text className="mt-1 text-sm text-muted-foreground">{payment.payment_type ?? 'Type unavailable'} · {payment.payment_status ?? 'Status unavailable'}</Text>
          <Text className="mt-1 text-sm text-muted-foreground">Received {formatTimestampDate(payment.created_at)}</Text>
          <View className="my-4 border-t border-tertiary/25" />
          <Text className="text-sm font-bold text-foreground">{account.account_label}</Text>
          <Text className="mt-1 text-sm text-muted-foreground">Covered: {coveredMemberNames.join(', ') || 'No covered members'}</Text>
          <Text className="mt-1 text-sm text-muted-foreground">Dues month: {coverageMonth}</Text>
          {!isConfirming ? (
            <Pressable accessibilityRole="button" disabled={disabled} onPress={() => { setIsConfirming(true); setErrorMessage(null); }} className={`mt-4 items-center rounded-xl bg-primary py-3 ${disabled ? 'opacity-60' : ''}`}>
              <Text className="font-bold text-primary-foreground">Continue to confirmation</Text>
            </Pressable>
          ) : (
            <View className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3">
              <Text className="font-bold text-foreground">Confirm allocation</Text>
              <Text className="mt-1 text-sm leading-5 text-muted-foreground">This will link this existing payment to {coverageMonth}. It will not create or modify a payment.</Text>
              <Pressable accessibilityRole="button" disabled={disabled || isLinking} onPress={() => void linkPayment()} className={`mt-4 items-center rounded-xl bg-primary py-3 ${disabled || isLinking ? 'opacity-60' : ''}`}>
                <Text className="font-bold text-primary-foreground">{isLinking ? 'Linking payment…' : 'Link existing payment'}</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
      {errorMessage ? <View className="mt-4 rounded-xl bg-destructive/10 p-3"><Text className="text-sm text-destructive">{errorMessage}</Text></View> : null}
      {successMessage ? <View className="mt-4 rounded-xl bg-success/15 p-3"><Text className="text-sm font-bold text-success">{successMessage}</Text></View> : null}
    </View>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType, multiline }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; keyboardType?: 'default' | 'decimal-pad'; multiline?: boolean }) { return <View className="mt-4"><Text className="mb-2 text-sm font-bold text-foreground">{label}</Text><ThemedTextInput value={value} onChangeText={onChange} placeholder={placeholder} keyboardType={keyboardType} multiline={multiline} className={`rounded-xl border border-border bg-card px-3 py-3 text-foreground ${multiline ? 'min-h-20' : ''}`} /></View>; }
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (value: T) => void }) { return <View className="mt-4"><Text className="mb-2 text-sm font-bold text-foreground">{label}</Text><View className="flex-row flex-wrap gap-2">{options.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: option === value }} onPress={() => onChange(option)} className={`rounded-full border px-3 py-2 ${option === value ? 'border-primary bg-primary' : 'border-border bg-card active:bg-accent'}`}><Text className={`text-sm font-bold ${option === value ? 'text-primary-foreground' : 'text-foreground'}`}>{option}</Text></Pressable>)}</View></View>; }
function LoadingState() { return <View className="items-center py-24"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading payment tracking…</Text></View>; }
function SetupNeeded() { return <View className="mt-10 items-center rounded-3xl border border-tertiary/30 bg-tertiary/10 px-6 py-10"><LucideIcon name="ReceiptText" className="h-8 w-8 text-tertiary" /><Text className="mt-4 text-lg font-bold text-foreground">Payment tracking setup needed</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">Monthly payment tracking has not been deployed for this database. No overdue totals are shown.</Text></View>; }
function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) { return <View className="mt-10 items-center rounded-3xl bg-destructive/10 px-6 py-10"><LucideIcon name="CircleAlert" className="h-7 w-7 text-destructive" /><Text className="mt-3 text-center font-bold text-foreground">Payment tracking unavailable</Text><Text className="mt-2 text-center text-sm text-muted-foreground">{message}</Text><Pressable accessibilityRole="button" onPress={onRetry} className="mt-5 rounded-xl bg-primary px-4 py-2.5"><Text className="font-bold text-primary-foreground">Retry</Text></Pressable></View>; }
function EmptyState() { return <View className="items-center rounded-2xl border border-border bg-card px-6 py-10"><Text className="font-bold text-foreground">No tracked accounts this month</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">Only explicitly enrolled accounts appear in monthly payment tracking.</Text></View>; }
