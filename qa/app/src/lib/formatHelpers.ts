export function money(value: number | string | null | undefined): string {
  const numeric = Number(value ?? 0);
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

export function calculateBookingTotal(
  adultFee: number,
  childFee: number,
  pwdDiscountPercent: number,
  adults: number,
  children: number,
  pwd: number,
): number {
  const safeAdultFee = Number.isFinite(adultFee) ? Math.max(0, adultFee) : 0;
  const safeChildFee = Number.isFinite(childFee) ? Math.max(0, childFee) : 0;
  const safeDiscount = Number.isFinite(pwdDiscountPercent) ? Math.max(0, Math.min(100, pwdDiscountPercent)) : 0;
  const safeAdults = Number.isFinite(adults) ? Math.max(0, adults) : 0;
  const safeChildren = Number.isFinite(children) ? Math.max(0, children) : 0;
  const safePwd = Number.isFinite(pwd) ? Math.max(0, Math.min(safeAdults + safeChildren, pwd)) : 0;
  const raw = safeAdultFee * safeAdults + safeChildFee * safeChildren - safeAdultFee * (safeDiscount / 100) * safePwd;
  return Math.max(0, Math.round(raw * 100) / 100);
}

export function dateLabel(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '—';
  const parsed = new Date(value + 'T12:00:00');
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

export function timeLabel(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') return '—';
  const parts = value.split(':');
  if (parts.length < 2) return '—';
  const hour = Number(parts[0]);
  const minute = Number(parts[1]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return '—';
  }
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' })
    .format(new Date(2000, 0, 1, hour, minute));
}

export function escapeCsvCell(value: unknown): string {
  const raw = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function monthDateRange(month: string): { start: string; end: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) return null;
  const endDate = new Date(Date.UTC(year, monthNumber, 0));
  if (Number.isNaN(endDate.getTime())) return null;
  return {
    start: `${match[1]}-${match[2]}-01`,
    end: endDate.toISOString().slice(0, 10),
  };
}

export function isValidOptionalPhone(phone: string): boolean {
  const trimmed = phone.trim();
  if (!trimmed) return true;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}
