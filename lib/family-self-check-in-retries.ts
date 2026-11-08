import AsyncStorage from '@react-native-async-storage/async-storage';
import { createFamilyCheckInIdempotencyKey, FamilySelfCheckInContractError } from '@/lib/family-self-check-in';
import { isSelfCheckInEnabled } from '@/lib/self-check-in-feature';
import { supabase } from '@/lib/supabase';

type RetryIntent = {
  operation: 'family-request' | 'staff-resolution' | 'staff-bulk-approval';
  gymId: number;
  classId: number;
  subjectIds: readonly number[];
  decision?: 'approve' | 'decline';
};

const STORAGE_PREFIX = 'grau.family-self-check-in.retry.v1:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positive(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizedSubjectIds(subjectIds: readonly number[]) {
  const normalized = [...new Set(subjectIds)];
  if (normalized.length === 0 || normalized.some((value) => !positive(value))) {
    throw new FamilySelfCheckInContractError('Family self-check-in retry details are invalid.');
  }
  return normalized.sort((first, second) => first - second);
}

function fingerprint(intent: RetryIntent) {
  if (!positive(intent.gymId) || !positive(intent.classId)) {
    throw new FamilySelfCheckInContractError('Family self-check-in retry details are invalid.');
  }
  if (intent.operation === 'staff-resolution' && intent.decision !== 'approve' && intent.decision !== 'decline') {
    throw new FamilySelfCheckInContractError('Family self-check-in resolution details are invalid.');
  }
  return [intent.operation, intent.gymId, intent.classId, intent.decision ?? '', normalizedSubjectIds(intent.subjectIds).join(',')].join(':');
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) throw new FamilySelfCheckInContractError('Your signed-in account could not be verified for a safe retry.');
  return data.user.id;
}

async function storageKey(intent: RetryIntent) {
  if (!isSelfCheckInEnabled()) throw new FamilySelfCheckInContractError('Family self-check-in is not enabled for this academy yet.');
  return `${STORAGE_PREFIX}${await currentUserId()}:${fingerprint(intent)}`;
}

/**
 * Saves a retry key before the RPC begins. The same authenticated account and
 * exact operation payload reuse it after an interrupted or failed attempt.
 */
export async function getFamilySelfCheckInRetryKey(intent: RetryIntent) {
  const key = await storageKey(intent);
  const saved = await AsyncStorage.getItem(key);
  if (saved && UUID_PATTERN.test(saved)) return saved;
  const retryKey = createFamilyCheckInIdempotencyKey();
  await AsyncStorage.setItem(key, retryKey);
  return retryKey;
}

/** Removes a key only after the server returned a complete, valid outcome. */
export async function clearFamilySelfCheckInRetryKey(intent: RetryIntent) {
  await AsyncStorage.removeItem(await storageKey(intent));
}
