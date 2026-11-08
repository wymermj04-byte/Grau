export const newPaymentMethods = ["Cash", "Check", "Cash App"] as const;

export type NewPaymentMethod = (typeof newPaymentMethods)[number];

export function isNewPaymentMethod(value: string): value is NewPaymentMethod {
  return newPaymentMethods.includes(value as NewPaymentMethod);
}
