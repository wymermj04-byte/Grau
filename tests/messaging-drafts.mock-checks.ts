import { canSendPersistedMessagingDraft, createMessagingDraftStore, createMessagingSendLock, isCurrentMessagingScope, messagingDraftScopeKey, type MessagingDraftStorage } from '../lib/messaging-drafts';

type PendingOperation = { resolve: () => void; reject: (error: Error) => void };

class MockStorage implements MessagingDraftStorage {
  readonly values = new Map<string, string>();
  failNextWrite = false;
  readonly pendingWrites: PendingOperation[] = [];
  delayWrites = false;

  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error('storage unavailable'); }
    if (this.delayWrites) await new Promise<void>((resolve, reject) => this.pendingWrites.push({ resolve, reject }));
    this.values.set(key, value);
  }
  async removeItem(key: string) { this.values.delete(key); }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Messaging draft mock check failed: ${message}`);
}

async function waitForPendingWrite(storage: MockStorage) {
  for (let turn = 0; turn < 20; turn += 1) {
    if (storage.pendingWrites.length > 0) return;
    await Promise.resolve();
  }
  assert(false, 'an expected mocked storage write was never scheduled');
}

const familyScope = { userId: 'family-user', role: 'family' as const, gymId: 4, conversationId: 1 };
const otherFamilyScope = { userId: 'other-user', role: 'family' as const, gymId: 4, conversationId: 1 };
const staffScope = { userId: 'staff-user', role: 'staff' as const, gymId: 4, conversationId: 1 };

class MockMessagingRequest {
  calls = 0;
  async send() { this.calls += 1; }
}

async function run() {
  const storage = new MockStorage();
  const drafts = createMessagingDraftStore(storage);

  // App restart: the exact secure retry identity is recovered for the same scope.
  await drafts.save(familyScope, { draftBody: 'Need help', retryKey: '11111111-1111-4111-8111-111111111111', pendingAttempt: null });
  const restarted = createMessagingDraftStore(storage);
  const restored = await restarted.load(familyScope);
  assert(restored?.retryKey === '11111111-1111-4111-8111-111111111111', 'restart retains the original retry UUID');

  // Exact account, role, gym, and conversation values isolate every stored key.
  assert(messagingDraftScopeKey(familyScope) !== messagingDraftScopeKey(otherFamilyScope), 'different accounts cannot share drafts');
  assert(messagingDraftScopeKey(familyScope) !== messagingDraftScopeKey(staffScope), 'family and staff drafts cannot share drafts');
  assert(await drafts.load(otherFamilyScope) === null && await drafts.load(staffScope) === null, 'scope switching cannot read another saved draft');

  // Storage failure rejects the pre-send save rather than reporting a usable persisted attempt.
  storage.failNextWrite = true;
  let failedClosed = false;
  try { await drafts.save(familyScope, { draftBody: 'Must not send', retryKey: '22222222-2222-4222-8222-222222222222', pendingAttempt: null }); } catch { failedClosed = true; }
  assert(failedClosed, 'storage failures reject the pre-send persistence step');

  // Ordered writes: an older delayed update cannot land after a later update for the same scope.
  storage.delayWrites = true;
  const first = drafts.save(familyScope, { draftBody: 'first', retryKey: null, pendingAttempt: null });
  const second = drafts.save(familyScope, { draftBody: 'second', retryKey: null, pendingAttempt: null });
  await waitForPendingWrite(storage);
  assert(storage.pendingWrites.length === 1, 'same-scope writes are serialized');
  storage.pendingWrites.shift()?.resolve();
  await waitForPendingWrite(storage);
  assert(storage.pendingWrites.length === 1, 'later write waits for the earlier write');
  storage.pendingWrites.shift()?.resolve();
  await Promise.all([first, second]);
  storage.delayWrites = false;
  assert((await drafts.load(familyScope))?.draftBody === 'second', 'latest saved draft wins after ordered writes');

  // Unknown results and confirmed-send cleanup failures are represented separately from a new draft.
  await drafts.save(familyScope, {
    draftBody: 'new text', retryKey: null,
    pendingAttempt: { body: 'original text', retryKey: '33333333-3333-4333-8333-333333333333', status: 'unknown' },
  });
  const unresolved = await drafts.load(familyScope);
  assert(unresolved?.pendingAttempt?.retryKey === '33333333-3333-4333-8333-333333333333', 'editing preserves an unresolved retry separately');
  await drafts.save(familyScope, {
    draftBody: '', retryKey: null,
    pendingAttempt: { body: 'confirmed text', retryKey: '44444444-4444-4444-8444-444444444444', status: 'sent_cleanup_required' },
  });
  const cleanupBlocked = await drafts.load(familyScope);
  assert(cleanupBlocked?.pendingAttempt?.status === 'sent_cleanup_required', 'cleanup failure remains blocked and recoverable');
  assert(cleanupBlocked !== null && !canSendPersistedMessagingDraft(cleanupBlocked), 'a cleanup failure cannot issue another request');

  // Mocked authentication snapshots reject account, role, and gym switches before a request.
  assert(isCurrentMessagingScope(familyScope, { userId: 'family-user', role: 'family', staffGymId: null, familyGymIds: [4] }), 'matching family access is accepted');
  assert(!isCurrentMessagingScope(familyScope, { userId: 'other-user', role: 'family', staffGymId: null, familyGymIds: [4] }), 'account changes reject sends');
  assert(!isCurrentMessagingScope(familyScope, { userId: 'family-user', role: 'family', staffGymId: null, familyGymIds: [5] }), 'gym changes reject sends');
  assert(!isCurrentMessagingScope(familyScope, { userId: 'family-user', role: 'staff', staffGymId: 4, familyGymIds: [] }), 'role changes reject sends');

  // A mocked request can acquire only one synchronous send permit despite rapid taps.
  const sendLock = createMessagingSendLock();
  const messaging = new MockMessagingRequest();
  if (sendLock.tryAcquire()) void messaging.send();
  if (sendLock.tryAcquire()) void messaging.send();
  await Promise.resolve();
  assert(messaging.calls === 1, 'rapid send attempts issue only one request');
  sendLock.release();
}

void run().then(() => {
  // eslint-disable-next-line no-console
  console.log('PASS: messaging draft mock checks');
});
