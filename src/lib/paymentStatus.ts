export function isFreeRegistration(status: string, amount: number): boolean {
  return status === 'not_required' && amount === 0;
}

export function paymentStatusLabel(status: string, amount: number): string {
  if (status === 'not_required') return amount > 0 ? 'not collected online' : 'not required';
  if (status === 'pending_verification') return 'pending verification';
  return status.replace(/_/g, ' ');
}
