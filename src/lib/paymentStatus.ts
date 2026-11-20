export function paymentStatusLabel(status: string, amount: number): string {
  if (status === 'not_required') return amount > 0 ? 'not collected online' : 'not required';
  return status.replace(/_/g, ' ');
}
