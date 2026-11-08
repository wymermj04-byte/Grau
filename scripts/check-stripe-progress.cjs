const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "..", "lib", "stripe-progress.ts"), "utf8");
const databaseSource = fs.readFileSync(path.join(__dirname, "..", "lib", "database.ts"), "utf8");
const profileSource = fs.readFileSync(
  path.join(__dirname, "..", "app", "members", "[studentId].tsx"),
  "utf8",
);
const setupSource = fs.readFileSync(
  path.join(__dirname, "..", "app", "members", "[studentId]", "stripe-progress-setup.tsx"),
  "utf8",
);
const reviewSource = fs.readFileSync(path.join(__dirname, "..", "app", "promotions.tsx"), "utf8");
const amendmentSource = fs.readFileSync(
  path.join(__dirname, "..", "docs", "stripe-progress-historical-date-amendment.sql"),
  "utf8",
);
assert.doesNotMatch(
  source,
  /class_name|class_type/,
  "progress eligibility must not infer a classification from class metadata",
);
assert.match(databaseSource, /get_gym_stripe_progress_context/);
assert.match(databaseSource, /listAttendanceForStudent/);
assert.match(databaseSource, /\.eq\('student_id', studentId\)/);
assert.match(databaseSource, /\.range\(from, from \+ pageSize - 1\)/);
assert.match(databaseSource, /confirm_student_historical_promotion_date/);
assert.match(profileSource, /getGymStripeProgressContext/);
assert.match(profileSource, /Recorded qualifying classes since last promotion/);
assert.match(profileSource, /filterAttendanceForStudent\(attendance, student\.studentId\)/);
assert.match(profileSource, /listAttendanceForStudent<ProfileAttendance>\(student\.studentId\)/);
assert.match(profileSource, /normaliseStudentId\(record\.student_id\) === normalisedSelectedId/);
assert.match(profileSource, /useFocusEffect\(/);
assert.match(setupSource, /Last promotion date/);
assert.match(setupSource, /confirmHistoricalPromotionDate/);
assert.match(setupSource, /useState<BoundaryMode>\(["']historical-date["']\)/);
assert.match(setupSource, /Confirmed starting count/);
assert.match(setupSource, /border border-border bg-card[\s\S]*text-base text-foreground/);
assert.match(reviewSource, /getGymStripeProgressContext/);
assert.match(reviewSource, /listAttendance<ReviewAttendance>\(\)/);
assert.match(reviewSource, /filterReviewAttendanceForStudent\(attendance, student\.studentId\)/);
assert.match(reviewSource, /normaliseStudentId\(record\.student_id\) === normalisedSelectedId/);
assert.match(profileSource, /Rank requirements unavailable/);
assert.match(profileSource, /Progress toward next belt/);
assert.match(profileSource, /Class requirement met — coach review for next belt\./);
assert.match(reviewSource, /Progress toward next belt/);
assert.match(reviewSource, /Class requirement met — coach review for next belt\./);
assert.match(amendmentSource, /\(scheduled_class\.class_date at time zone 'UTC'\)::date/);
assert.match(amendmentSource, /scheduled_class\.start_time\) at time zone v_timezone/);
assert.match(amendmentSource, /class_contract_exceptions/);
assert.match(amendmentSource, /for update/);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledModule = { exports: {} };
new Function("exports", "module", compiled)(compiledModule.exports, compiledModule);

const { calculateStripeProgress } = compiledModule.exports;

const adult = { belt_rank: "White", stripes: 0, programs: ["adults"], promotion_track: "adults" };
const kidsInAdultsProgram = {
  belt_rank: "Yellow",
  stripes: 0,
  programs: ["adults"],
  promotion_track: "kids",
};
const fourStripeAdult = {
  belt_rank: "White",
  stripes: 4,
  programs: ["adults"],
  promotion_track: "adults",
};
const kidsAtFourStripesWithAdultsEnrollment = {
  belt_rank: "Yellow",
  stripes: 4,
  programs: ["adults"],
  promotion_track: "kids",
};

function assertReady(result, message) {
  assert.equal(result.state, "ready", message);
  return result;
}

function scheduledClass(
  id,
  classDate,
  scheduledStartAt = classDate,
  scheduledClassDay = classDate.slice(0, 10),
) {
  return {
    id,
    class_date: classDate,
    scheduled_start_at: scheduledStartAt,
    scheduled_class_day: scheduledClassDay,
  };
}

function attendance(
  classId,
  classification = "qualifying",
  checkInDate = "2026-03-09T12:00:00.000Z",
) {
  return {
    class_id: classId,
    stripe_progress_classification: classification,
    check_in_date: checkInDate,
  };
}

function attendanceForStudent(studentId, classId, classification = "qualifying") {
  return {
    ...attendance(classId, classification),
    student_id: studentId,
  };
}

function filterAttendanceForStudent(attendanceRecords, selectedStudentId) {
  const normalize = (value) => {
    const numericValue =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^\d+$/.test(value.trim())
          ? Number(value.trim())
          : Number.NaN;
    return Number.isSafeInteger(numericValue) ? String(numericValue) : null;
  };
  const selectedId = normalize(selectedStudentId);
  return selectedId ? attendanceRecords.filter((record) => normalize(record.student_id) === selectedId) : [];
}

function appPromotion(overrides = {}) {
  return {
    promotion_effective_at: "2026-03-08T15:00:00.000Z",
    new_belt: "White",
    new_stripes: 0,
    promotion_track_at_promotion: "adults",
    ...overrides,
  };
}

function historicalBoundary(overrides = {}) {
  return {
    id: 1,
    last_promotion_date: "2026-03-08",
    time_zone_at_confirmation: "America/New_York",
    confirmed_at: "2026-03-10T12:00:00.000Z",
    belt_rank_at_confirmation: "White",
    stripes_at_confirmation: 0,
    promotion_track_at_confirmation: "adults",
    ...overrides,
  };
}

function baseline(overrides = {}) {
  return {
    cutoff_exclusive_at: "2026-03-01T00:00:00.000Z",
    starting_class_count: 12,
    belt_rank_at_confirmation: "White",
    stripes_at_confirmation: 0,
    promotion_track_at_confirmation: "adults",
    ...overrides,
  };
}

const missingTrack = calculateStripeProgress(
  { ...fourStripeAdult, promotion_track: null },
  [],
  [],
  [],
);
assert.equal(
  missingTrack.state,
  "setup-needed",
  "missing track remains a setup state, not a four-stripe review",
);

const unsupportedRank = calculateStripeProgress({ ...adult, belt_rank: "Coral" }, [], [], []);
assert.equal(
  unsupportedRank.state,
  "rank-unconfigured",
  "unsupported ranks remain distinct from four-stripe review",
);

const unsupportedNextBeltRank = calculateStripeProgress(
  { ...fourStripeAdult, belt_rank: "Coral" },
  [],
  [],
  [],
);
assert.equal(
  unsupportedNextBeltRank.state,
  "rank-unconfigured",
  "unsupported adult ranks remain unconfigured at four stripes",
);

function nextBeltProgress(student, classCount) {
  const firstClassId = 60;
  return assertReady(
    calculateStripeProgress(
      student,
      Array.from({ length: classCount }, (_, index) => attendance(firstClassId + index)),
      [],
      [],
      {
        classes: Array.from({ length: classCount }, (_, index) =>
          scheduledClass(
            firstClassId + index,
            "2026-03-09T00:00:00.000Z",
            `2026-03-09T${String(12 + (index % 10)).padStart(2, "0")}:00:00.000Z`,
            "2026-03-09",
          ),
        ),
        historicalBoundaries: [
          historicalBoundary({
            belt_rank_at_confirmation: student.belt_rank,
            stripes_at_confirmation: student.stripes,
            promotion_track_at_confirmation: student.promotion_track,
          }),
        ],
      },
    ),
    `${student.promotion_track} four-stripe ${classCount}-class fixture is ready`,
  );
}

// At four stripes, Kids and the configured adult belts count toward the next
// belt from the same matching boundary rules. The Kids fixture deliberately
// has Adults enrollment to prove enrollment never selects the promotion track.
const nextBeltTargets = [
  { name: "Kids", student: kidsAtFourStripesWithAdultsEnrollment, required: 30 },
  { name: "Adult White", student: fourStripeAdult, required: 40 },
  { name: "Adult Blue", student: { ...fourStripeAdult, belt_rank: "Blue" }, required: 60 },
  { name: "Adult Purple", student: { ...fourStripeAdult, belt_rank: "Purple" }, required: 90 },
  { name: "Adult Brown", student: { ...fourStripeAdult, belt_rank: "Brown" }, required: 110 },
];

for (const { name, student, required } of nextBeltTargets) {
  for (const classCount of [required - 1, required, required + 1]) {
    const progress = nextBeltProgress(student, classCount);
    assert.equal(progress.required, required, `${name} has its next-belt target`);
    assert.equal(progress.counted, classCount, `${name} counts unique qualifying classes`);
    assert.equal(progress.met, classCount >= required, `${name} meets only at its target`);
    assert.equal(
      progress.source,
      "historical-promotion-date",
      `${name} uses its matching boundary`,
    );
  }
}

const kidsFourStripe29 = nextBeltProgress(kidsAtFourStripesWithAdultsEnrollment, 29);
assert.equal(kidsFourStripe29.track, "kids");
assert.equal(kidsFourStripe29.met, false);

// A newer app-recorded promotion boundary resets the next-belt count and wins
// over both historical dates and baselines without combining their totals.
const nextBeltReset = assertReady(
  calculateStripeProgress(
    fourStripeAdult,
    [attendance(900), attendance(901)],
    [appPromotion({ new_belt: "White", new_stripes: 4, promotion_track_at_promotion: "adults" })],
    [
      baseline({
        belt_rank_at_confirmation: "White",
        stripes_at_confirmation: 4,
        starting_class_count: 39,
      }),
    ],
    {
      classes: [
        scheduledClass(900, "2026-03-08T00:00:00.000Z", "2026-03-08T14:00:00.000Z"),
        scheduledClass(901, "2026-03-08T00:00:00.000Z", "2026-03-08T16:00:00.000Z"),
      ],
      historicalBoundaries: [
        historicalBoundary({ belt_rank_at_confirmation: "White", stripes_at_confirmation: 4 }),
      ],
    },
  ),
  "next-belt app promotion reset fixture is ready",
);
assert.equal(nextBeltReset.source, "app-promotion");
assert.equal(
  nextBeltReset.counted,
  1,
  "lower-precedence boundaries and baseline counts do not survive a reset",
);

// Existing stripe-one-through-four adult thresholds remain exactly unchanged.
const existingStripeRequirements = {
  White: [30, 30, 40, 40],
  Blue: [50, 50, 60, 60],
  Purple: [80, 80, 90, 90],
  Brown: [100, 100, 110, 110],
};
for (const [beltRank, requirements] of Object.entries(existingStripeRequirements)) {
  requirements.forEach((required, stripes) => {
    const progress = assertReady(
      calculateStripeProgress(
        { belt_rank: beltRank, stripes, programs: ["adults"], promotion_track: "adults" },
        [],
        [],
        [
          baseline({
            belt_rank_at_confirmation: beltRank,
            stripes_at_confirmation: stripes,
            starting_class_count: 0,
          }),
        ],
      ),
      `${beltRank} stripe ${stripes + 1} threshold is ready`,
    );
    assert.equal(
      progress.required,
      required,
      `${beltRank} stripe ${stripes + 1} threshold is unchanged`,
    );
  });
}

// Historical promotion-day exclusion uses the verified UTC calendar day stored by
// the class writer. The next scheduled day counts; the promotion day does not.
const historicalLocalDate = assertReady(
  calculateStripeProgress(adult, [attendance(1), attendance(2)], [], [], {
    classes: [
      scheduledClass(1, "2026-03-08T00:00:00.000Z", "2026-03-08T14:00:00.000Z", "2026-03-08"),
      scheduledClass(2, "2026-03-09T00:00:00.000Z", "2026-03-09T14:00:00.000Z", "2026-03-09"),
    ],
    historicalBoundaries: [historicalBoundary()],
  }),
  "historical local-date fixture is ready",
);
assert.equal(historicalLocalDate.source, "historical-promotion-date");
assert.equal(
  historicalLocalDate.counted,
  1,
  "promotion-day classes are excluded and the next scheduled day counts",
);

// Historical corrections are append-only. The newest staff confirmation wins even
// when its corrected date is earlier, so a later calendar date cannot silently win.
const newestCorrectionWins = assertReady(
  calculateStripeProgress(adult, [attendance(3), attendance(4)], [], [], {
    classes: [
      scheduledClass(3, "2026-03-07T00:00:00.000Z", "2026-03-07T14:00:00.000Z", "2026-03-07"),
      scheduledClass(4, "2026-03-09T00:00:00.000Z", "2026-03-09T14:00:00.000Z", "2026-03-09"),
    ],
    historicalBoundaries: [
      historicalBoundary({
        id: 1,
        last_promotion_date: "2026-03-08",
        confirmed_at: "2026-03-10T12:00:00.000Z",
      }),
      historicalBoundary({
        id: 2,
        last_promotion_date: "2026-03-06",
        confirmed_at: "2026-03-11T12:00:00.000Z",
      }),
    ],
  }),
  "newest historical correction fixture is ready",
);
assert.equal(
  newestCorrectionWins.counted,
  2,
  "the newest explicit correction uses its own date and does not merge with older boundaries",
);

// DST fixture: on Mar 8, 2026, New York 10:00 is 14:00Z and 11:00 is 15:00Z.
// An app promotion boundary is an exact server timestamp: both 14:00Z and 15:00Z
// are excluded, while the later 16:00Z scheduled start counts.
const exactInstant = assertReady(
  calculateStripeProgress(
    adult,
    [attendance(10), attendance(11), attendance(12)],
    [appPromotion()],
    [],
    {
      classes: [
        scheduledClass(10, "2026-03-08T05:00:00.000Z", "2026-03-08T14:00:00.000Z"),
        scheduledClass(11, "2026-03-08T05:00:00.000Z", "2026-03-08T15:00:00.000Z"),
        scheduledClass(12, "2026-03-08T05:00:00.000Z", "2026-03-08T16:00:00.000Z"),
      ],
    },
  ),
  "app-promotion instant fixture is ready",
);
assert.equal(exactInstant.source, "app-promotion");
assert.equal(
  exactInstant.counted,
  1,
  "scheduled starts must be strictly later than the server promotion instant",
);

// A saved Kids track is valid independently of Adult class-program assignment.
const kidsTrack = assertReady(
  calculateStripeProgress(kidsInAdultsProgram, [attendance(20)], [], [], {
    classes: [scheduledClass(20, "2026-03-09T16:00:00.000Z")],
    historicalBoundaries: [
      historicalBoundary({
        belt_rank_at_confirmation: "Yellow",
        promotion_track_at_confirmation: "kids",
      }),
    ],
  }),
  "Kids track is independent of assigned programs",
);
assert.equal(kidsTrack.track, "kids");
assert.equal(kidsTrack.required, 30);
assert.equal(kidsTrack.counted, 1);

// Classification is the only eligibility signal. Open Mat, duplicate class IDs, and
// attendance that references a missing scheduled class never count.
const classificationAndDeduping = assertReady(
  calculateStripeProgress(
    adult,
    [attendance(30), attendance(30), attendance(31, "open_mat"), attendance(32), attendance(999)],
    [appPromotion({ promotion_effective_at: "2026-03-08T00:00:00.000Z" })],
    [],
    {
      classes: [
        scheduledClass(30, "2026-03-09T16:00:00.000Z"),
        scheduledClass(31, "2026-03-09T17:00:00.000Z"),
        { id: 32, class_date: "2026-03-09T18:00:00.000Z" },
      ],
    },
  ),
  "classification and duplicate fixture is ready",
);
assert.equal(classificationAndDeduping.counted, 1);

// Contract exceptions are not guessed from class_date. Without a validated
// scheduled day/start projection they remain outside the count.
const contractExceptionExcluded = assertReady(
  calculateStripeProgress(
    adult,
    [attendance(33)],
    [appPromotion({ promotion_effective_at: "2026-03-08T00:00:00.000Z" })],
    [],
    { classes: [{ id: 33, class_date: "2026-03-09T13:37:00.000Z" }] },
  ),
  "contract exception fixture is ready",
);
assert.equal(
  contractExceptionExcluded.counted,
  0,
  "an invalid class-date contract is excluded instead of inferred",
);

// App promotion takes precedence over a later-entered historical correction and over a
// baseline. Only the app-promotion period is counted; the baseline start is not added.
const precedence = assertReady(
  calculateStripeProgress(
    adult,
    [attendance(40), attendance(41)],
    [appPromotion({ promotion_effective_at: "2026-03-09T15:00:00.000Z" })],
    [baseline({ starting_class_count: 29 })],
    {
      classes: [
        scheduledClass(40, "2026-03-09T14:00:00.000Z"),
        scheduledClass(41, "2026-03-09T16:00:00.000Z"),
      ],
      historicalBoundaries: [historicalBoundary({ confirmed_at: "2026-12-01T12:00:00.000Z" })],
    },
  ),
  "boundary precedence fixture is ready",
);
assert.equal(precedence.source, "app-promotion");
assert.equal(
  precedence.counted,
  1,
  "lower-precedence historical and baseline sources must not be combined",
);

// Existing baseline behavior remains available only when there is no matching promotion source.
const baselineOnly = assertReady(
  calculateStripeProgress(
    adult,
    [attendance(50, "qualifying", "2026-03-01T00:00:00.000Z")],
    [],
    [baseline()],
  ),
  "baseline-only fixture is ready",
);
assert.equal(baselineOnly.source, "confirmed-baseline");
assert.equal(baselineOnly.counted, 13);

// Profile attendance must be selected-member scoped before the existing
// qualification and class-id deduplication rules run.
const mixedMemberAttendance = [
  attendanceForStudent(101, 60),
  attendanceForStudent("101", 61),
  attendanceForStudent(202, 62),
  attendanceForStudent("202", 63, "open_mat"),
];
const sharedProgressRecords = {
  classes: [
    scheduledClass(60, "2026-03-09T16:00:00.000Z"),
    scheduledClass(61, "2026-03-10T16:00:00.000Z"),
    scheduledClass(62, "2026-03-11T16:00:00.000Z"),
    scheduledClass(63, "2026-03-12T16:00:00.000Z"),
  ],
  historicalBoundaries: [historicalBoundary()],
};
const firstMemberProgress = assertReady(
  calculateStripeProgress(
    adult,
    filterAttendanceForStudent(mixedMemberAttendance, "101"),
    [],
    [],
    sharedProgressRecords,
  ),
  "first member progress is ready",
);
const secondMemberProgress = assertReady(
  calculateStripeProgress(
    adult,
    filterAttendanceForStudent(mixedMemberAttendance, 202),
    [],
    [],
    sharedProgressRecords,
  ),
  "second member progress is ready",
);
assert.equal(firstMemberProgress.counted, 2, "numeric and string IDs match for the selected member");
assert.equal(secondMemberProgress.counted, 1, "other members cannot add to the selected member count");
assert.equal(
  filterAttendanceForStudent(mixedMemberAttendance, null).length,
  0,
  "a missing selected student ID never falls back to gym attendance",
);

// Promotion Review uses one gym-wide read, so another student's qualifying
// attendance must not move this student's remaining-class count or eligibility.
const reviewAttendance = [attendanceForStudent(702, 70)];
const reviewRecords = {
  classes: [scheduledClass(70, "2026-03-09T16:00:00.000Z")],
};
const firstReviewStudent = assertReady(
  calculateStripeProgress(
    adult,
    filterAttendanceForStudent(reviewAttendance, 701),
    [],
    [baseline({ starting_class_count: 29 })],
    reviewRecords,
  ),
  "first Promotion Review student progress is ready",
);
const secondReviewStudent = assertReady(
  calculateStripeProgress(
    adult,
    filterAttendanceForStudent(reviewAttendance, 702),
    [],
    [baseline({ starting_class_count: 0 })],
    reviewRecords,
  ),
  "second Promotion Review student progress is ready",
);
assert.equal(firstReviewStudent.counted, 29, "another student's class cannot raise the first review count");
assert.equal(firstReviewStudent.remaining, 1, "the first review student remains one class short");
assert.equal(firstReviewStudent.met, false, "the first review student is not a promotion candidate");
assert.equal(secondReviewStudent.counted, 1, "the second review student keeps their own attendance");

// Historical promotion dates compare against the stored UTC class calendar day,
// not the attendance import/check-in timestamp. The boundary day is exclusive.
const melissaProgress = assertReady(
  calculateStripeProgress(
    { belt_rank: "Blue", stripes: 2, programs: ["adults"], promotion_track: "adults" },
    [attendance(27), attendance(508), attendance(509), attendance(31), attendance(30), attendance(510), attendance(33)],
    [],
    [],
    {
      classes: [
        scheduledClass(27, "2026-10-01T00:00:00.000Z", "2026-10-01T18:00:00.000Z", "2026-10-01"),
        scheduledClass(508, "2026-10-06T00:00:00.000Z", "2026-10-06T18:00:00.000Z", "2026-10-06"),
        scheduledClass(509, "2026-10-08T00:00:00.000Z", "2026-10-08T18:00:00.000Z", "2026-10-08"),
        scheduledClass(31, "2026-10-13T00:00:00.000Z", "2026-10-13T18:00:00.000Z", "2026-10-13"),
        scheduledClass(30, "2026-10-15T00:00:00.000Z", "2026-10-15T18:00:00.000Z", "2026-10-15"),
        scheduledClass(510, "2026-10-20T00:00:00.000Z", "2026-10-20T18:00:00.000Z", "2026-10-20"),
        scheduledClass(33, "2026-10-22T00:00:00.000Z", "2026-10-22T18:00:00.000Z", "2026-10-22"),
      ],
      historicalBoundaries: [historicalBoundary({
        last_promotion_date: "2026-10-01",
        belt_rank_at_confirmation: "Blue",
        stripes_at_confirmation: 2,
      })],
    },
  ),
  "historical promotion boundary fixture is ready",
);
assert.equal(melissaProgress.required, 60, "Blue belt third-stripe progress requires 60 classes");
assert.equal(melissaProgress.counted, 6, "only the six distinct classes after October 1 count");

console.log(
  "PASS: stripe progress scheduled-boundary, timezone, track, classification, precedence, and member-scoping checks",
);
