import type { Href } from 'expo-router';

export const MEMBERS_LIST_PATH = '/members' as const;

export function memberProfilePath(studentId: string | number | undefined): Href {
  const normalizedId = String(studentId ?? '').trim();
  return normalizedId ? (`/members/${encodeURIComponent(normalizedId)}` as Href) : MEMBERS_LIST_PATH;
}
