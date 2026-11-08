import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { LoadingIndicator } from '@/components/ui/loading-indicator';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { AppHeader } from '@/components/gym/AppHeader';
import { PageContent } from '@/components/layout/PageContent';
import LucideIcon from '@/lib/icons/LucideIcon';
import { DatabaseQueryError, GymMembershipError, database, resolveActiveGymMembership } from '@/lib/database';
import { fullName, type Student } from '@/lib/students';

type BillingProfile = {
  id: number;
  student_id: number;
};

type BillingCharge = {
  id: number;
  student_id: number;
  billing_profile_id: number;
  charge_type: 'membership_month' | 'opening_balance';
  billing_month: string | null;
  due_date: string;
  amount_due: number | string;
};

type PaymentAllocation = {
  billing_charge_id: number;
  amount: number | string;
};

type GuardianContact = {
  student_id: number;
  full_name: string;
  email: string | null;
  phone: string | null;
  is_billing_contact: boolean;
};

type BillingSettings = {
  time_zone: string;
};

type ScreenState = 'loading' | 'ready' | 'empty' | 'unavailable' | 'forbidden' | 'error';

const cents = (value: number | string | null | undefined) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
};

function formatCents(value: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value / 100);
}

function monthLabel(charge: BillingCharge, timeZone: string) {
  if (charge.charge_type === 'opening_balance') return 'Opening balance';
  if (!charge.billing_month) return 'Billing month unavailable';
  const date = new Date(`${charge.billing_month}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? 'Billing month unavailable'
    : new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone }).format(date);
}

function localDateKey(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

function statusFor(charge: BillingCharge, remainingCents: number, timeZone: string) {
  if (remainingCents <= 0) return 'Paid' as const;
  const dueDate = charge.due_date?.slice(0, 10);
  return dueDate && localDateKey(timeZone) < dueDate ? 'Upcoming' as const : 'Due' as const;
}

function isBillingUnavailable(error: unknown) {
  return error instanceof DatabaseQueryError && (
    error.code === '42P01'
    || /does not exist|schema cache/i.test(error.message)
  );
}

export default function BillingScreen() {
  const router = useRouter();
  const [state, setState] = React.useState<ScreenState>('loading');
  const [rows, setRows] = React.useState<Array<{ charge: BillingCharge; member?: Student; allocatedCents: number; contact?: GuardianContact }>>([]);
  const [timeZone, setTimeZone] = React.useState('UTC');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;

      async function loadBilling() {
        setState('loading');
        setErrorMessage(null);
        try {
          const membership = await resolveActiveGymMembership();
          if (!active) return;
          if (membership.role !== 'admin') {
            setState('forbidden');
            return;
          }
          const [profiles, charges, allocations, contacts, settings, students] = await Promise.all([
            database.listBillingProfiles<BillingProfile>(),
            database.listBillingCharges<BillingCharge>(),
            database.listPaymentAllocations<PaymentAllocation>(),
            database.listStudentGuardianContacts<GuardianContact>(),
            database.listGymBillingSettings<BillingSettings>(),
            database.listStudents<Student>(),
          ]);
          if (!active) return;

          const configuredTimeZone = settings[0]?.time_zone;
          if (!configuredTimeZone) {
            setState('unavailable');
            return;
          }

          const profileStudentIds = new Set(profiles.map((profile) => profile.student_id));
          const membersById = new Map(students.map((student) => [student.studentId, student]));
          const allocationsByCharge = new Map<number, number>();
          allocations.forEach((allocation) => {
            allocationsByCharge.set(
              allocation.billing_charge_id,
              (allocationsByCharge.get(allocation.billing_charge_id) ?? 0) + cents(allocation.amount),
            );
          });
          const contactsByStudent = new Map<number, GuardianContact>();
          contacts.forEach((contact) => {
            const existing = contactsByStudent.get(contact.student_id);
            if (!existing || contact.is_billing_contact) contactsByStudent.set(contact.student_id, contact);
          });

          setTimeZone(configuredTimeZone);
          const loadedRows = charges
            .filter((charge) => profileStudentIds.has(charge.student_id))
            .sort((first, second) => second.due_date.localeCompare(first.due_date))
            .map((charge) => ({
              charge,
              member: membersById.get(charge.student_id),
              allocatedCents: allocationsByCharge.get(charge.id) ?? 0,
              contact: contactsByStudent.get(charge.student_id),
            }));
          setRows(loadedRows);
          setState(loadedRows.length ? 'ready' : 'empty');
        } catch (error) {
          if (!active) return;
          setRows([]);
          if (error instanceof GymMembershipError && error.reason === 'admin-required') {
            setState('forbidden');
            return;
          }
          if (isBillingUnavailable(error)) {
            setState('unavailable');
            return;
          }
          setErrorMessage('Billing data could not be loaded. Try again.');
          setState('error');
        }
      }

      void loadBilling();
      return () => {
        active = false;
      };
    }, [refreshKey]),
  );

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="pb-8" showsVerticalScrollIndicator={false}>
        <PageContent className="px-5">
        <View className="flex-row items-center justify-between pt-4">
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Finance" onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/finance'); }} className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"><LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" /></Pressable>
          <Text className="text-lg font-bold text-foreground">Billing</Text>
          <View className="h-10 w-10" />
        </View>
        <View className="mt-6"><AppHeader title="Billing" dataLabel={state === 'ready' ? 'Admin billing ledger' : 'Billing administration'} /><Text className="text-3xl font-bold tracking-tight text-foreground">Member billing</Text><Text className="mt-2 text-sm leading-5 text-muted-foreground">Review balances and billing contacts. Reminders remain manual.</Text></View>

        {state === 'loading' ? <LoadingState /> : null}
        {state === 'unavailable' ? <MessageState icon="CircleAlert" title="Billing is not enabled for this gym yet." detail="The billing tables are unavailable in this connected database." /> : null}
        {state === 'forbidden' ? <MessageState icon="LockKeyhole" title="Billing access required" detail="Only gym administrators can view billing information." /> : null}
        {state === 'error' ? <MessageState icon="CircleAlert" title="Billing unavailable" detail={errorMessage ?? 'Billing data could not be loaded.'} actionLabel="Retry" onAction={() => setRefreshKey((key) => key + 1)} /> : null}
        {state === 'empty' ? <MessageState icon="ReceiptText" title="No billing charges" detail="There are no billing charges for this gym yet." /> : null}

        {state === 'ready' ? <View className="mt-7 gap-3">{rows.map(({ charge, member, allocatedCents, contact }) => {
          const chargedCents = cents(charge.amount_due);
          const remainingCents = Math.max(0, chargedCents - allocatedCents);
          const status = statusFor(charge, remainingCents, timeZone);
          const statusClass = status === 'Paid' ? 'bg-success/15 text-success' : status === 'Upcoming' ? 'bg-tertiary/15 text-tertiary' : 'bg-warning/15 text-warning';
          return <View key={charge.id} className="rounded-2xl border border-border bg-card p-4"><View className="flex-row items-start justify-between gap-3"><View className="flex-1"><Text className="font-bold text-foreground">{member ? fullName(member) : `Member ${charge.student_id}`}</Text><Text className="mt-1 text-sm text-muted-foreground">{monthLabel(charge, timeZone)}</Text></View><View className={`rounded-full px-2.5 py-1 ${statusClass.split(' ')[0]}`}><Text className={`text-xs font-bold ${statusClass.split(' ')[1]}`}>{status}</Text></View></View><View className="mt-5 flex-row flex-wrap gap-3"><Metric label="Charged" value={formatCents(chargedCents)} /><Metric label="Allocated" value={formatCents(allocatedCents)} /><Metric label="Remaining" value={formatCents(remainingCents)} /></View>{contact ? <View className="mt-4 border-t border-border pt-3"><Text className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Billing contact</Text><Text className="mt-1 text-sm font-semibold text-foreground">{contact.full_name}</Text><Text className="mt-0.5 text-xs text-muted-foreground">{[contact.email, contact.phone].filter(Boolean).join(' · ') || 'Contact details unavailable'}</Text></View> : null}</View>;
        })}</View> : null}
        </PageContent>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View className="min-w-[120px] flex-1 rounded-xl border border-border bg-secondary p-3"><Text className="text-xs text-muted-foreground">{label}</Text><Text className="mt-1 text-sm font-bold text-secondary-foreground">{value}</Text></View>;
}

function LoadingState() {
  return <View className="items-center py-24"><LoadingIndicator /><Text className="mt-3 text-sm text-muted-foreground">Loading billing data…</Text></View>;
}

function MessageState({ icon, title, detail, actionLabel, onAction }: { icon: 'CircleAlert' | 'LockKeyhole' | 'ReceiptText'; title: string; detail: string; actionLabel?: string; onAction?: () => void }) {
  return <View className="mt-8 items-center rounded-3xl border border-border bg-card px-6 py-10"><LucideIcon name={icon} className="mb-3 h-7 w-7 text-tertiary" /><Text className="text-center text-lg font-bold text-foreground">{title}</Text><Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">{detail}</Text>{actionLabel && onAction ? <Pressable accessibilityRole="button" accessibilityLabel={actionLabel} onPress={onAction} className="mt-5 rounded-xl bg-primary px-4 py-2.5"><Text className="font-bold text-primary-foreground">{actionLabel}</Text></Pressable> : null}</View>;
}
