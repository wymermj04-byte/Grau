type AttendanceIdentity = {
  class_id?: unknown;
  student_id?: unknown;
};

function normalizeId(value: unknown): number | null {
  const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : null;
}

export function isPostgresUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export function includesClassStudentAttendance(records: AttendanceIdentity[], classId: number | string, studentId: number | string) {
  const expectedClassId = normalizeId(classId);
  const expectedStudentId = normalizeId(studentId);
  if (expectedClassId === null || expectedStudentId === null) return false;
  return records.some((record) => normalizeId(record.class_id) === expectedClassId && normalizeId(record.student_id) === expectedStudentId);
}

export async function confirmExistingClassCheckIn(
  readAttendance: () => Promise<AttendanceIdentity[]>,
  classId: number | string,
  studentId: number | string,
) {
  try {
    return includesClassStudentAttendance(await readAttendance(), classId, studentId);
  } catch {
    return false;
  }
}
