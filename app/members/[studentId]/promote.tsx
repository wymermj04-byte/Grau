import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import LucideIcon from "@/lib/icons/LucideIcon";
import { database } from "@/lib/database";
import { mayUseLegacyPromotionWorkflow } from "@/lib/promotion-fallback";
import { fullName, loadStudents, type Student } from "@/lib/students";
import { memberProfilePath } from "@/lib/member-navigation";

const belts = ["White", "Blue", "Purple", "Brown", "Black"];
const stripeOptions = [0, 1, 2, 3, 4];

export default function PromoteStudentScreen() {
  const router = useRouter();
  const { studentId } = useLocalSearchParams<{ studentId?: string }>();
  const [student, setStudent] = React.useState<Student | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [promotionType, setPromotionType] = React.useState<"stripe" | "belt">("stripe");
  const [newBelt, setNewBelt] = React.useState("");
  const [newStripes, setNewStripes] = React.useState(0);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isComplete, setIsComplete] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    let isMounted = true;
    async function loadStudent() {
      try {
        const result = await loadStudents();
        const foundStudent = result.find((item) => String(item.studentId) === studentId);
        if (isMounted) {
          setStudent(foundStudent ?? null);
          setNewBelt(foundStudent?.belt_rank.trim() ?? "");
          setNewStripes(Math.min((foundStudent?.stripes ?? 0) + 1, 4));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadStudent();
    return () => {
      isMounted = false;
    };
  }, [studentId]);

  React.useEffect(() => {
    if (!isComplete || !studentId) return;
    const timeout = setTimeout(() => router.dismissTo(memberProfilePath(studentId)), 1400);
    return () => clearTimeout(timeout);
  }, [isComplete, router, studentId]);

  const submitPromotion = async () => {
    if (!student || !studentId || isSaving || isComplete) return;
    const selectedBelt = promotionType === "stripe" ? student.belt_rank.trim() : newBelt;
    if (
      !selectedBelt ||
      (promotionType === "stripe" && newStripes <= student.stripes) ||
      (promotionType === "belt" && selectedBelt === student.belt_rank.trim())
    )
      return;
    setIsSaving(true);
    setErrorMessage(null);
    let legacyPromotionCreated = false;
    try {
      const schemaCapability = await database.getStripeProgressSchemaCapability();
      if (!mayUseLegacyPromotionWorkflow(schemaCapability)) {
        await database.recordStudentPromotion(
          student.studentId,
          selectedBelt,
          newStripes,
          promotionType,
        );
      } else {
        // The dedicated stripe baseline table is absent, so this is the pre-migration
        // connection and only the established legacy workflow is available.
        await database.createPromotion({
          student_id: String(student.studentId),
          old_belt: student.belt_rank.trim(),
          new_belt: selectedBelt,
          old_stripes: String(student.stripes),
          new_stripes: String(newStripes),
          promotion_type: promotionType,
        });
        legacyPromotionCreated = true;
        await database.updateStudent(student.studentId, {
          belt_rank: selectedBelt,
          stripes: String(newStripes),
        });
      }
      setIsComplete(true);
    } catch {
      setErrorMessage(
        legacyPromotionCreated
          ? "Promotion history was saved, but the member update failed. Retry is disabled to prevent a duplicate record."
          : "Promotion could not be saved. No member update was sent.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const currentBelt = student?.belt_rank.trim() ?? "";
  const beltOptions = Array.from(new Set([currentBelt, ...belts].filter(Boolean)));
  const selectedBelt = promotionType === "stripe" ? currentBelt : newBelt;
  const availableStripeOptions =
    promotionType === "stripe"
      ? stripeOptions.filter((count) => count > (student?.stripes ?? 0))
      : stripeOptions;
  const promotionIsValid = student
    ? promotionType === "stripe"
      ? newStripes > student.stripes
      : Boolean(selectedBelt) && selectedBelt !== currentBelt
    : false;

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
          <Text className="text-lg font-bold text-foreground">Promote student</Text>
          <View className="h-10 w-10" />
        </View>
        {isLoading ? (
          <View className="items-center py-24">
            <LoadingIndicator />
            <Text className="mt-3 text-sm text-muted-foreground">Loading member…</Text>
          </View>
        ) : null}
        {!isLoading && !student ? (
          <View className="items-center py-24">
            <LucideIcon name="UserRoundX" className="mb-3 h-7 w-7 text-muted-foreground" />
            <Text className="text-lg font-bold text-foreground">Member not found</Text>
          </View>
        ) : null}
        {!isLoading && student && isComplete ? (
          <SuccessState name={fullName(student)} belt={selectedBelt} stripes={newStripes} />
        ) : null}
        {!isLoading && student && !isComplete ? (
          <View className="pt-7">
            <View className="rounded-3xl bg-primary p-5">
              <Text className="text-sm font-semibold text-primary-foreground/70">
                PROMOTION FOR
              </Text>
              <Text className="mt-2 text-2xl font-bold text-primary-foreground">
                {fullName(student)}
              </Text>
              <Text className="mt-2 text-sm text-primary-foreground/75">
                Current: {currentBelt} · {student.stripes}{" "}
                {student.stripes === 1 ? "stripe" : "stripes"}
              </Text>
            </View>
            <Text className="mb-3 mt-7 text-xl font-bold text-foreground">Promotion type</Text>
            <View className="flex-row gap-3">
              <TypeOption
                active={promotionType === "stripe"}
                icon="Award"
                label="Stripe promotion"
                onPress={() => {
                  setPromotionType("stripe");
                  setNewBelt(currentBelt);
                  setNewStripes(Math.min(student.stripes + 1, 4));
                }}
              />
              <TypeOption
                active={promotionType === "belt"}
                icon="Medal"
                label="Belt promotion"
                onPress={() => setPromotionType("belt")}
              />
            </View>
            {promotionType === "belt" ? (
              <>
                <Text className="mb-3 mt-7 text-xl font-bold text-foreground">New belt</Text>
                <View className="flex-row flex-wrap gap-2">
                  {beltOptions.map((belt) => (
                    <Pressable
                      key={belt}
                      onPress={() => setNewBelt(belt)}
                      className={`rounded-full px-4 py-2.5 ${newBelt === belt ? "bg-primary" : "bg-secondary"}`}
                    >
                      <Text
                        className={`text-sm font-bold ${newBelt === belt ? "text-primary-foreground" : "text-secondary-foreground"}`}
                      >
                        {belt}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
            <Text className="mb-3 mt-7 text-xl font-bold text-foreground">New stripe count</Text>
            <View className="flex-row gap-2">
              {availableStripeOptions.map((count) => (
                <Pressable
                  key={count}
                  onPress={() => setNewStripes(count)}
                  className={`h-11 w-11 items-center justify-center rounded-xl ${newStripes === count ? "bg-primary" : "bg-secondary"}`}
                >
                  <Text
                    className={`font-bold ${newStripes === count ? "text-primary-foreground" : "text-secondary-foreground"}`}
                  >
                    {count}
                  </Text>
                </Pressable>
              ))}
            </View>
            {promotionType === "stripe" && !availableStripeOptions.length ? (
              <Text className="mt-3 text-sm text-warning">
                This member has four stripes. Choose a belt promotion.
              </Text>
            ) : null}
            <View className="mt-7 rounded-2xl border border-border bg-card p-4">
              <Text className="text-xs font-semibold text-muted-foreground">PROMOTION SUMMARY</Text>
              <Text className="mt-2 font-bold text-foreground">
                {currentBelt} · {student.stripes} {student.stripes === 1 ? "stripe" : "stripes"}{" "}
                <Text className="text-muted-foreground">→</Text> {selectedBelt} · {newStripes}{" "}
                {newStripes === 1 ? "stripe" : "stripes"}
              </Text>
            </View>
            {errorMessage ? (
              <View className="mt-5 flex-row gap-2 rounded-2xl bg-destructive/15 px-4 py-3">
                <LucideIcon name="CircleAlert" className="mt-0.5 h-5 w-5 text-destructive" />
                <Text className="flex-1 text-sm leading-5 text-foreground">{errorMessage}</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save promotion"
              disabled={isSaving || Boolean(errorMessage) || !promotionIsValid}
              onPress={submitPromotion}
              className={`mt-5 flex-row items-center justify-center gap-2 rounded-2xl bg-primary py-4 ${isSaving || errorMessage || !promotionIsValid ? "opacity-60" : ""}`}
            >
              {isSaving ? (
                <LoadingIndicator tone="on-primary" />
              ) : (
                <LucideIcon name="Award" className="h-5 w-5 text-primary-foreground" />
              )}
              <Text className="font-bold text-primary-foreground">
                {isSaving ? "Saving promotion…" : "Save promotion"}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function TypeOption({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: "Award" | "Medal";
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={`flex-1 rounded-2xl border p-4 ${active ? "border-primary bg-primary" : "border-border bg-card"}`}
    >
      <LucideIcon
        name={icon}
        className={`h-5 w-5 ${active ? "text-primary-foreground" : "text-tertiary"}`}
      />
      <Text className={`mt-4 font-bold ${active ? "text-primary-foreground" : "text-foreground"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function SuccessState({ name, belt, stripes }: { name: string; belt: string; stripes: number }) {
  return (
    <View className="items-center pt-24">
      <View className="h-16 w-16 items-center justify-center rounded-3xl bg-success">
        <LucideIcon name="Check" className="h-8 w-8 text-success-foreground" strokeWidth={3} />
      </View>
      <Text className="mt-5 text-2xl font-bold text-foreground">Promotion saved</Text>
      <Text className="mt-3 max-w-[290px] text-center text-sm leading-5 text-muted-foreground">
        {name} is now {belt} with {stripes} {stripes === 1 ? "stripe" : "stripes"}.
      </Text>
      <Text className="mt-6 text-xs text-muted-foreground">Refreshing member profile…</Text>
    </View>
  );
}
