import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {
  familyLinkTestApprovalCapability,
  isFamilyLinkTestApprovalUtilityEnabled,
} from '@/lib/family-link-test-approval-feature';
import { supabase } from '@/lib/supabase';

const STORAGE_PREFIX = 'grau.dev.family-link-test-approval.v1:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LinkRow = {
  id?: unknown;
  student_id?: unknown;
  gym_id?: unknown;
  relationship?: unknown;
  status?: unknown;
};

export type TestFamilyLinkApproval = {
  linkId: number;
  studentId: number;
  gymId: number;
  relationship: 'parent_guardian';
  status: string;
};

function requireEnabled() {
  if (!isFamilyLinkTestApprovalUtilityEnabled()) {
    throw new Error(familyLinkTestApprovalCapability.reason);
  }
}

function requireCurrentAdministratorUserId(userId: string) {
  if (typeof userId !== 'string' || !userId.trim()) {
    throw new Error('Your signed-in administrator account could not be verified.');
  }
  return userId;
}

function storageKey(administratorUserId: string) {
  return `${STORAGE_PREFIX}${encodeURIComponent(administratorUserId)}:${familyLinkTestApprovalCapability.gymId}:${familyLinkTestApprovalCapability.studentId}:${familyLinkTestApprovalCapability.familyUserId}`;
}

function positiveInteger(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`The approval RPC returned an invalid ${label}.`);
  }
  return value;
}

function approvedLink(value: unknown): TestFamilyLinkApproval {
  if (!value || typeof value !== 'object') {
    throw new Error('The approval RPC returned an invalid link result.');
  }
  const link = value as LinkRow;
  const linkId = positiveInteger(link.id, 'link ID');
  const studentId = positiveInteger(link.student_id, 'student ID');
  const gymId = positiveInteger(link.gym_id, 'gym ID');
  if (
    studentId !== familyLinkTestApprovalCapability.studentId
    || gymId !== familyLinkTestApprovalCapability.gymId
    || link.relationship !== familyLinkTestApprovalCapability.relationship
    || typeof link.status !== 'string'
  ) {
    throw new Error('The approval RPC returned a link outside the reviewed test scope.');
  }
  return {
    linkId,
    studentId,
    gymId,
    relationship: familyLinkTestApprovalCapability.relationship,
    status: link.status,
  };
}

/**
 * Persists exactly one secure request key per authenticated administrator and
 * fixed test target. Storage or secure-random failures fail closed.
 */
export async function getFamilyLinkTestApprovalRequestKey(administratorUserId: string) {
  requireEnabled();
  const safeAdministratorUserId = requireCurrentAdministratorUserId(administratorUserId);
  const key = storageKey(safeAdministratorUserId);
  const saved = await AsyncStorage.getItem(key);
  if (saved && UUID_PATTERN.test(saved)) return saved;

  let requestKey: string;
  try {
    requestKey = Crypto.randomUUID();
  } catch {
    throw new Error('Secure request-key generation is unavailable. The approval was not attempted.');
  }
  if (!UUID_PATTERN.test(requestKey)) {
    throw new Error('Secure request-key generation returned an invalid value. The approval was not attempted.');
  }
  await AsyncStorage.setItem(key, requestKey);
  return requestKey;
}

/**
 * This is reachable only through the disabled development capability. It
 * rechecks the current authenticated account immediately before the RPC and
 * never creates links through direct table access.
 */
export async function approveNotificationTestFamilyLink(
  administratorUserId: string,
  requestKey: string,
): Promise<TestFamilyLinkApproval> {
  requireEnabled();
  const safeAdministratorUserId = requireCurrentAdministratorUserId(administratorUserId);
  if (!UUID_PATTERN.test(requestKey)) {
    throw new Error('The saved approval request key is invalid. The approval was not attempted.');
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || authData.user?.id !== safeAdministratorUserId) {
    throw new Error('Your signed-in administrator account changed. The approval was not attempted.');
  }

  const { data, error } = await supabase.rpc('approve_member_account_link', {
    p_gym_id: familyLinkTestApprovalCapability.gymId,
    p_student_id: familyLinkTestApprovalCapability.studentId,
    p_user_id: familyLinkTestApprovalCapability.familyUserId,
    p_relationship: familyLinkTestApprovalCapability.relationship,
    p_request_key: requestKey,
  });
  if (error) {
    throw new Error(error.message || 'The family-link approval was not completed. Retry will use the same request key.');
  }
  return approvedLink(data);
}
