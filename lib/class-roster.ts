import type { MemberProgram, Student } from '@/lib/students';

export type ClassAudience = MemberProgram | 'mixed' | null;

export function normalizeClassAudience(value: unknown): ClassAudience {
  if (typeof value !== 'string') return null;
  const audience = value.trim().toLowerCase();
  return audience === 'kids' || audience === 'adults' || audience === 'mixed' ? audience : null;
}

function normalizeStudentId(value: unknown): number | null {
  const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : null;
}

export function studentHasSavedCheckIn(student: Student, checkedIn: Set<number>) {
  const studentId = normalizeStudentId(student.studentId);
  return studentId !== null && checkedIn.has(studentId);
}

function studentIsEligibleForAudience(student: Student, audience: ClassAudience) {
  if (audience === null) return true;
  const hasProgram = (program: MemberProgram) => Array.isArray(student.programs)
    && student.programs.some(
      (value) => typeof value === 'string' && value.trim().toLowerCase() === program,
    );
  return audience === 'mixed' ? hasProgram('kids') || hasProgram('adults') : hasProgram(audience);
}

export function filterInProgressClassRoster(students: Student[], classAudience: unknown, checkedIn: Set<number>) {
  const audience = normalizeClassAudience(classAudience);
  return students.filter(
    (student) => studentHasSavedCheckIn(student, checkedIn) || studentIsEligibleForAudience(student, audience),
  );
}

export function filterCompletedClassRoster(students: Student[], checkedIn: Set<number>) {
  return students.filter((student) => studentHasSavedCheckIn(student, checkedIn));
}
