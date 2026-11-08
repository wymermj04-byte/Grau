/**
 * The printed QR destination is deliberately academy-scoped, not class-scoped.
 * Keep this URL stable: replacing a printed QR code requires a product decision.
 */
const GRAU_PUBLISHED_HOST = 'https://1759878ef3.draftbit.dev';

export const reusableCheckInAcademyId = 4;

export function academyCheckInUrl(gymId: number) {
  if (gymId !== reusableCheckInAcademyId) {
    throw new Error('A reusable family check-in QR code is not configured for this academy.');
  }

  return `${GRAU_PUBLISHED_HOST}/check-in/${gymId}`;
}

export function isReusableCheckInAcademy(gymId: number | null) {
  return gymId === reusableCheckInAcademyId;
}
