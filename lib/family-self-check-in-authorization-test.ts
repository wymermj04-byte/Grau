import { supabase } from '@/lib/supabase';
import {
  familySelfCheckInAuthorizationTestCapability,
  isFamilySelfCheckInAuthorizationTestEnabled,
} from '@/lib/family-self-check-in-authorization-test-feature';

const gymId = 4;
const impossibleEntityId = Number.MAX_SAFE_INTEGER;
const rolloutDisabledCode = '42501';
const rolloutDisabledMessage = 'Family self-check-in is not enabled for this academy.';
const requestNotFoundMessage = 'Check-in request was not found.';

type RpcError = { code?: unknown; message?: unknown };

export type FamilySelfCheckInAuthorizationProbe =
  | 'family-available-classes'
  | 'family-eligible-students'
  | 'family-request'
  | 'staff-list-requests'
  | 'staff-resolve-request'
  | 'staff-bulk-approve';

export type FamilySelfCheckInAuthorizationResult = {
  probe: FamilySelfCheckInAuthorizationProbe;
  status: 'passed' | 'failed';
  summary: string;
  errorCode: string | null;
  completedAt: string;
};

function requireHarnessEnabled() {
  if (!isFamilySelfCheckInAuthorizationTestEnabled()) {
    throw new Error(familySelfCheckInAuthorizationTestCapability.reason);
  }
}

function validClassId(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Enter a valid Gym 4 class ID before running this probe.');
  }
  return value;
}

function safeErrorCode(error: RpcError | null) {
  return typeof error?.code === 'string' ? error.code : null;
}

function hasExactError(error: RpcError | null, code: string, message: string) {
  return error?.code === code && error?.message === message;
}

function result(
  probe: FamilySelfCheckInAuthorizationProbe,
  passed: boolean,
  summary: string,
  error: RpcError | null,
): FamilySelfCheckInAuthorizationResult {
  return {
    probe,
    status: passed ? 'passed' : 'failed',
    summary,
    errorCode: safeErrorCode(error),
    completedAt: new Date().toISOString(),
  };
}

function disabledResult(probe: FamilySelfCheckInAuthorizationProbe, error: RpcError | null) {
  return result(
    probe,
    hasExactError(error, rolloutDisabledCode, rolloutDisabledMessage),
    hasExactError(error, rolloutDisabledCode, rolloutDisabledMessage)
      ? 'The server rejected this probe because Gym 4 self-check-in remains disabled.'
      : 'The probe did not receive the expected rollout-disabled authorization rejection.',
    error,
  );
}

/**
 * The request and bulk probes use Number.MAX_SAFE_INTEGER as a deliberately
 * impossible entity identifier. They never receive student or request data.
 */
export async function runFamilySelfCheckInAuthorizationProbe(
  probe: FamilySelfCheckInAuthorizationProbe,
  classId?: number,
): Promise<FamilySelfCheckInAuthorizationResult> {
  requireHarnessEnabled();

  switch (probe) {
    case 'family-available-classes': {
      const { error } = await supabase.rpc('family_self_check_in_available_classes', { p_gym_id: gymId });
      return disabledResult(probe, error as RpcError | null);
    }
    case 'family-eligible-students': {
      const { error } = await supabase.rpc('family_self_check_in_eligible_students', {
        p_gym_id: gymId,
        p_class_id: validClassId(classId ?? Number.NaN),
      });
      return disabledResult(probe, error as RpcError | null);
    }
    case 'family-request': {
      const { error } = await supabase.rpc('family_self_check_in_request', {
        p_gym_id: gymId,
        p_class_id: validClassId(classId ?? Number.NaN),
        p_student_ids: [impossibleEntityId],
        p_request_key: '00000000-0000-4000-8000-000000000001',
      });
      return disabledResult(probe, error as RpcError | null);
    }
    case 'staff-list-requests': {
      const { error } = await supabase.rpc('staff_self_check_in_list_requests', {
        p_class_id: validClassId(classId ?? Number.NaN),
      });
      return disabledResult(probe, error as RpcError | null);
    }
    case 'staff-resolve-request': {
      const { error } = await supabase.rpc('staff_self_check_in_resolve_request', {
        p_request_id: impossibleEntityId,
        p_decision: 'decline',
        p_resolution_key: '00000000-0000-4000-8000-000000000002',
      });
      return result(
        probe,
        hasExactError(error as RpcError | null, rolloutDisabledCode, requestNotFoundMessage),
        hasExactError(error as RpcError | null, rolloutDisabledCode, requestNotFoundMessage)
          ? 'The server rejected the impossible request ID without resolving or changing a request.'
          : 'The probe did not receive the expected not-found rejection.',
        error as RpcError | null,
      );
    }
    case 'staff-bulk-approve': {
      const { error } = await supabase.rpc('staff_self_check_in_bulk_approve', {
        p_class_id: validClassId(classId ?? Number.NaN),
        p_request_ids: [impossibleEntityId],
        p_resolution_key: '00000000-0000-4000-8000-000000000003',
      });
      return disabledResult(probe, error as RpcError | null);
    }
  }
}
