import { database } from '@/lib/database';

export type Student = {
  studentId: number;
  gym_id?: number | null;
  first_name: string;
  last_name: string | null;
  belt_rank: string;
  stripes: number;
  membership_status: string;
  waiver_signed: boolean;
  photo_url: string | null;
  programs: string[];
  promotion_track?: 'kids' | 'adults' | null;
};

export type MemberProgram = 'kids' | 'adults';
export type MemberStatusFilter = 'All' | 'Active' | 'Leads';
export type MemberProgramFilter = 'All' | 'Kids' | 'Adults';

export function formatMemberProgram(program: string) {
  const normalizedProgram = program.trim().toLowerCase();
  if (normalizedProgram === 'kids') return 'Kids';
  if (normalizedProgram === 'adults') return 'Adults';
  return program;
}

export function fullName(student: Student) {
  return [student.first_name, student.last_name].filter(Boolean).join(' ');
}

export function studentInitials(student: Student) {
  return [student.first_name, student.last_name].filter((name): name is string => Boolean(name)).map((name) => name[0]).join('').slice(0, 2).toUpperCase();
}

export function isActiveStudent(student: Student) {
  return student.membership_status.trim().toLowerCase() === 'active';
}

export function hasProgram(student: Student, program: MemberProgram) {
  return Array.isArray(student.programs) && student.programs.some((value) => value.toLowerCase() === program);
}

export function filterStudents(
  students: Student[],
  query: string,
  statusFilter: MemberStatusFilter,
  programFilter: MemberProgramFilter,
) {
  const normalizedQuery = query.trim().toLowerCase();
  return students.filter((student) => {
    const matchesSearch = fullName(student).toLowerCase().includes(normalizedQuery);
    const matchesStatus = statusFilter === 'All'
      || (statusFilter === 'Active' ? isActiveStudent(student) : !isActiveStudent(student));
    const matchesProgram = programFilter === 'All'
      || hasProgram(student, programFilter.toLowerCase() as MemberProgram);
    return matchesSearch && matchesStatus && matchesProgram;
  });
}

export async function loadStudents(): Promise<Student[]> {
  return database.listStudents<Student>();
}
