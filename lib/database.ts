import { supabase } from '@/lib/supabase';
import { isStripeProgressSchemaAbsent } from '@/lib/promotion-fallback';

type DatabaseResult<T> = PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>;

export type PaymentTrackingEligibleAccount = {
  accountId: number;
  accountKind: 'individual' | 'family';
  accountLabel: string;
};

let sessionGeneration = 0;

export class DatabaseSessionError extends Error {
  constructor() {
    super('Your coach session has ended. Please sign in again.');
    this.name = 'DatabaseSessionError';
  }
}

export class DatabaseQueryError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'DatabaseQueryError';
    this.code = code;
  }
}

export function isWaiverSigningSchemaAbsent(error: unknown) {
  return error instanceof DatabaseQueryError && (error.code === '42P01' || error.code === 'PGRST205');
}

/** Payment tracking is additive. Live safely remains unavailable until its migration is deployed. */
export function isPaymentTrackingSchemaAbsent(error: unknown) {
  return error instanceof DatabaseQueryError && (
    error.code === '42P01'
    || error.code === 'PGRST205'
    || /payment_tracking_(accounts|months|monthly_report)|does not exist|schema cache/i.test(error.message)
  );
}

export class GymMembershipError extends Error {
  readonly reason: 'no-access' | 'selection-required' | 'student-mismatch' | 'admin-required';

  constructor(message: string, reason: 'no-access' | 'selection-required' | 'student-mismatch' | 'admin-required') {
    super(message);
    this.name = 'GymMembershipError';
    this.reason = reason;
  }
}

export function clearDatabaseSession() {
  sessionGeneration += 1;
}

async function getActiveGymContext() {
  const generation = sessionGeneration;
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session || generation !== sessionGeneration) throw new DatabaseSessionError();

  const { data: memberships, error } = await supabase
    .from('gym_staff')
    .select('gym_id, role, is_active')
    .eq('user_id', sessionData.session.user.id)
    .eq('is_active', true);

  if (generation !== sessionGeneration) throw new DatabaseSessionError();
  if (error) throw new DatabaseQueryError(error.message, error.code);

  const activeMemberships = (memberships ?? []).filter(
    (membership) => typeof membership.gym_id === 'number' && Number.isSafeInteger(membership.gym_id) && membership.gym_id > 0,
  );
  if (activeMemberships.length === 0) {
    throw new GymMembershipError('No gym access—contact your administrator.', 'no-access');
  }
  if (activeMemberships.length > 1) {
    throw new GymMembershipError('Gym selection required—choose an authorized gym before continuing.', 'selection-required');
  }

  return { generation, gymId: activeMemberships[0].gym_id, role: activeMemberships[0].role };
}

export async function resolveActiveGymId() {
  const { gymId } = await getActiveGymContext();
  return gymId;
}

export async function resolveActiveGymMembership() {
  const { gymId, role } = await getActiveGymContext();
  return { gymId, role };
}

async function run<T>(query: (gymId: number) => DatabaseResult<T>): Promise<T> {
  const { generation, gymId } = await getActiveGymContext();

  const { data, error } = await query(gymId);
  if (generation !== sessionGeneration) throw new DatabaseSessionError();
  if (error) throw new DatabaseQueryError(error.message, error.code);
  return data as T;
}

async function runAdmin<T>(query: (gymId: number) => DatabaseResult<T>): Promise<T> {
  const { generation, gymId, role } = await getActiveGymContext();
  if (role !== 'admin') {
    throw new GymMembershipError('Billing is available to gym administrators only.', 'admin-required');
  }

  const { data, error } = await query(gymId);
  if (generation !== sessionGeneration) throw new DatabaseSessionError();
  if (error) throw new DatabaseQueryError(error.message, error.code);
  return data as T;
}

async function assertStudentGym(studentId: number | string, gymId: number) {
  const { data, error } = await supabase
    .from('students')
    .select('gym_id')
    .eq('studentId', studentId)
    .maybeSingle();
  if (error) throw new DatabaseQueryError(error.message, error.code);
  if (!data || data.gym_id !== gymId) {
    throw new GymMembershipError('The selected member does not belong to your active gym.', 'student-mismatch');
  }
}

export const database = {
  listStudents: <T>() => run<T[]>((gymId) => supabase.from('students').select('*').eq('gym_id', gymId)),
  createStudent: <T extends Record<string, unknown>>(body: T) => run((gymId) => supabase.from('students').insert({ ...body, gym_id: gymId }).select()),
  updateStudent: <T extends Record<string, unknown>>(studentId: number | string, body: T) => run((gymId) => supabase.from('students').update(body as never).eq('studentId', studentId).eq('gym_id', gymId).select()),
  listClasses: <T>() => run<T[]>((gymId) => supabase.from('classes').select('*').eq('gym_id', gymId)),
  createClass: <T extends Record<string, unknown>>(body: T) => run((gymId) => supabase.from('classes').insert({ ...body, gym_id: gymId }).select()),
  updateClass: <T extends Record<string, unknown>>(id: number | string, body: T) => run((gymId) => supabase.from('classes').update(body as never).eq('id', id).eq('gym_id', gymId).select()),
  listAttendance: <T>() => run<T[]>((gymId) => supabase.from('attendance').select('*').eq('gym_id', gymId)),
  listAttendanceForClass: (classId: number | string) => run<{ student_id: number | null; class_id: number | null }[]>(async (gymId) => {
    const pageSize = 1000;
    const records: { student_id: number | null; class_id: number | null }[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('attendance')
        .select('student_id, class_id')
        .eq('gym_id', gymId)
        .eq('class_id', classId)
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) return { data: null, error };
      const page = (data ?? []) as { student_id: number | null; class_id: number | null }[];
      records.push(...page);
      if (page.length < pageSize) return { data: records, error: null };
    }
  }),
  listAttendanceForStudent: <T>(studentId: number | string) => run<T[]>(async (gymId) => {
    await assertStudentGym(studentId, gymId);
    const pageSize = 1000;
    const records: T[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('attendance')
        .select('*')
        .eq('gym_id', gymId)
        .eq('student_id', studentId)
        .range(from, from + pageSize - 1);
      if (error) return { data: null, error };
      const page = (data ?? []) as T[];
      records.push(...page);
      if (page.length < pageSize) return { data: records, error: null };
    }
  }),
  listAttendanceForClassStudent: (classId: number | string, studentId: number | string) => run<{ student_id: number | null; class_id: number | null }[]>((gymId) => supabase.from('attendance').select('student_id, class_id').eq('gym_id', gymId).eq('class_id', classId).eq('student_id', studentId)),
  removeAttendanceForClassStudent: (classId: number | string, studentId: number | string) => run(async (gymId) => {
    await assertStudentGym(studentId, gymId);
    return supabase
      .from('attendance')
      .delete()
      .eq('gym_id', gymId)
      .eq('class_id', classId)
      .eq('student_id', studentId)
      .select('student_id, class_id');
  }),
  createAttendance: <T extends Record<string, unknown>>(body: T) => run(async (gymId) => {
    const studentId = body.student_id;
    if (typeof studentId !== 'number' && typeof studentId !== 'string') throw new GymMembershipError('A valid member is required for attendance.', 'student-mismatch');
    await assertStudentGym(studentId, gymId);
    return supabase.from('attendance').insert({ ...body, gym_id: gymId }).select();
  }),
  listPayments: <T>() => run<T[]>((gymId) => supabase.from('payments').select('*').eq('gym_id', gymId)),
  createPayment: <T extends Record<string, unknown>>(body: T) => run(async (gymId) => {
    const studentId = body.student_id;
    if (typeof studentId === 'number' || typeof studentId === 'string') await assertStudentGym(studentId, gymId);
    return supabase.from('payments').insert({ ...body, gym_id: gymId }).select();
  }),
  getPaymentTrackingCapability: async (): Promise<'available' | 'absent'> => {
    try {
      await run<unknown[]>((gymId) => supabase
        .from('payment_tracking_accounts')
        .select('id')
        .eq('gym_id', gymId)
        .limit(1));
      return 'available';
    } catch (error) {
      if (isPaymentTrackingSchemaAbsent(error)) return 'absent';
      throw error;
    }
  },
  getPaymentTrackingMonthlyReport: <T>(monthStart: string, at?: string) => run<T[]>((gymId) => supabase.rpc('payment_tracking_monthly_report', {
    p_gym_id: gymId,
    p_month_start: monthStart,
    ...(at ? { p_at: at } : {}),
  })),
  getEligiblePaymentTrackingAccounts: (studentId: number, monthStart: string) => run<PaymentTrackingEligibleAccount[]>(async (gymId) => {
    await assertStudentGym(studentId, gymId);

    const { data: monthMembers, error: monthMembersError } = await supabase
      .from('payment_tracking_month_members')
      .select('account_id, coverage_status')
      .eq('gym_id', gymId)
      .eq('student_id', studentId)
      .eq('month_start', monthStart);
    if (monthMembersError) return { data: null, error: monthMembersError };

    const hasFrozenSnapshot = (monthMembers ?? []).length > 0;
    let accountIds: number[];

    if (hasFrozenSnapshot) {
      accountIds = (monthMembers ?? [])
        .filter((member) => member.coverage_status === 'active')
        .map((member) => member.account_id)
        .filter((accountId): accountId is number => typeof accountId === 'number');
    } else {
      const { data: accountMembers, error: accountMembersError } = await supabase
        .from('payment_tracking_account_members')
        .select('account_id')
        .eq('gym_id', gymId)
        .eq('student_id', studentId)
        .eq('coverage_status', 'active')
        .lte('effective_start_month', monthStart)
        .or(`effective_end_month.is.null,effective_end_month.gte.${monthStart}`);
      if (accountMembersError) return { data: null, error: accountMembersError };
      accountIds = (accountMembers ?? [])
        .map((member) => member.account_id)
        .filter((accountId): accountId is number => typeof accountId === 'number');
    }

    const uniqueAccountIds = [...new Set(accountIds)];
    if (uniqueAccountIds.length === 0) return { data: [], error: null };

    const { data: accounts, error: accountsError } = await supabase
      .from('payment_tracking_accounts')
      .select('id, account_kind, account_label')
      .eq('gym_id', gymId)
      .in('id', uniqueAccountIds);
    if (accountsError) return { data: null, error: accountsError };

    return {
      data: (accounts ?? []).map((account) => ({
        accountId: account.id,
        accountKind: account.account_kind,
        accountLabel: account.account_label,
      })) as PaymentTrackingEligibleAccount[],
      error: null,
    };
  }),
  createPaymentTrackingAccount: (input: {
    accountKind: 'individual' | 'family';
    accountLabel: string;
    effectiveStartMonth: string;
    effectiveEndMonth: string | null;
    memberIds: number[];
    coverageStatus: 'active' | 'exempt' | 'inactive';
    idempotencyKey: string;
  }) => runAdmin<number>((gymId) => supabase.rpc('payment_tracking_create_account', {
    p_gym_id: gymId,
    p_account_kind: input.accountKind,
    p_account_label: input.accountLabel,
    p_effective_start_month: input.effectiveStartMonth,
    p_effective_end_month: input.effectiveEndMonth,
    p_member_ids: input.memberIds,
    p_coverage_status: input.coverageStatus,
    p_idempotency_key: input.idempotencyKey,
  })),
  recordPaymentTrackingPayment: <T>(input: {
    accountId: number;
    monthStart: string;
    amount: number;
    paymentMethod: 'Cash' | 'Check' | 'Cash App';
    paymentType: string;
    notes: string;
    payerLabel: string;
    receivedOn: string;
    checkNumber: string;
    idempotencyKey: string;
  }) => run<T[]>((_) => supabase.rpc('payment_tracking_record_payment', {
    p_account_id: input.accountId,
    p_month_start: input.monthStart,
    p_amount: input.amount,
    p_payment_method: input.paymentMethod,
    p_payment_type: input.paymentType,
    p_notes: input.notes,
    p_payer_label: input.payerLabel,
    p_received_on: input.receivedOn,
    p_check_number: input.checkNumber,
    p_idempotency_key: input.idempotencyKey,
  })),
  recordMemberPayment: <T>(input: {
    studentId: number;
    accountId: number;
    monthStart: string;
    amount: number;
    paymentMethod: 'Cash' | 'Check' | 'Cash App';
    notes: string;
    idempotencyKey: string;
  }) => runAdmin<T[]>((_) => supabase.rpc('payment_tracking_record_member_payment', {
    p_student_id: input.studentId,
    p_account_id: input.accountId,
    p_month_start: input.monthStart,
    p_amount: input.amount,
    p_payment_method: input.paymentMethod,
    p_notes: input.notes,
    p_idempotency_key: input.idempotencyKey,
  })),
  getPaymentForTrackingLink: <T>(paymentId: number) => run<T | null>((gymId) => supabase
    .from('payments')
    .select('id, student_id, amount, payment_status, payment_type, created_at')
    .eq('gym_id', gymId)
    .eq('id', paymentId)
    .maybeSingle()),
  linkExistingPaymentToTrackingMonth: <T>(input: {
    paymentId: number;
    accountId: number;
    monthStart: string;
    idempotencyKey: string;
  }) => runAdmin<T[]>((_) => supabase.rpc('payment_tracking_link_existing_payment', {
    p_payment_id: input.paymentId,
    p_account_id: input.accountId,
    p_month_start: input.monthStart,
    p_idempotency_key: input.idempotencyKey,
  })),
  setPaymentTrackingMonthStatus: <T>(input: {
    accountId: number;
    monthStart: string;
    status: 'paid' | 'partial' | 'no_payment_recorded';
    reason: string;
    idempotencyKey: string;
  }) => run<T>((_) => supabase.rpc('payment_tracking_set_month_status', {
    p_account_id: input.accountId,
    p_month_start: input.monthStart,
    p_new_status: input.status,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  })),
  listBillingProfiles: <T>() => runAdmin<T[]>((gymId) => supabase.from('member_billing_profiles').select('*').eq('gym_id', gymId)),
  listBillingCharges: <T>() => runAdmin<T[]>((gymId) => supabase.from('billing_charges').select('*').eq('gym_id', gymId)),
  listPaymentAllocations: <T>() => runAdmin<T[]>((gymId) => supabase.from('payment_allocations').select('*').eq('gym_id', gymId)),
  listStudentGuardianContacts: <T>() => runAdmin<T[]>((gymId) => supabase.from('student_guardian_contacts').select('*').eq('gym_id', gymId)),
  listGymBillingSettings: <T>() => runAdmin<T[]>((gymId) => supabase.from('gym_billing_settings').select('*').eq('gym_id', gymId)),
  getMemberWaiverSigningData: (studentId: number) => run<{
    activeVersion: { id: string; title: string; exact_text: string; content_sha256: string } | null;
    hasDigitalSubmission: boolean;
  }>(async (gymId) => {
    await assertStudentGym(studentId, gymId);
    const { data: versions, error: versionError } = await supabase
      .from('waiver_versions')
      .select('id, title, exact_text, content_sha256')
      .eq('gym_id', gymId)
      .eq('approval_status', 'approved')
      .order('approved_at', { ascending: false })
      .limit(1);
    if (versionError) return { data: null, error: versionError };

    const { data: submissions, error: submissionError } = await supabase
      .from('member_waiver_submissions')
      .select('id')
      .eq('gym_id', gymId)
      .eq('student_id', studentId)
      .limit(1);
    if (submissionError) return { data: null, error: submissionError };

    return {
      data: { activeVersion: versions?.[0] ?? null, hasDigitalSubmission: Boolean(submissions?.length) },
      error: null,
    };
  }),
  finalizeMemberWaiverSubmission: (input: {
    studentId: number;
    waiverVersionId: string;
    participantName: string;
    signerName: string;
    signerRole: 'participant' | 'parent_guardian';
    emergencyContactName: string;
    emergencyContactPhone: string;
    signatureObjectPath: string;
    idempotencyKey: string;
  }) => run<string>(async (gymId) => {
    await assertStudentGym(input.studentId, gymId);
    return supabase.rpc('finalize_member_waiver_submission', {
      p_student_id: input.studentId,
      p_waiver_version_id: input.waiverVersionId,
      p_participant_name: input.participantName,
      p_signer_name: input.signerName,
      p_signer_role: input.signerRole,
      p_emergency_contact_name: input.emergencyContactName,
      p_emergency_contact_phone: input.emergencyContactPhone,
      p_signature_object_path: input.signatureObjectPath,
      p_idempotency_key: input.idempotencyKey,
    });
  }),
  listGymSettings: <T>() => run<T[]>((gymId) => supabase.from('gym_settings').select('*').eq('id', gymId)),
  updateGymSettings: <T extends Record<string, unknown>>(id: number | string, body: T) => run((gymId) => supabase.from('gym_settings').update(body as never).eq('id', id).eq('id', gymId).select()),
  listPromotions: <T>() => run<T[]>((gymId) => supabase.from('Promotions').select('*').eq('gym_id', gymId)),
  listStripeProgressBaselines: <T>() => run<T[]>((gymId) => supabase.from('student_stripe_progress_baselines').select('*').eq('gym_id', gymId)),
  getGymStripeProgressContext: <T>() => run<T>((_) => supabase.rpc('get_gym_stripe_progress_context')),
  getStripeProgressSchemaCapability: async (): Promise<'available' | 'absent'> => {
    try {
      await run<unknown[]>((gymId) => supabase.from('student_stripe_progress_baselines').select('student_id').eq('gym_id', gymId).limit(1));
      return 'available';
    } catch (error) {
      if (isStripeProgressSchemaAbsent(error)) return 'absent';
      throw error;
    }
  },
  confirmStripeProgressBaseline: <T>(studentId: number, cutoffDate: string, startingClassCount: number, confirmationNote: string) => run<T>((_) => supabase.rpc('confirm_student_stripe_progress_baseline', { p_student_id: studentId, p_cutoff_date: cutoffDate, p_starting_class_count: startingClassCount, p_confirmation_note: confirmationNote })),
  confirmHistoricalPromotionDate: <T>(studentId: number, lastPromotionDate: string, confirmationNote: string) => run<T>((_) => supabase.rpc('confirm_student_historical_promotion_date', { p_student_id: studentId, p_last_promotion_date: lastPromotionDate, p_confirmation_note: confirmationNote })),
  recordStudentPromotion: (studentId: number, belt: string, stripes: number, type: 'stripe' | 'belt') => run<void>((_) => supabase.rpc('record_student_promotion', { p_student_id: studentId, p_new_belt: belt, p_new_stripes: stripes, p_promotion_type: type })),
  createPromotion: <T extends Record<string, unknown>>(body: T) => run(async (gymId) => {
    const studentId = body.student_id;
    if (typeof studentId !== 'number' && typeof studentId !== 'string') throw new GymMembershipError('A valid member is required for a promotion.', 'student-mismatch');
    await assertStudentGym(studentId, gymId);
    return supabase.from('Promotions').insert({ ...body, gym_id: gymId }).select();
  }),
};
