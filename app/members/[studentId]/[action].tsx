import { Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import LucideIcon from "@/lib/icons/LucideIcon";
import { memberProfilePath } from "@/lib/member-navigation";

const actionCopy = {
  "check-in": {
    title: "Check in",
    description: "Check-in will be connected to this member when attendance actions are available.",
    icon: "ScanLine",
  },
  promote: {
    title: "Promote student",
    description:
      "Promotion updates will be connected to this member when promotion actions are available.",
    icon: "Award",
  },
  "attendance-history": {
    title: "Attendance history",
    description: "Attendance history will appear here when a history source is connected.",
    icon: "History",
  },
  "add-payment": {
    title: "Add payment",
    description:
      "Payment entry will be connected to this member when payment actions are available.",
    icon: "CircleDollarSign",
  },
  "payment-history": {
    title: "Payment history",
    description: "Payment history will appear here when a history source is connected.",
    icon: "WalletCards",
  },
  edit: {
    title: "Edit member",
    description:
      "Member editing will be connected to this profile when update actions are available.",
    icon: "Pencil",
  },
} as const;

type ActionKey = keyof typeof actionCopy;

export default function MemberActionPlaceholder() {
  const router = useRouter();
  const { studentId, action } = useLocalSearchParams<{ studentId?: string; action?: string }>();
  const details = action && action in actionCopy ? actionCopy[action as ActionKey] : null;
  const icon = details?.icon ?? "CircleAlert";

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <View className="flex-1 px-5 pt-4">
        <View className="flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to member profile"
            onPress={() => router.dismissTo(memberProfilePath(studentId))}
            className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card active:bg-accent"
          >
            <LucideIcon name="ArrowLeft" className="h-5 w-5 text-foreground" />
          </Pressable>
          <Text className="text-lg font-bold text-foreground">Member action</Text>
          <View className="h-10 w-10" />
        </View>
        <View className="flex-1 items-center justify-center pb-20">
          <View className="h-16 w-16 items-center justify-center rounded-3xl bg-secondary">
            <LucideIcon name={icon} className="h-7 w-7 text-tertiary" />
          </View>
          <Text className="mt-5 text-2xl font-bold text-foreground">
            {details?.title ?? "Action unavailable"}
          </Text>
          <Text className="mt-3 max-w-[290px] text-center text-sm leading-5 text-muted-foreground">
            {details?.description ?? "This action is not available for this member."}
          </Text>
          <View className="mt-6 rounded-full bg-warning/15 px-3 py-1.5">
            <Text className="text-xs font-bold text-warning">
              Placeholder only · no changes saved
            </Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
