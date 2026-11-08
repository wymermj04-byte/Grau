import { isStripeProgressSchemaAbsent, mayUseLegacyPromotionWorkflow } from '../lib/promotion-fallback';

function queryError(message: string, code?: string) {
  const error = new Error(message) as Error & { name: string; code?: string };
  error.name = 'DatabaseQueryError';
  error.code = code;
  return error;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Promotion fallback mock check failed: ${message}`);
}

assert(isStripeProgressSchemaAbsent(queryError('any server wording', '42P01')), 'the explicit baseline-table probe recognizes PostgreSQL missing-table capability');
assert(isStripeProgressSchemaAbsent(queryError('any server wording', 'PGRST205')), 'the explicit baseline-table probe recognizes PostgREST missing-table capability');
assert(mayUseLegacyPromotionWorkflow('absent'), 'migration absent allows the established legacy workflow');
assert(!mayUseLegacyPromotionWorkflow('available'), 'new schema present with a missing RPC is blocked from legacy writes');
assert(!isStripeProgressSchemaAbsent(queryError('permission denied', '42501')), 'permission errors never authorize legacy writes');
assert(!isStripeProgressSchemaAbsent(queryError('network request failed')), 'network failures never authorize legacy writes');
assert(!isStripeProgressSchemaAbsent(queryError('validation failure', '23514')), 'validation failures never authorize legacy writes');
assert(!isStripeProgressSchemaAbsent(queryError('internal RPC failure', 'P0001')), 'internal RPC failures never authorize legacy writes');

// eslint-disable-next-line no-console
console.log('PASS: promotion fallback mock checks');
