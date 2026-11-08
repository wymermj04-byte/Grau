import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { ThemedTextInput } from "@/components/ui/themed-text-input";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import LucideIcon from "@/lib/icons/LucideIcon";
import { database } from "@/lib/database";
import { parseCalendarDateInput } from "@/lib/date";
import type { ClassContractException } from "@/lib/stripe-progress";
import { memberProfilePath } from "@/lib/member-navigation";

type BoundaryMode = "historical-date" | "baseline";

export default function StripeProgressSetupScreen() {
  const router = useRouter();
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const [mode, setMode] = React.useState<BoundaryMode>("historical-date");
  const [promotionDate, setPromotionDate] = React.useState("");
  const [cutoffDate, setCutoffDate] = React.useState("");
  const [startingCount, setStartingCount] = React.useState("0");
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [isEnabled, setIsEnabled] = React.useState<boolean | null>(null);
  const [contractIssue, setContractIssue] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    database
      .getGymStripeProgressContext<StripeProgressContext>()
      .then((context) => {
        if (!active) return;
        if (context.class_contract_exceptions.length > 0) {
          setContractIssue(
            `${context.class_contract_exceptions.length} scheduled class record${context.class_contract_exceptions.length === 1 ? "" : "s"} needs contract review before a boundary can be confirmed.`,
          );
          setIsEnabled(false);
          return;
        }
        setIsEnabled(true);
      })
      .catch(() => {
        if (active) setIsEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    const id = Number(studentId);
    const count = Number(startingCount);
    const normalizedDate = parseCalendarDateInput(
      mode === "historical-date" ? promotionDate : cutoffDate,
    );
    const baselineIsValid = Number.isInteger(count) && count >= 0;
    if (
      isEnabled !== true ||
      !Number.isSafeInteger(id) ||
      !normalizedDate ||
      note.trim().length < 3 ||
      (mode === "baseline" && !baselineIsValid)
    ) {
      setMessage(
        mode === "historical-date"
          ? "Enter the last promotion date and a confirmation note."
          : "Enter a cutoff date, a whole-number starting count, and a confirmation note.",
      );
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      if (mode === "historical-date") {
        await database.confirmHistoricalPromotionDate(id, normalizedDate, note.trim());
      } else {
        await database.confirmStripeProgressBaseline(id, normalizedDate, count, note.trim());
      }
      router.dismissTo(memberProfilePath(id));
    } catch {
      setMessage(
        "Stripe progress is not enabled yet, or this counting boundary could not be confirmed.",
      );
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => router.dismissTo(memberProfilePath(studentId));
  if (isEnabled === null)
    return (
      <SafeAreaView edges={["top"]} className="flex-1 items-center justify-center bg-background">
        <LoadingIndicator />
        <Text className="mt-3 text-sm text-muted-foreground">Checking stripe progress…</Text>
      </SafeAreaView>
    );
  if (!isEnabled)
    return (
      <SafeAreaView edges={["top"]} className="flex-1 bg-background">
        <View className="px-5 pt-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to member"
            onPress={goBack}
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          >
            <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
          </Pressable>
          <View className="mt-8 rounded-2xl border border-tertiary/30 bg-tertiary/10 p-5">
            <Text className="font-bold text-foreground">Stripe progress is not enabled yet.</Text>
            <Text className="mt-2 text-sm leading-5 text-muted-foreground">
              {contractIssue ??
                "This gym needs the historical-date amendment before a counting boundary can be confirmed."}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <ScrollView contentContainerClassName="px-5 pb-8" keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center justify-between pt-4">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to member"
            onPress={goBack}
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
          >
            <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
          </Pressable>
          <Text className="text-lg font-bold text-foreground">Set counting boundary</Text>
          <View className="h-10 w-10" />
        </View>
        <View className="mt-7 rounded-3xl bg-primary p-5">
          <Text className="text-2xl font-bold text-primary-foreground">
            Start from a trusted record
          </Text>
          <Text className="mt-2 text-sm leading-5 text-primary-foreground/75">
            Your saved promotion track, belt, stripes, and gym are captured with this staff
            confirmation. It never creates a promotion or changes rank.
          </Text>
        </View>
        <View className="mt-7 rounded-2xl border border-border bg-card p-2">
          <SetupChoice
            active={mode === "historical-date"}
            title="Last promotion date"
            detail="Primary option — count qualifying scheduled classes from the next gym-local day."
            onPress={() => {
              setMode("historical-date");
              setMessage(null);
            }}
          />
          <SetupChoice
            active={mode === "baseline"}
            title="Confirmed starting count"
            detail="Optional — use only when a reliable starting total is known and no promotion boundary applies."
            onPress={() => {
              setMode("baseline");
              setMessage(null);
            }}
          />
        </View>
        {mode === "historical-date" ? (
          <View>
            <Text className="mb-2 mt-7 font-bold text-foreground">
              Last stripe or belt promotion date
            </Text>
            <ThemedTextInput
              value={promotionDate}
              onChangeText={setPromotionDate}
              placeholder="MM-DD-YY"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              autoCorrect={false}
              className="rounded-2xl border border-border bg-card px-4 py-3 text-base text-foreground"
            />
            <Text className="mt-2 text-sm leading-5 text-muted-foreground">
              Use MM-DD-YY (YY means 2000–2099). Classes scheduled on this date are excluded.
              Counting starts the following calendar day in this gym’s saved timezone. Missing
              attendance history is not included.
            </Text>
          </View>
        ) : (
          <View>
            <Text className="mb-2 mt-7 font-bold text-foreground">Cutoff date</Text>
            <ThemedTextInput
              value={cutoffDate}
              onChangeText={setCutoffDate}
              placeholder="MM-DD-YY"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
              autoCorrect={false}
              className="rounded-2xl border border-border bg-card px-4 py-3 text-base text-foreground"
            />
            <Text className="mt-2 text-sm leading-5 text-muted-foreground">
              Use MM-DD-YY (YY means 2000–2099).
            </Text>
            <Text className="mb-2 mt-5 font-bold text-foreground">Classes already completed</Text>
            <ThemedTextInput
              value={startingCount}
              onChangeText={setStartingCount}
              keyboardType="numeric"
              placeholder="0"
              className="rounded-2xl border border-border bg-card px-4 py-3 text-base text-foreground"
            />
          </View>
        )}
        <Text className="mb-2 mt-5 font-bold text-foreground">Confirmation note</Text>
        <ThemedTextInput
          value={note}
          onChangeText={setNote}
          placeholder="What records were confirmed?"
          multiline
          textAlignVertical="top"
          className="min-h-28 rounded-2xl border border-border bg-card px-4 py-3 text-base text-foreground"
        />
        {message ? <Text className="mt-4 text-sm text-destructive">{message}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={save}
          className={`mt-6 items-center rounded-2xl bg-primary py-4 ${saving ? "opacity-60" : ""}`}
        >
          {saving ? (
            <LoadingIndicator tone="on-primary" />
          ) : (
            <Text className="font-bold text-primary-foreground">
              {mode === "historical-date"
                ? "Confirm last promotion date"
                : "Confirm starting count"}
            </Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SetupChoice({
  active,
  title,
  detail,
  onPress,
}: {
  active: boolean;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={`rounded-xl px-4 py-3 ${active ? "bg-secondary" : "bg-transparent"}`}
    >
      <Text className="font-bold text-foreground">{title}</Text>
      <Text className="mt-1 text-xs leading-4 text-muted-foreground">{detail}</Text>
    </Pressable>
  );
}

type StripeProgressContext = {
  class_contract_exceptions: ClassContractException[];
};
