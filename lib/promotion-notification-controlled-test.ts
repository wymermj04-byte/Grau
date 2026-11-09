import { database } from '@/lib/database';
import {
  isPromotionNotificationControlledTestEnabled,
  promotionNotificationControlledTestCapability,
} from '@/lib/promotion-notification-controlled-test-feature';
import { supabase } from '@/lib/supabase';

type StudentRow = {
  studentId?: unknown;
  gym_id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  belt_rank?: unknown;
  stripes?: unknown;
  promotion_track?: unknown;
};

type FamilyLinkRow = {
  id?: unknown;
  gym_id?: unknown;
  student_id?: unknown;
  user_id?: unknown;
  relationship?: unknown;
  status?: unknown;
  approved_at?: unknown;
  revoked_at?: unknown;
};

export type PromotionNotificationTestContext = {
  student: {
    id: number;
    name: string;
    belt: string;
    stripes: number;
    promotionTrack: string;
  };
  familyLink: {
    id: number;
    relationship: string;
    status: string;
    approved: boolean;
  };
};

function requireHarnessEnabled() {
  if (!isPromotionNotificationControlledTestEnabled()) {
    throw new Error(promotionNotificationControlledTestCapability.reason);
  }
}

function positiveInteger(value: unknown, label: string) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new Error(`The controlled test returned an invalid ${label}.`);
  }
  return numeric;
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`The controlled test returned an invalid ${label}.`);
  }
  return value.trim();
}

function studentContext(value: unknown): PromotionNotificationTestContext['student'] {
  if (!value || typeof value !== 'object') throw new Error('Test student 64 was not found in the active gym.');
  const student = value as StudentRow;
  const id = positiveInteger(student.studentId, 'student ID');
  const gymId = positiveInteger(student.gym_id, 'gym ID');
  const stripes = Number(student.stripes);
  if (
    id !== promotionNotificationControlledTestCapability.studentId
    || gymId !== promotionNotificationControlledTestCapability.gymId
    || !Number.isInteger(stripes)
    || stripes < 0
    || stripes > 4
  ) {
    throw new Error('The returned student is outside the reviewed Gym 4 test scope.');
  }
  const firstName = requiredText(student.first_name, 'student first name');
  const lastName = requiredText(student.last_name, 'student last name');
  return {
    id,
    name: `${firstName} ${lastName}`,
    belt: requiredText(student.belt_rank, 'belt rank'),
    stripes,
    promotionTrack: requiredText(student.promotion_track, 'promotion track'),
  };
}

function familyLinkContext(value: unknown): PromotionNotificationTestContext['familyLink'] {
  if (!value || typeof value !== 'object') {
    throw new Error('The approved notification-test family link was not found.');
  }
  const link = value as FamilyLinkRow;
  const id = positiveInteger(link.id, 'family link ID');
  const gymId = positiveInteger(link.gym_id, 'family link gym ID');
  const studentId = positiveInteger(link.student_id, 'family link student ID');
  if (
    id !== 4
    || gymId !== promotionNotificationControlledTestCapability.gymId
    || studentId !== promotionNotificationControlledTestCapability.studentId
    || link.user_id !== promotionNotificationControlledTestCapability.familyUserId
    || link.relationship !== 'parent_guardian'
    || typeof link.status !== 'string'
  ) {
    throw new Error('The returned family link is outside the reviewed notification-test scope.');
  }
  return {
    id,
    relationship: link.relationship,
    status: link.status,
    approved: link.status === 'approved' && typeof link.approved_at === 'string' && link.approved_at.length > 0 && link.revoked_at === null,
  };
}

/** Deliberate read-only context load; it cannot create a promotion or notification. */
export async function loadPromotionNotificationTestContext(): Promise<PromotionNotificationTestContext> {
  requireHarnessEnabled();
  const [students, linkResult] = await Promise.all([
    database.listStudents<StudentRow>(),
    supabase
      .from('member_account_links')
      .select('id, gym_id, student_id, user_id, relationship, status, approved_at, revoked_at')
      .eq('id', 4)
      .eq('gym_id', promotionNotificationControlledTestCapability.gymId)
      .eq('student_id', promotionNotificationControlledTestCapability.studentId)
      .eq('user_id', promotionNotificationControlledTestCapability.familyUserId)
      .maybeSingle(),
  ]);
  if (linkResult.error) throw new Error(linkResult.error.message || 'The test family link could not be loaded.');
  return {
    student: studentContext(students.find((student) => Number(student.studentId) === promotionNotificationControlledTestCapability.studentId)),
    familyLink: familyLinkContext(linkResult.data),
  };
}

/**
 * Prepared only: this guard prevents accidental use until a separate approval
 * changes the operation-specific switch. The existing admin RPC remains the
 * sole server-side promotion path and retains all of its validations.
 */
export async function executePreparedPromotionNotificationTest() {
  requireHarnessEnabled();
  if (!promotionNotificationControlledTestCapability.promotionExecutionEnabled) {
    throw new Error(promotionNotificationControlledTestCapability.actionReason);
  }

  const context = await loadPromotionNotificationTestContext();
  if (
    context.student.belt !== 'White'
    || context.student.stripes !== 0
    || context.student.promotionTrack !== 'adults'
    || !context.familyLink.approved
  ) {
    throw new Error('The test preconditions changed. The promotion RPC was not called.');
  }

  await database.recordStudentPromotion(
    promotionNotificationControlledTestCapability.studentId,
    'White',
    1,
    'stripe',
  );
}
