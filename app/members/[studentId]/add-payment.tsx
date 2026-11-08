import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { Text } from "@/components/ui/text";
import { ThemedTextInput } from "@/components/ui/themed-text-input";
import {
  database,
  isPaymentTrackingSchemaAbsent,
  resolveActiveGymMembership,
  type PaymentTrackingEligibleAccount,
} from "@/lib/database";
import LucideIcon from "@/lib/icons/LucideIcon";
import { memberProfilePath } from "@/lib/member-navigation";
import { isNewPaymentMethod, newPaymentMethods, type NewPaymentMethod } from "@/lib/payment-methods";
import { createWaiverIdempotencyKey } from "@/lib/waiver-submission";

const paymentStatuses = [
  { label: "Paid", value: "paid" },
  { label: "Pending", value: "pending" },
  { label: "Late", value: "late" },
  { label: "Overdue", value: "overdue" },
] as const;
const paymentTypes = ["Membership", "Class pack", "Private lesson", "Merchandise", "Other"] as const;

type TrackingAccountState = "idle" | "loading" | "ready" | "unavailable" | "admin-required" | "error";
type MemberPaymentResult = { payment_id: number; account_month_id: number };

function isoMonth(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function AddPaymentScreen() {
  const router = useRouter();
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const [amount, setAmount] = React.useState("");
  const [paymentMethod, setPaymentMethod] = React.useState<NewPaymentMethod>("Cash");
  const [paymentStatus, setPaymentStatus] = React.useState<(typeof paymentStatuses)[number]["value"]>("paid");
  const [paymentType, setPaymentType] = React.useState<(typeof paymentTypes)[number]>("Membership");
  const [notes, setNotes] = React.useState("");
  const [duesMonth, setDuesMonth] = React.useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [eligibleAccounts, setEligibleAccounts] = React.useState<PaymentTrackingEligibleAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = React.useState<number | null>(null);
  const [trackingAccountState, setTrackingAccountState] = React.useState<TrackingAccountState>("idle");
  const [isSaving, setIsSaving] = React.useState(false);
  const [isComplete, setIsComplete] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const memberPaymentKey = React.useRef<string | null>(null);

  const numericStudentId = Number(studentId);
  const membershipPayment = paymentType === "Membership";
  const normalizedAmount = Number(amount);
  const amountIsValid = Number.isFinite(normalizedAmount) && normalizedAmount > 0;
  const monthStart = isoMonth(duesMonth);
  const canRecordMembership = trackingAccountState === "ready" && selectedAccountId !== null;
  const resetMembershipRetry = React.useCallback(() => { memberPaymentKey.current = null; }, []);

  React.useEffect(() => {
    let isCurrent = true;
    if (!membershipPayment) {
      setTrackingAccountState("idle");
      setEligibleAccounts([]);
      setSelectedAccountId(null);
      return () => { isCurrent = false; };
    }
    if (!Number.isSafeInteger(numericStudentId) || numericStudentId <= 0) {
      setTrackingAccountState("error");
      return () => { isCurrent = false; };
    }
    const loadEligibleAccounts = async () => {
      setTrackingAccountState("loading");
      try {
        const [capability, membership] = await Promise.all([
          database.getPaymentTrackingCapability(),
          resolveActiveGymMembership(),
        ]);
        if (!isCurrent) return;
        if (capability === "absent") {
          setTrackingAccountState("unavailable");
          return;
        }
        if (membership.role !== "admin") {
          setTrackingAccountState("admin-required");
          return;
        }
        const accounts = await database.getEligiblePaymentTrackingAccounts(numericStudentId, monthStart);
        if (!isCurrent) return;
        setEligibleAccounts(accounts);
        setSelectedAccountId((current) => (
          accounts.some((account) => account.accountId === current)
            ? current
            : accounts.length === 1 ? accounts[0].accountId : null
        ));
        setTrackingAccountState("ready");
      } catch (error) {
        if (!isCurrent) return;
        setTrackingAccountState(isPaymentTrackingSchemaAbsent(error) ? "unavailable" : "error");
      }
    };
    void loadEligibleAccounts();
    return () => { isCurrent = false; };
  }, [membershipPayment, monthStart, numericStudentId]);

  const changeDuesMonth = (offset: number) => {
    resetMembershipRetry();
    setDuesMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const savePayment = async () => {
    if (!studentId || !Number.isSafeInteger(numericStudentId) || numericStudentId <= 0 || !amountIsValid || !isNewPaymentMethod(paymentMethod) || isSaving || isComplete) return;
    if (membershipPayment && (!canRecordMembership || paymentStatus !== "paid")) {
      setErrorMessage("Select an eligible tracking account and use Paid status to record a Membership payment.");
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      if (membershipPayment) {
        memberPaymentKey.current ??= createWaiverIdempotencyKey();
        await database.recordMemberPayment<MemberPaymentResult>({
          studentId: numericStudentId,
          accountId: selectedAccountId as number,
          monthStart,
          amount: normalizedAmount,
          paymentMethod,
          notes: notes.trim(),
          idempotencyKey: memberPaymentKey.current,
        });
      } else {
        await database.createPayment({
          student_id: studentId,
          amount: amount.trim(),
          payment_method: paymentMethod,
          payment_status: paymentStatus,
          notes: notes.trim(),
          payment_type: paymentType,
        });
      }
      setIsComplete(true);
    } catch (error) {
      setErrorMessage(membershipPayment && error instanceof Error ? error.message : "Payment could not be recorded. Try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <ScrollView className="flex-1" contentContainerClassName="px-5 pb-8" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center justify-between pt-4">
          <Pressable accessibilityRole="button" accessibilityLabel="Back to member profile" onPress={() => router.dismissTo(memberProfilePath(studentId))} className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent">
            <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
          </Pressable>
          <Text className="text-lg font-bold text-foreground">Add payment</Text><View className="h-10 w-10" />
        </View>
        {isComplete ? <SuccessState amount={amount} onBack={() => router.dismissTo(memberProfilePath(studentId))} onViewHistory={() => router.replace(`/members/${studentId}/payment-history`)} /> : (
          <View className="pt-7">
            <View className="rounded-3xl bg-primary p-5"><Text className="text-sm font-semibold text-primary-foreground/70">NEW MEMBER PAYMENT</Text><Text className="mt-2 text-2xl font-bold text-primary-foreground">Record a payment</Text><Text className="mt-2 text-sm leading-5 text-primary-foreground/75">This payment will be linked to the member currently open in the profile.</Text></View>
            <AmountField value={amount} onChangeText={(value) => { resetMembershipRetry(); setAmount(value); }} />
            <ChoiceField label="Payment method" value={paymentMethod} options={newPaymentMethods} onChange={(value) => { resetMembershipRetry(); setPaymentMethod(value); }} />
            <ChoiceField label="Payment type" value={paymentType} options={paymentTypes} onChange={(value) => { resetMembershipRetry(); setPaymentType(value); if (value === "Membership") setPaymentStatus("paid"); }} />
            {membershipPayment ? <>
              <PaidMembershipStatus />
              <DuesMonthSelector month={duesMonth} onPrevious={() => changeDuesMonth(-1)} onNext={() => changeDuesMonth(1)} />
              <EligibleAccountSelector state={trackingAccountState} accounts={eligibleAccounts} selectedAccountId={selectedAccountId} selectedMonthLabel={monthLabel(duesMonth)} onSelect={(accountId) => { resetMembershipRetry(); setSelectedAccountId(accountId); }} />
            </> : <ChoiceField label="Payment status" value={paymentStatus} options={paymentStatuses.map((status) => status.value)} labels={Object.fromEntries(paymentStatuses.map((status) => [status.value, status.label]))} onChange={setPaymentStatus} />}
            <NotesField value={notes} onChangeText={(value) => { resetMembershipRetry(); setNotes(value); }} />
            {errorMessage ? <View className="mt-5 flex-row gap-2 rounded-2xl bg-destructive/15 px-4 py-3"><LucideIcon name="CircleAlert" className="mt-0.5 h-5 w-5 text-destructive" /><Text className="flex-1 text-sm leading-5 text-foreground">{errorMessage}</Text></View> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Record payment" disabled={!amountIsValid || isSaving || (membershipPayment && !canRecordMembership)} onPress={savePayment} className={`mt-7 flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4 ${!amountIsValid || isSaving || (membershipPayment && !canRecordMembership) ? "opacity-60" : ""}`}>
              {isSaving ? <LoadingIndicator tone="on-primary" /> : <LucideIcon name="CircleDollarSign" className="h-5 w-5 text-primary-foreground" />}<Text className="font-bold text-primary-foreground">{isSaving ? "Recording payment…" : "Record payment"}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function AmountField({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) {
  return <View className="mt-6"><Text className="mb-2 font-bold text-foreground">Amount</Text><View className="flex-row items-center rounded-2xl border border-border bg-card px-4 py-3"><Text className="mr-2 text-base text-muted-foreground">$</Text><ThemedTextInput value={value} onChangeText={onChangeText} placeholder="0.00" keyboardType="decimal-pad" className="flex-1 text-base text-foreground" /></View></View>;
}

function ChoiceField<T extends string>({ label, value, options, labels, onChange }: { label: string; value: T; options: readonly T[]; labels?: Partial<Record<T, string>>; onChange: (value: T) => void }) {
  return <View className="mt-6"><Text className="mb-2 font-bold text-foreground">{label}</Text><View className="flex-row flex-wrap gap-2">{options.map((option) => { const selected = option === value; return <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => onChange(option)} className={`rounded-full border px-3 py-2 ${selected ? "border-primary bg-primary" : "border-border bg-card active:bg-accent"}`}><Text className={`text-sm font-semibold ${selected ? "text-primary-foreground" : "text-foreground"}`}>{labels?.[option] ?? option}</Text></Pressable>; })}</View></View>;
}

function PaidMembershipStatus() {
  return <View className="mt-6 rounded-2xl border border-success/40 bg-success/10 px-4 py-3"><Text className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Payment status</Text><Text className="mt-1 font-bold text-foreground">Paid</Text><Text className="mt-1 text-sm leading-5 text-muted-foreground">Membership payments are recorded with their selected dues month.</Text></View>;
}

function DuesMonthSelector({ month, onPrevious, onNext }: { month: Date; onPrevious: () => void; onNext: () => void }) {
  return <View className="mt-6"><Text className="mb-2 font-bold text-foreground">Dues month</Text><View className="flex-row items-center justify-between rounded-2xl border border-border bg-card p-2"><Pressable accessibilityRole="button" accessibilityLabel="Previous dues month" onPress={onPrevious} className="h-10 w-10 items-center justify-center rounded-xl active:bg-accent"><LucideIcon name="ChevronLeft" className="h-5 w-5 text-foreground" /></Pressable><View accessible accessibilityLabel={`Dues month ${monthLabel(month)}`}><Text className="font-bold text-foreground">{monthLabel(month)}</Text><Text className="mt-0.5 text-center text-xs text-muted-foreground">Required for Membership</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Next dues month" onPress={onNext} className="h-10 w-10 items-center justify-center rounded-xl active:bg-accent"><LucideIcon name="ChevronRight" className="h-5 w-5 text-foreground" /></Pressable></View></View>;
}

function EligibleAccountSelector({ state, accounts, selectedAccountId, selectedMonthLabel, onSelect }: { state: TrackingAccountState; accounts: PaymentTrackingEligibleAccount[]; selectedAccountId: number | null; selectedMonthLabel: string; onSelect: (accountId: number) => void }) {
  return <View className="mt-6"><Text className="mb-2 font-bold text-foreground">Eligible tracking account</Text>{state === "loading" ? <View className="rounded-2xl border border-border bg-card px-4 py-4"><LoadingIndicator /><Text className="mt-2 text-sm text-muted-foreground">Checking account coverage for {selectedMonthLabel}…</Text></View> : null}{state === "ready" && accounts.length === 0 ? <TrackingNotice message={`No active individual or family account covers this member for ${selectedMonthLabel}. Set up or correct coverage before recording this Membership payment.`} /> : null}{state === "ready" && accounts.map((account) => { const selected = account.accountId === selectedAccountId; return <Pressable key={account.accountId} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`Use ${account.accountLabel} ${account.accountKind} account`} onPress={() => onSelect(account.accountId)} className={`mb-2 flex-row items-center rounded-2xl border px-4 py-3 ${selected ? "border-primary bg-primary/10" : "border-border bg-card active:bg-accent"}`}><View className={`mr-3 h-5 w-5 items-center justify-center rounded-full border ${selected ? "border-primary" : "border-muted-foreground"}`}>{selected ? <View className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}</View><View className="flex-1"><Text className="font-bold text-foreground">{account.accountLabel}</Text><Text className="mt-0.5 text-sm capitalize text-muted-foreground">{account.accountKind} account</Text></View></Pressable>; })}{state === "unavailable" ? <TrackingNotice message="Payment tracking is not available for this academy. A Membership payment cannot be recorded until tracking is available." /> : null}{state === "admin-required" ? <TrackingNotice message="Only an active administrator can record a Membership payment with a dues-month allocation." /> : null}{state === "error" ? <TrackingNotice message="Eligible payment-tracking accounts could not be loaded. Try again after reopening this screen." /> : null}</View>;
}

function TrackingNotice({ message }: { message: string }) { return <View className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3"><Text className="text-sm leading-5 text-foreground">{message}</Text></View>; }

function NotesField({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) { return <View className="mt-6"><Text className="mb-2 font-bold text-foreground">Notes <Text className="font-normal text-muted-foreground">(optional)</Text></Text><View className="min-h-[104px] rounded-2xl border border-border bg-card px-4 py-3"><ThemedTextInput value={value} onChangeText={onChangeText} placeholder="Add a note" multiline textAlignVertical="top" className="flex-1 text-base text-foreground" /></View></View>; }

function SuccessState({ amount, onBack, onViewHistory }: { amount: string; onBack: () => void; onViewHistory: () => void }) { return <View className="items-center pt-24"><View className="h-16 w-16 items-center justify-center rounded-3xl bg-success"><LucideIcon name="Check" className="h-8 w-8 text-success-foreground" strokeWidth={3} /></View><Text className="mt-5 text-2xl font-bold text-foreground">Payment recorded</Text><Text className="mt-3 max-w-[290px] text-center text-sm leading-5 text-muted-foreground">${amount} has been added to this member’s payment record.</Text><Pressable accessibilityRole="button" accessibilityLabel="View payment history" onPress={onViewHistory} className="mt-7 rounded-2xl bg-primary px-5 py-3"><Text className="font-bold text-primary-foreground">View payment history</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Back to member profile" onPress={onBack} className="mt-3 px-5 py-3"><Text className="font-bold text-foreground">Back to member</Text></Pressable></View>; }
