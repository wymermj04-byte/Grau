import * as React from "react";
import { Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import LucideIcon from "@/lib/icons/LucideIcon";

type CalendarDatePickerProps = {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
};

type CalendarMonth = { year: number; month: number };

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A calendar-date picker deliberately works with YYYY-MM-DD strings instead of
 * Date values, so selecting a date never shifts it because of device timezone.
 */
export function CalendarDatePicker({
  label,
  value,
  onChange,
  disabled = false,
}: CalendarDatePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [visibleMonth, setVisibleMonth] = React.useState<CalendarMonth>(() =>
    monthFor(value) ?? currentMonth(),
  );

  React.useEffect(() => {
    const nextMonth = monthFor(value);
    if (nextMonth) setVisibleMonth(nextMonth);
  }, [value]);

  const weeks = React.useMemo(
    () => calendarWeeks(visibleMonth.year, visibleMonth.month),
    [visibleMonth],
  );
  const visibleLabel = monthLabel(visibleMonth);

  const moveMonth = (amount: number) => {
    setVisibleMonth((current) => {
      const next = new Date(Date.UTC(current.year, current.month + amount, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  };

  return (
    <View>
      <Text className="mb-2 font-bold text-foreground">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? "not selected"}`}
        accessibilityHint="Opens a calendar to choose a date"
        disabled={disabled}
        onPress={() => setIsOpen((open) => !open)}
        className="min-h-12 flex-row items-center justify-between rounded-xl border border-input bg-background px-4 py-3 active:bg-accent disabled:opacity-50"
      >
        <Text className={value ? "font-medium text-foreground" : "text-muted-foreground"}>
          {value ?? "Choose a date"}
        </Text>
        <LucideIcon name="CalendarDays" className="h-5 w-5 text-tertiary" />
      </Pressable>

      {isOpen ? (
        <View className="mt-3 rounded-2xl border border-border bg-background p-3">
          <View className="flex-row items-center justify-between">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              onPress={() => moveMonth(-1)}
              className="h-9 w-9 items-center justify-center rounded-lg active:bg-accent"
            >
              <LucideIcon name="ChevronLeft" className="h-5 w-5 text-foreground" />
            </Pressable>
            <Text className="font-bold text-foreground">{visibleLabel}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              onPress={() => moveMonth(1)}
              className="h-9 w-9 items-center justify-center rounded-lg active:bg-accent"
            >
              <LucideIcon name="ChevronRight" className="h-5 w-5 text-foreground" />
            </Pressable>
          </View>
          <View className="mt-3 flex-row">
            {weekdays.map((day) => (
              <View key={day} className="flex-1 items-center py-1">
                <Text className="text-xs font-medium text-muted-foreground">{day}</Text>
              </View>
            ))}
          </View>
          <View className="gap-1">
            {weeks.map((week, weekIndex) => (
              <View key={`${visibleMonth.year}-${visibleMonth.month}-${weekIndex}`} className="flex-row gap-1">
                {week.map((date, dayIndex) => {
                  if (!date) return <View key={`blank-${dayIndex}`} className="h-10 flex-1" />;
                  const selected = date === value;
                  return (
                    <Pressable
                      key={date}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${date}`}
                      accessibilityState={{ selected }}
                      onPress={() => {
                        onChange(date);
                        setIsOpen(false);
                      }}
                      className={
                        selected
                          ? "h-10 flex-1 items-center justify-center rounded-lg bg-primary"
                          : "h-10 flex-1 items-center justify-center rounded-lg active:bg-accent"
                      }
                    >
                      <Text className={selected ? "font-bold text-primary-foreground" : "text-foreground"}>
                        {date.slice(-2).replace(/^0/, "")}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function currentMonth(): CalendarMonth {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function monthFor(value: string | null): CalendarMonth | null {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month };
}

function calendarWeeks(year: number, month: number): Array<Array<string | null>> {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const days = Array.from({ length: firstWeekday }, () => null as string | null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  while (days.length % 7 !== 0) days.push(null);
  return Array.from({ length: days.length / 7 }, (_, index) => days.slice(index * 7, index * 7 + 7));
}

function monthLabel({ year, month }: CalendarMonth) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month, 1)));
}
