import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import LucideIcon from "@/lib/icons/LucideIcon";
import { database } from "@/lib/database";
import { formatTimestampDate, formatTimestampTime } from "@/lib/date";
import { memberProfilePath } from "@/lib/member-navigation";

type PaymentRecord = {
  id: number;
  created_at: string;
  student_id: number;
  amount: number;
  payment_method: string | null;
  payment_status: string | null;
  notes: string | null;
  payment_type: string | null;
  vistor_name: string | null;
};

function paymentDate(value: string) {
  return {
    day: formatTimestampDate(value),
    time: formatTimestampTime(value),
  };
}

export default function PaymentHistoryScreen() {
  const router = useRouter();
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const [records, setRecords] = React.useState<PaymentRecord[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let isMounted = true;

    async function loadPayments() {
      try {
        const response = await database.listPayments<PaymentRecord>();
        const memberRecords = response
          .filter((record) => String(record.student_id) === studentId)
          .sort(
            (first, second) =>
              new Date(second.created_at).getTime() - new Date(first.created_at).getTime(),
          );

        if (isMounted) setRecords(memberRecords);
      } catch {
        if (isMounted) setErrorMessage("Payment history could not be loaded. Try again later.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadPayments();
    return () => {
      isMounted = false;
    };
  }, [studentId]);

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pb-8"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center justify-between pt-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to member profile"
          onPress={() => router.dismissTo(memberProfilePath(studentId))}
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
          >
            <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
          </Pressable>
          <Text className="text-lg font-bold text-foreground">Payment history</Text>
          <View className="h-10 w-10" />
        </View>

        <Text className="mt-7 text-sm text-muted-foreground">
          Live payment records for this member
        </Text>

        {isLoading ? (
          <View className="items-center py-24">
            <LoadingIndicator />
            <Text className="mt-3 text-sm text-muted-foreground">Loading payment history…</Text>
          </View>
        ) : null}
        {errorMessage ? (
          <View className="mt-8 items-center rounded-3xl bg-destructive/10 px-6 py-10">
            <LucideIcon name="CircleAlert" className="mb-3 h-7 w-7 text-destructive" />
            <Text className="text-center font-bold text-foreground">Couldn’t load payments</Text>
            <Text className="mt-2 text-center text-sm leading-5 text-muted-foreground">
              {errorMessage}
            </Text>
          </View>
        ) : null}
        {!isLoading && !errorMessage && !records.length ? (
          <View className="mt-16 items-center">
            <View className="h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
              <LucideIcon name="WalletCards" className="h-6 w-6 text-tertiary" />
            </View>
            <Text className="mt-4 text-lg font-bold text-foreground">No payments yet</Text>
            <Text className="mt-2 max-w-[270px] text-center text-sm leading-5 text-muted-foreground">
              This member doesn’t have any recorded payments.
            </Text>
          </View>
        ) : null}
        {!isLoading && !errorMessage && records.length ? (
          <View className="mt-5 rounded-2xl border border-border bg-card px-4">
            {records.map((record, index) => (
              <PaymentRow key={record.id} record={record} last={index === records.length - 1} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function PaymentRow({ record, last }: { record: PaymentRecord; last: boolean }) {
  const date = paymentDate(record.created_at);
  const notes = record.notes?.trim();

  return (
    <View className={`py-4 ${last ? "" : "border-b border-border"}`}>
      <View className="flex-row items-start">
        <View className="h-10 w-10 items-center justify-center rounded-xl bg-success/15">
          <LucideIcon name="CircleDollarSign" className="h-5 w-5 text-success" />
        </View>
        <View className="ml-3 flex-1">
          <View className="flex-row items-start justify-between gap-3">
            <Text className="font-bold text-foreground">{record.payment_type ?? "Payment"}</Text>
            <Text className="font-bold text-foreground">{String(record.amount)}</Text>
          </View>
          <View className="mt-1 flex-row flex-wrap items-center gap-x-2 gap-y-1">
            {record.payment_method ? (
              <Text className="text-xs text-muted-foreground">{record.payment_method}</Text>
            ) : null}
            {record.payment_status ? (
              <View className="rounded-full bg-success/15 px-2 py-0.5">
                <Text className="text-[11px] font-bold text-success">{record.payment_status}</Text>
              </View>
            ) : null}
          </View>
          <Text className="mt-2 text-xs text-muted-foreground">
            {date.day} · {date.time}
          </Text>
          {notes ? (
            <Text className="mt-2 text-sm leading-5 text-muted-foreground">{notes}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
