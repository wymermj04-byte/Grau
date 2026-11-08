import * as Crypto from 'expo-crypto';
import { supabase } from '@/lib/supabase';
import { isSelfCheckInEnabled, selfCheckInCapability } from '@/lib/self-check-in-feature';

export type FamilyCheckInAudience = 'kids' | 'adults' | 'mixed';
export type FamilyCheckInRequestState = 'pending' | 'approved' | 'declined' | 'already_checked_in' | 'unavailable' | 'ineligible';

export type FamilyCheckInClass = {
  classId: number;
  gymId: number;
  className: string;
  classDate: string;
  startTime: string;
  audience: FamilyCheckInAudience;
  lifecycle: 'scheduled' | 'in_progress';
  opensAt: string;
};

export type FamilyCheckInStudent = {
  studentId: number;
  gymId: number;
  firstName: string;
  lastName: string | null;
  membershipStatus: string | null;
  programs: string[];
  eligibility: 'eligible' | 'already_requested' | 'already_checked_in' | 'ineligible';
  reason: string | null;
};

export type FamilyCheckInRequestOutcome = {
  studentId: number;
  requestId: number | null;
  state: FamilyCheckInRequestState;
  reason: string | null;
};

export type StaffCheckInRequest = {
  requestId: number;
  studentId: number;
  firstName: string;
  lastName: string | null;
  membershipStatus: string | null;
  requestedAt: string;
  state: FamilyCheckInRequestState;
  reason: string | null;
};

type RpcRow = Record<string, unknown>;
type RpcError = { code?: unknown; message?: unknown };

export class FamilySelfCheckInUnavailableError extends Error {
  constructor() {
    super(selfCheckInCapability.reason);
    this.name = 'FamilySelfCheckInUnavailableError';
  }
}

export class FamilySelfCheckInContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FamilySelfCheckInContractError';
  }
}

export class FamilySelfCheckInApiError extends Error {
  readonly code: string | null;

  constructor(operation: string, error: RpcError) {
    super(typeof error.message === 'string' && error.message.trim() ? error.message.trim() : `${operation} could not be completed.`);
    this.name = 'FamilySelfCheckInApiError';
    this.code = typeof error.code === 'string' ? error.code : null;
  }
}

function requireEnabled() {
  if (!isSelfCheckInEnabled()) throw new FamilySelfCheckInUnavailableError();
}

function positiveInteger(value: unknown, label: string) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new FamilySelfCheckInContractError(`Family self-check-in returned an invalid ${label}.`);
  return numeric;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new FamilySelfCheckInContractError(`Family self-check-in returned an invalid ${label}.`);
  return value;
}

function nullableString(value: unknown, label: string) {
  return value === null || value === undefined ? null : requiredString(value, label);
}

function rows(value: unknown, operation: string): RpcRow[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object')) {
    throw new FamilySelfCheckInContractError(`${operation} returned an invalid response.`);
  }
  return value as RpcRow[];
}

function checkRpcError(operation: string, error: RpcError | null) {
  if (error) throw new FamilySelfCheckInApiError(operation, error);
}

function audience(value: unknown): FamilyCheckInAudience {
  if (value === 'kids' || value === 'adults' || value === 'mixed') return value;
  throw new FamilySelfCheckInContractError('Family self-check-in returned an invalid class audience.');
}

function requestState(value: unknown): FamilyCheckInRequestState {
  if (value === 'pending' || value === 'approved' || value === 'declined' || value === 'already_checked_in' || value === 'unavailable' || value === 'ineligible') return value;
  throw new FamilySelfCheckInContractError('Family self-check-in returned an invalid request state.');
}

function studentIds(studentIds: readonly number[]) {
  const normalized = studentIds.map((studentId) => positiveInteger(studentId, 'student ID'));
  if (normalized.length === 0) throw new FamilySelfCheckInContractError('Select at least one eligible family member.');
  if (new Set(normalized).size !== normalized.length) {
    throw new FamilySelfCheckInContractError('Select each family member only once.');
  }
  return normalized.sort((first, second) => first - second);
}

export function createFamilyCheckInIdempotencyKey() {
  try {
    return Crypto.randomUUID();
  } catch {
    throw new FamilySelfCheckInContractError('Secure request-key generation is unavailable. Please try again later.');
  }
}

export async function listFamilyCheckInClasses(gymId: number): Promise<FamilyCheckInClass[]> {
  requireEnabled();
  const { data, error } = await supabase.rpc('family_self_check_in_available_classes', { p_gym_id: positiveInteger(gymId, 'gym ID') });
  checkRpcError('Loading available classes', error);
  return rows(data, 'Loading available classes').map((row) => ({
    classId: positiveInteger(row.class_id, 'class ID'),
    gymId: positiveInteger(row.gym_id, 'gym ID'),
    className: requiredString(row.class_name, 'class name'),
    classDate: requiredString(row.class_date, 'class date'),
    startTime: requiredString(row.start_time, 'start time'),
    audience: audience(row.class_audience),
    lifecycle: row.lifecycle === 'scheduled' || row.lifecycle === 'in_progress' ? row.lifecycle : (() => { throw new FamilySelfCheckInContractError('Family self-check-in returned an invalid class lifecycle.'); })(),
    opensAt: requiredString(row.opens_at, 'opening time'),
  }));
}

export async function listFamilyCheckInStudents(gymId: number, classId: number): Promise<FamilyCheckInStudent[]> {
  requireEnabled();
  const { data, error } = await supabase.rpc('family_self_check_in_eligible_students', {
    p_gym_id: positiveInteger(gymId, 'gym ID'), p_class_id: positiveInteger(classId, 'class ID'),
  });
  checkRpcError('Loading eligible family members', error);
  return rows(data, 'Loading eligible family members').map((row) => ({
    studentId: positiveInteger(row.student_id, 'student ID'), gymId: positiveInteger(row.gym_id, 'gym ID'),
    firstName: requiredString(row.first_name, 'first name'), lastName: nullableString(row.last_name, 'last name'),
    membershipStatus: nullableString(row.membership_status, 'membership status'),
    programs: Array.isArray(row.programs) && row.programs.every((program) => typeof program === 'string') ? row.programs : [],
    eligibility: row.eligibility === 'eligible' || row.eligibility === 'already_requested' || row.eligibility === 'already_checked_in' || row.eligibility === 'ineligible'
      ? row.eligibility
      : (() => { throw new FamilySelfCheckInContractError('Family self-check-in returned an invalid eligibility result.'); })(),
    reason: nullableString(row.reason, 'eligibility reason'),
  }));
}

export async function submitFamilyCheckInRequest(gymId: number, classId: number, selectedStudentIds: readonly number[], requestKey: string): Promise<FamilyCheckInRequestOutcome[]> {
  requireEnabled();
  const { data, error } = await supabase.rpc('family_self_check_in_request', {
    p_gym_id: positiveInteger(gymId, 'gym ID'), p_class_id: positiveInteger(classId, 'class ID'),
    p_student_ids: studentIds(selectedStudentIds), p_request_key: requiredString(requestKey, 'request key'),
  });
  checkRpcError('Requesting family check-in', error);
  return rows(data, 'Requesting family check-in').map((row) => ({
    studentId: positiveInteger(row.student_id, 'student ID'),
    requestId: row.request_id === null || row.request_id === undefined ? null : positiveInteger(row.request_id, 'request ID'),
    state: requestState(row.state), reason: nullableString(row.reason, 'request reason'),
  }));
}

export async function listStaffCheckInRequests(classId: number): Promise<StaffCheckInRequest[]> {
  requireEnabled();
  const { data, error } = await supabase.rpc('staff_self_check_in_list_requests', { p_class_id: positiveInteger(classId, 'class ID') });
  checkRpcError('Loading family check-in requests', error);
  return rows(data, 'Loading family check-in requests').map((row) => ({
    requestId: positiveInteger(row.request_id, 'request ID'), studentId: positiveInteger(row.student_id, 'student ID'),
    firstName: requiredString(row.first_name, 'first name'), lastName: nullableString(row.last_name, 'last name'),
    membershipStatus: nullableString(row.membership_status, 'membership status'), requestedAt: requiredString(row.requested_at, 'request timestamp'),
    state: requestState(row.state), reason: nullableString(row.reason, 'request reason'),
  }));
}

export async function resolveStaffCheckInRequest(requestId: number, decision: 'approve' | 'decline', resolutionKey: string): Promise<FamilyCheckInRequestOutcome> {
  requireEnabled();
  const { data, error } = await supabase.rpc('staff_self_check_in_resolve_request', {
    p_request_id: positiveInteger(requestId, 'request ID'), p_decision: decision, p_resolution_key: requiredString(resolutionKey, 'resolution key'),
  });
  checkRpcError('Resolving family check-in request', error);
  const [result] = rows(data, 'Resolving family check-in request');
  if (!result) throw new FamilySelfCheckInContractError('Resolving family check-in request did not return a result.');
  return { studentId: positiveInteger(result.student_id, 'student ID'), requestId: result.request_id === null || result.request_id === undefined ? null : positiveInteger(result.request_id, 'request ID'), state: requestState(result.state), reason: nullableString(result.reason, 'request reason') };
}

export async function bulkApproveStaffCheckInRequests(classId: number, requestIds: readonly number[], resolutionKey: string): Promise<FamilyCheckInRequestOutcome[]> {
  requireEnabled();
  const normalizedRequestIds = [...new Set(requestIds.map((requestId) => positiveInteger(requestId, 'request ID')))].sort((first, second) => first - second);
  if (normalizedRequestIds.length === 0) throw new FamilySelfCheckInContractError('Select at least one pending request.');
  const { data, error } = await supabase.rpc('staff_self_check_in_bulk_approve', {
    p_class_id: positiveInteger(classId, 'class ID'), p_request_ids: normalizedRequestIds, p_resolution_key: requiredString(resolutionKey, 'resolution key'),
  });
  checkRpcError('Approving selected family check-in requests', error);
  return rows(data, 'Approving selected family check-in requests').map((row) => ({
    studentId: positiveInteger(row.student_id, 'student ID'), requestId: row.request_id === null || row.request_id === undefined ? null : positiveInteger(row.request_id, 'request ID'), state: requestState(row.state), reason: nullableString(row.reason, 'request reason'),
  }));
}
