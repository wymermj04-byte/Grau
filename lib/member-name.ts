/** Trims user-entered names without restricting letters, accents, spaces, apostrophes, or hyphens. */
export function normalizeMemberName(value: string) {
  return value.trim();
}

export function hasRequiredFirstName(value: string) {
  return normalizeMemberName(value).length > 0;
}
