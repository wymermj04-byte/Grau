type SchemaCapabilityError = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
};

/**
 * The capability probe targets the dedicated baseline table introduced by the
 * stripe migration. Only a database-declared missing-table code establishes
 * that the migration is absent; message text never authorizes a legacy write.
 */
export function isStripeProgressSchemaAbsent(error: unknown) {
  if (!(error instanceof Error) || error.name !== 'DatabaseQueryError') return false;
  const queryError = error as SchemaCapabilityError;
  const code = typeof queryError.code === 'string' ? queryError.code : '';
  return code === '42P01' || code === 'PGRST205';
}

export function mayUseLegacyPromotionWorkflow(schemaCapability: 'available' | 'absent') {
  return schemaCapability === 'absent';
}
