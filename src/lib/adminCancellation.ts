export const ADMIN_CANCELLATION_CATEGORIES = [
  'Weather Condition',
  'Safety Advisory',
  'Site Maintenance',
  'Capacity Override',
  'Other',
] as const;

export type AdminCancellationCategory = (typeof ADMIN_CANCELLATION_CATEGORIES)[number];

export interface CancellableBookingLike {
  booking_status?: string | null;
  cancellation_category?: string | null;
  cancellation_reason?: string | null;
  cancelled_by?: string | null;
  cancelled_at?: string | null;
}

export function isValidAdminCancellationCategory(value: string): value is AdminCancellationCategory {
  return (ADMIN_CANCELLATION_CATEGORIES as readonly string[]).includes(value);
}

export function validateAdminCancellationInput(
  category: string,
  reason: string,
): string | null {
  if (!isValidAdminCancellationCategory(category)) {
    return 'Select a valid cancellation reason category.';
  }
  const trimmed = reason.trim();
  if (trimmed.length > 1000) {
    return 'Custom message must be 1,000 characters or fewer.';
  }
  return null;
}

export function canAdminCancelBooking(booking: CancellableBookingLike | null | undefined): boolean {
  if (!booking) return false;
  return booking.booking_status === 'confirmed' || booking.booking_status === 'awaiting_payment';
}

export function isAdminCancelledBooking(booking: CancellableBookingLike | null | undefined): boolean {
  if (!booking || booking.booking_status !== 'cancelled') return false;
  return Boolean(
    booking.cancellation_category
    || booking.cancelled_by
    || booking.cancelled_at
    || booking.cancellation_reason,
  );
}

export function formatCancellationDetail(
  category: string | null | undefined,
  reason: string | null | undefined,
): string {
  const cleanCategory = (category ?? '').trim();
  const cleanReason = (reason ?? '').trim();
  if (cleanCategory && cleanReason) return `${cleanCategory} — ${cleanReason}`;
  return cleanCategory || cleanReason || 'Cancelled by City Tourism Office';
}

export const QR_SAME_TOKEN_COOLDOWN_MS = 3500;
export const QR_ANY_SCAN_COOLDOWN_MS = 1800;

export function isScanWithinCooldown(
  lastToken: string,
  lastScanAtMs: number,
  nextToken: string,
  nowMs: number,
  sameTokenCooldownMs = QR_SAME_TOKEN_COOLDOWN_MS,
  anyScanCooldownMs = QR_ANY_SCAN_COOLDOWN_MS,
): boolean {
  if (!lastScanAtMs || nowMs < lastScanAtMs) return false;
  const elapsed = nowMs - lastScanAtMs;
  if (elapsed < anyScanCooldownMs) return true;
  if (lastToken && nextToken === lastToken && elapsed < sameTokenCooldownMs) return true;
  return false;
}
