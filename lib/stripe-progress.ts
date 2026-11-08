export type PromotionTrack = "kids" | "adults";
export type ProgressState = "ready" | "setup-needed" | "rank-unconfigured";
export type ProgressSource = "app-promotion" | "historical-promotion-date" | "confirmed-baseline";

export type StripeProgressResult =
  | {
      state: "ready";
      counted: number;
      required: number;
      remaining: number;
      met: boolean;
      track: PromotionTrack;
      source: ProgressSource;
    }
  | { state: "setup-needed" | "rank-unconfigured"; reason: string };

export type ProgressStudent = {
  belt_rank: string;
  stripes: number;
  programs: string[];
  promotion_track?: string | null;
};

/** Attendance classification is a saved snapshot; class names/types are never inferred here. */
export type ProgressAttendance = {
  id?: number;
  class_id?: number | null;
  check_in_date?: string | null;
  stripe_progress_classification?: string | null;
};

export type ProgressClass = {
  id?: number;
  /** Live schema: scheduled class calendar timestamp, stored as timestamptz. */
  class_date?: string | null;
  /** Verified UTC-calendar-day contract for existing class writes. */
  scheduled_class_day?: string | null;
  /**
   * Actual scheduled-start instant projected by the server as timestamptz.
   * The current save contract stores the selected calendar day at UTC midnight,
   * so it is built as `((class_date AT TIME ZONE 'UTC')::date + start_time)
   * AT TIME ZONE gym_time_zone`, then compared directly with
   * `promotion_effective_at`.
   */
  scheduled_start_at?: string | null;
};

export type ProgressPromotion = {
  promotion_effective_at?: string | null;
  student_id?: number;
  new_belt?: string | null;
  new_stripes?: number | null;
  promotion_track_at_promotion?: string | null;
};

export type ProgressBaseline = {
  student_id?: number;
  cutoff_exclusive_at?: string | null;
  starting_class_count?: number | null;
  belt_rank_at_confirmation?: string | null;
  stripes_at_confirmation?: number | null;
  promotion_track_at_confirmation?: string | null;
};

export type HistoricalPromotionBoundary = {
  id?: number;
  student_id?: number;
  last_promotion_date?: string | null;
  time_zone_at_confirmation?: string | null;
  confirmed_at?: string | null;
  belt_rank_at_confirmation?: string | null;
  stripes_at_confirmation?: number | null;
  promotion_track_at_confirmation?: string | null;
};

export type ClassContractException = {
  id?: number;
  class_date?: string | null;
};

export type StripeProgressRecords = {
  /** Required for server-safe scheduled-class boundaries. */
  classes?: ProgressClass[];
  historicalBoundaries?: HistoricalPromotionBoundary[];
};

const adultRequirements: Record<string, number[]> = {
  white: [30, 30, 40, 40],
  blue: [50, 50, 60, 60],
  purple: [80, 80, 90, 90],
  brown: [100, 100, 110, 110],
};

const adultNextBeltRequirements: Record<string, number> = {
  white: 40,
  blue: 60,
  purple: 90,
  brown: 110,
};

/**
 * Counts only saved qualifying attendance snapshots with a unique scheduled class.
 *
 * App-recorded promotions win over historical dates; historical dates win over a
 * baseline. A lower-precedence source is never added to a higher-precedence count.
 */
export function calculateStripeProgress(
  student: ProgressStudent,
  attendance: ProgressAttendance[],
  promotions: ProgressPromotion[],
  baselines: ProgressBaseline[],
  records: StripeProgressRecords = {},
): StripeProgressResult {
  const track = normaliseTrack(student.promotion_track);
  if (!track) {
    return {
      state: "setup-needed",
      reason: "Choose a saved Kids or Adults promotion track before counting classes.",
    };
  }
  const belt = normaliseBelt(student.belt_rank);
  const required =
    track === "kids"
      ? 30
      : student.stripes >= 4
        ? adultNextBeltRequirements[belt]
        : adultRequirements[belt]?.[student.stripes];
  if (!required)
    return {
      state: "rank-unconfigured",
      reason: "Class requirements are not configured for this rank.",
    };

  const appPromotion = latest(
    promotions.filter(
      (promotion) =>
        isTimestamp(promotion.promotion_effective_at) &&
        matchesSnapshot(promotion, belt, student.stripes, track),
    ),
    (promotion) => timestamp(promotion.promotion_effective_at),
  );
  if (appPromotion) {
    const promotionInstant = timestamp(appPromotion.promotion_effective_at);
    const counted = records.classes
      ? countScheduledQualifyingAttendance(
          attendance,
          records.classes,
          (scheduledClass) =>
            scheduledClass.scheduledStartInstant !== undefined &&
            scheduledClass.scheduledStartInstant > promotionInstant,
        )
      : countLegacyQualifyingAttendance(attendance, promotionInstant);
    return ready(counted, required, track, "app-promotion");
  }

  const historicalBoundary = latestHistoricalBoundary(
    (records.historicalBoundaries ?? []).filter(
      (boundary) =>
        isCalendarDate(boundary.last_promotion_date) &&
        isTimeZone(boundary.time_zone_at_confirmation) &&
        isTimestamp(boundary.confirmed_at) &&
        matchesSnapshot(boundary, belt, student.stripes, track),
    ),
  );
  if (historicalBoundary) {
    if (!records.classes) {
      return {
        state: "setup-needed",
        reason: "Scheduled class data is needed to count from a historical promotion date.",
      };
    }
    const promotionDate = historicalBoundary.last_promotion_date as string;
    const counted = countScheduledQualifyingAttendance(
      attendance,
      records.classes,
      (scheduledClass) =>
        scheduledClass.scheduledClassDay !== undefined &&
        scheduledClass.scheduledClassDay > promotionDate,
    );
    return ready(counted, required, track, "historical-promotion-date");
  }

  const baseline = latest(
    baselines.filter(
      (item) =>
        isTimestamp(item.cutoff_exclusive_at) &&
        matchesSnapshot(item, belt, student.stripes, track),
    ),
    (item) => timestamp(item.cutoff_exclusive_at),
  );
  if (!baseline) {
    return {
      state: "setup-needed",
      reason: "A confirmed starting count is needed before progress can be counted.",
    };
  }

  const counted =
    countLegacyQualifyingAttendance(attendance, timestamp(baseline.cutoff_exclusive_at)) +
    (baseline.starting_class_count ?? 0);
  return ready(counted, required, track, "confirmed-baseline");
}

function ready(
  counted: number,
  required: number,
  track: PromotionTrack,
  source: ProgressSource,
): StripeProgressResult {
  return {
    state: "ready",
    counted,
    required,
    remaining: Math.max(0, required - counted),
    met: counted >= required,
    track,
    source,
  };
}

function countScheduledQualifyingAttendance(
  attendance: ProgressAttendance[],
  classes: ProgressClass[],
  isAfterBoundary: (scheduledClass: ResolvedProgressClass) => boolean,
) {
  const classInstants = new Map<number, ResolvedProgressClass>();
  for (const scheduledClass of classes) {
    if (
      typeof scheduledClass.id === "number" &&
      Number.isSafeInteger(scheduledClass.id) &&
      isTimestamp(scheduledClass.class_date)
    ) {
      classInstants.set(scheduledClass.id, {
        scheduledClassDay: isCalendarDate(scheduledClass.scheduled_class_day)
          ? scheduledClass.scheduled_class_day
          : undefined,
        scheduledStartInstant: isTimestamp(scheduledClass.scheduled_start_at)
          ? timestamp(scheduledClass.scheduled_start_at)
          : undefined,
      });
    }
  }

  const uniqueClassIds = new Set<number>();
  for (const record of attendance) {
    if (!isQualifyingScheduledAttendance(record)) continue;
    const scheduledClass = classInstants.get(record.class_id as number);
    if (scheduledClass && isAfterBoundary(scheduledClass))
      uniqueClassIds.add(record.class_id as number);
  }
  return uniqueClassIds.size;
}

type ResolvedProgressClass = {
  scheduledClassDay: string | undefined;
  scheduledStartInstant: number | undefined;
};

function countLegacyQualifyingAttendance(
  attendance: ProgressAttendance[],
  startExclusiveOrInclusive: number,
) {
  return new Set(
    attendance
      .filter(
        (record) =>
          isQualifyingScheduledAttendance(record) &&
          isTimestamp(record.check_in_date) &&
          timestamp(record.check_in_date) >= startExclusiveOrInclusive,
      )
      .map((record) => record.class_id as number),
  ).size;
}

function isQualifyingScheduledAttendance(record: ProgressAttendance) {
  return (
    record.stripe_progress_classification === "qualifying" &&
    typeof record.class_id === "number" &&
    Number.isSafeInteger(record.class_id)
  );
}

function matchesSnapshot(
  record: ProgressPromotion | ProgressBaseline | HistoricalPromotionBoundary,
  belt: string,
  stripes: number,
  track: PromotionTrack,
) {
  if (isPromotion(record)) {
    return (
      normaliseBelt(record.new_belt) === belt &&
      record.new_stripes === stripes &&
      normaliseTrack(record.promotion_track_at_promotion) === track
    );
  }
  return (
    normaliseBelt(record.belt_rank_at_confirmation) === belt &&
    record.stripes_at_confirmation === stripes &&
    normaliseTrack(record.promotion_track_at_confirmation) === track
  );
}

function isPromotion(
  record: ProgressPromotion | ProgressBaseline | HistoricalPromotionBoundary,
): record is ProgressPromotion {
  return "promotion_effective_at" in record;
}

function latest<T>(items: T[], score: (item: T) => number) {
  return items.reduce<T | undefined>(
    (current, item) => (!current || score(item) > score(current) ? item : current),
    undefined,
  );
}

/** Newest staff confirmation wins; identity breaks a rare equal-timestamp tie. */
function latestHistoricalBoundary(items: HistoricalPromotionBoundary[]) {
  return items.reduce<HistoricalPromotionBoundary | undefined>((current, item) => {
    if (!current) return item;
    const timestampDifference = timestamp(item.confirmed_at) - timestamp(current.confirmed_at);
    if (timestampDifference !== 0) return timestampDifference > 0 ? item : current;
    return (item.id ?? 0) > (current.id ?? 0) ? item : current;
  }, undefined);
}

function normaliseTrack(value: string | null | undefined): PromotionTrack | undefined {
  const normalised = value?.trim().toLowerCase();
  return normalised === "kids" || normalised === "adults" ? normalised : undefined;
}

function normaliseBelt(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function isTimestamp(value: string | null | undefined): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isCalendarDate(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  );
}

function isTimeZone(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function timestamp(value: string | null | undefined) {
  return Date.parse(value ?? "");
}
