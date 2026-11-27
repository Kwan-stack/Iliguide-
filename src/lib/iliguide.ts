import { supabase } from './supabase';
import { calculateBookingTotal, dateLabel, escapeCsvCell, isValidOptionalPhone, money, monthDateRange, timeLabel } from './formatHelpers';

export { calculateBookingTotal, dateLabel, escapeCsvCell, isValidOptionalPhone, money, monthDateRange, timeLabel };

export type Role = 'visitor' | 'gatekeeper' | 'site_admin' | 'tourism_office';
export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_path: string | null;
  role: Role;
  account_status: 'active' | 'pending' | 'disabled';
};
export type TravelerProfile = { id: string; full_name: string; email: string | null; phone: string | null };
export type StaffAssignment = {
  id: string;
  profile_id: string;
  site_id: string;
  staff_role: 'gatekeeper' | 'site_admin';
  is_active: boolean;
};
export type SiteImage = {
  id: string;
  storage_path: string;
  image_role: 'cover' | 'gallery';
  alt_text: string;
  sort_order: number;
  public_url: string;
};
export type Site = {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  status: 'draft' | 'published' | 'inactive' | 'temporarily_closed';
  management_organization_id?: string;
  adult_fee: number;
  child_fee: number;
  pwd_discount_percent: number;
  max_per_booking: number;
  daily_capacity: number | null;
  fee_information_confirmed: boolean;
  cancellation_cutoff_hours: number;
  images: SiteImage[];
  operating_hours: Array<{ weekday: number; opens_at: string | null; closes_at: string | null; is_closed: boolean }>;
  operating_exceptions: Array<{ exception_date: string; opens_at: string | null; closes_at: string | null; is_closed: boolean; reason: string }>;
  closures: Array<{ starts_on: string; ends_on: string; starts_at: string | null; ends_at: string | null; reason: string }>;
};
export type Slot = {
  slot_id: string;
  site_id: string;
  slot_date: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  remaining_capacity: number;
  status: 'open' | 'closed';
};
export type LiveOccupancy = {
  site_id: string;
  current_visitor_count: number;
  expected_visitor_count?: number;
  arrivals_today: number;
  departures_today: number;
  last_recorded_at: string | null;
  calculated_at: string;
  approved_visitor_limit: number | null;
  estimated_live_capacity?: number | null;
  estimate_basis?: string | null;
  capacity_estimate: number | null;
  near_threshold_percent?: number;
  almost_threshold_percent?: number;
  critical_threshold_percent?: number;
  restrict_at_warning?: boolean;
};
export type SiteCapacityForDate = LiveOccupancy & {
  visit_date: string;
  projected_visitor_count: number;
  reserved_visitor_count: number;
  remaining_bookable_capacity: number;
  max_slot_remaining: number;
  slot_capacity: number;
  updated_at: string | null;
};
export type GatekeeperDuty = {
  duty_id: string;
  duty_date: string;
  shift_start_at: string;
  shift_end_at: string;
  duty_role: 'primary' | 'support';
  primary_gatekeeper_name: string;
  effective_status: string;
};
export type Booking = {
  booking_id: string;
  booking_reference: string;
  visitor_name: string;
  visitor_email: string | null;
  visitor_phone: string | null;
  visitor_count: number;
  adult_count: number;
  child_count: number;
  pwd_count: number;
  total_amount: number;
  currency: string;
  payment_status: string;
  payment_method: 'online' | 'onsite';
  booking_status: string;
  booking_source: string;
  site_id: string;
  site_name: string;
  slot_date: string;
  starts_at: string;
  ends_at: string;
  cancellation_cutoff_at: string | null;
  hold_expires_at: string | null;
  created_at: string;
  manual_payment_id?: string | null;
  manual_payment_status?: string | null;
  manual_payment_mode?: string | null;
  payment_receipt_reference?: string | null;
};
export type CreatedHold = {
  booking_id: string;
  booking_reference: string;
  hold_expires_at: string;
  total_amount: number;
  guest_access_token: string | null;
};
export type Ticket = {
  token: string;
  booking: {
    booking_id: string;
    booking_reference: string;
    visitor_name: string;
    visitor_count: number;
    total_amount: number;
    currency: string;
    site_id: string;
    site_name: string;
    slot_date: string;
    starts_at: string;
    ends_at: string;
  };
};

export function db() {
  if (!supabase) throw new Error('Add the Supabase project URL and publishable key to .env.local.');
  return supabase;
}

export function pendingManualPaymentQuery(columns: string, siteId?: string, count = false) {
  let query = db().from('payments').select(columns, count ? { count: 'exact', head: true } : undefined)
    .eq('provider', 'manual').eq('payment_mode', 'demo').eq('payment_status', 'pending_verification')
    .not('proof_submitted_at', 'is', null).eq('booking.booking_status', 'awaiting_payment');
  if (siteId) query = query.eq('booking.site_id', siteId);
  return query;
}

export function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Something went wrong. Please try again.';
}

export function timestampTimeLabel(value: string, timeZone = 'Asia/Manila'): string {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-PH', { timeZone, hour: 'numeric', minute: '2-digit' }).format(timestamp);
}
export async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await db().from('profiles')
    .select('id, full_name, email, phone, avatar_path, role, account_status')
    .eq('id', userId).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function loadTravelerProfiles(userId: string): Promise<TravelerProfile[]> {
  const { data, error } = await db().from('traveler_profiles')
    .select('id, full_name, email, phone').eq('user_id', userId).order('created_at');
  if (error) throw error;
  return (data ?? []) as TravelerProfile[];
}

export async function loadAssignments(userId: string): Promise<StaffAssignment[]> {
  const { data, error } = await db().from('staff_assignments')
    .select('id, profile_id, site_id, staff_role, is_active')
    .eq('profile_id', userId).eq('is_active', true).order('created_at');
  if (error) throw error;
  return (data ?? []) as StaffAssignment[];
}

export async function loadSites(includeUnpublished = false): Promise<Site[]> {
  const selectSites = (includeManagementOrganizationId: boolean) => {
    let query = db().from('tourism_sites')
      .select(
        'id, name, slug, category, description, address, latitude, longitude, timezone, status,' +
        (includeManagementOrganizationId ? ' management_organization_id,' : '') +
        ' settings:site_settings(adult_fee, child_fee, pwd_discount_percent, max_per_booking, daily_capacity, fee_information_confirmed, cancellation_cutoff_hours),' +
        ' images:site_images(id, storage_path, image_role, alt_text, sort_order),' +
        ' operating_hours:site_operating_hours(weekday, opens_at, closes_at, is_closed),' +
        ' operating_exceptions:site_operating_exceptions(exception_date, opens_at, closes_at, is_closed, reason),' +
        ' closures:site_closures(starts_on, ends_on, starts_at, ends_at, reason)',
      )
      .order('name');
    if (!includeUnpublished) query = query.eq('status', 'published');
    return query;
  };

  let { data, error } = await selectSites(includeUnpublished);
  if (includeUnpublished && error &&
    ['PGRST204', '42703'].includes(error.code) &&
    error.message.includes('management_organization_id')) {
    ({ data, error } = await selectSites(false));
  }
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, any>>;
  if (!rows.length) return [];

  return rows.map((row) => {
    const settings = Array.isArray(row.settings) ? row.settings[0] : row.settings;
    const images = ((row.images ?? []) as Array<Record<string, any>>)
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
      .map((image) => ({
        id: image.id,
        storage_path: image.storage_path,
        image_role: image.image_role,
        alt_text: image.alt_text ?? '',
        sort_order: image.sort_order,
        public_url: db().storage.from('tourism-site-images').getPublicUrl(image.storage_path).data.publicUrl,
      }));
    return {
      ...row,
      adult_fee: Number(settings?.adult_fee ?? 0),
      child_fee: Number(settings?.child_fee ?? 0),
      pwd_discount_percent: Number(settings?.pwd_discount_percent ?? 0),
      max_per_booking: Number(settings?.max_per_booking ?? 20),
      daily_capacity: settings?.daily_capacity == null ? null : Number(settings.daily_capacity),
      fee_information_confirmed: Boolean(settings?.fee_information_confirmed),
      cancellation_cutoff_hours: Number(settings?.cancellation_cutoff_hours ?? 24),
      images,
      operating_hours: row.operating_hours ?? [],
      operating_exceptions: row.operating_exceptions ?? [],
      closures: row.closures ?? [],
    } as Site;
  });
}

export async function loadSlots(siteId: string, from: string, to: string): Promise<Slot[]> {
  const { data, error } = await db().rpc('get_slot_availability', {
    p_site_id: siteId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return (data ?? []) as Slot[];
}

export async function loadLiveOccupancy(siteId: string): Promise<LiveOccupancy | null> {
  let result = await db().rpc('site_capacity_snapshot', { p_site_id: siteId });
  if (result.error?.code === 'PGRST202') {
    result = await db().rpc('site_live_occupancy', { p_site_id: siteId });
  }
  const { data, error } = result;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    ...row,
    current_visitor_count: Number(row.current_visitor_count ?? 0),
    expected_visitor_count: Number(row.expected_visitor_count ?? 0),
    arrivals_today: Number(row.arrivals_today ?? 0),
    departures_today: Number(row.departures_today ?? 0),
    approved_visitor_limit: row.approved_visitor_limit == null ? null : Number(row.approved_visitor_limit),
    estimated_live_capacity: row.estimated_live_capacity == null ? null : Number(row.estimated_live_capacity),
    estimate_basis: row.estimate_basis == null ? null : String(row.estimate_basis),
    capacity_estimate: row.capacity_estimate == null ? null : Number(row.capacity_estimate),
    near_threshold_percent: Number(row.near_threshold_percent ?? 70),
    almost_threshold_percent: Number(row.almost_threshold_percent ?? 85),
    critical_threshold_percent: Number(row.critical_threshold_percent ?? 95),
    restrict_at_warning: Boolean(row.restrict_at_warning),
  } as LiveOccupancy;
}

export async function loadSiteCapacityForDate(siteId: string, date: string): Promise<SiteCapacityForDate | null> {
  const { data, error } = await db().rpc('site_capacity_for_date', { p_site_id: siteId, p_visit_date: date });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    ...row,
    visit_date: String(row.visit_date),
    current_visitor_count: Number(row.current_visitor_count ?? 0),
    projected_visitor_count: Number(row.projected_visitor_count ?? 0),
    reserved_visitor_count: Number(row.reserved_visitor_count ?? 0),
    remaining_bookable_capacity: Number(row.remaining_bookable_capacity ?? 0),
    max_slot_remaining: Number(row.max_slot_remaining ?? 0),
    slot_capacity: Number(row.slot_capacity ?? 0),
    arrivals_today: Number(row.arrivals_today ?? 0),
    departures_today: Number(row.departures_today ?? 0),
    approved_visitor_limit: row.approved_visitor_limit == null ? null : Number(row.approved_visitor_limit),
    estimated_live_capacity: row.estimated_live_capacity == null ? null : Number(row.estimated_live_capacity),
    capacity_estimate: row.capacity_estimate == null ? null : Number(row.capacity_estimate),
    near_threshold_percent: Number(row.near_threshold_percent ?? 70),
    almost_threshold_percent: Number(row.almost_threshold_percent ?? 85),
    critical_threshold_percent: Number(row.critical_threshold_percent ?? 95),
    restrict_at_warning: Boolean(row.restrict_at_warning),
    updated_at: row.updated_at == null ? null : String(row.updated_at),
  } as SiteCapacityForDate;
}

export async function loadMyActiveGatekeeperDuty(siteId: string): Promise<GatekeeperDuty | null> {
  const { data, error } = await db().rpc('my_active_gatekeeper_duty', { p_site_id: siteId });
  if (error) throw error;
  return ((Array.isArray(data) ? data[0] : data) ?? null) as GatekeeperDuty | null;
}

export async function lookupBooking(reference: string, guestAccessToken?: string | null): Promise<Booking | null> {
  const { data, error } = await db().rpc('lookup_booking', {
    p_booking_reference: reference.trim(),
    p_guest_access_token: guestAccessToken ?? null,
  });
  if (error) throw error;
  return ((data ?? []) as Booking[])[0] ?? null;
}

export async function loadOwnBookings(): Promise<Booking[]> {
  const { data, error } = await db().from('bookings')
    .select(
      'id, booking_reference, visitor_name, visitor_email, visitor_phone, visitor_count,' +
      ' adult_count, child_count, pwd_count, total_amount, currency, payment_status, payment_method, booking_status,' +
      ' booking_source, site_id, cancellation_cutoff_at, hold_expires_at, created_at,' +
      ' tourism_sites(name), site_slots(slot_date, starts_at, ends_at), payments!payments_booking_id_fkey(id,provider,payment_mode,payment_status,payment_deadline,receipt_reference,verified_at,amount,payment_application)',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => {
    const manualPayment = (row.payments ?? []).find((payment: Record<string, string>) => payment.provider === 'manual');
    const paidPayment = (row.payments ?? []).find((payment: Record<string, string>) => payment.payment_status === 'paid');
    return ({
    booking_id: row.id,
    booking_reference: row.booking_reference,
    visitor_name: row.visitor_name,
    visitor_email: row.visitor_email,
    visitor_phone: row.visitor_phone,
    visitor_count: row.visitor_count,
    adult_count: row.adult_count,
    child_count: row.child_count,
    pwd_count: row.pwd_count,
    total_amount: Number(row.total_amount),
    currency: row.currency,
    payment_status: row.payment_status,
    payment_method: row.payment_method,
    booking_status: row.booking_status,
    booking_source: row.booking_source,
    site_id: row.site_id,
    site_name: row.tourism_sites?.name ?? 'Destination',
    slot_date: row.site_slots?.slot_date,
    starts_at: row.site_slots?.starts_at,
    ends_at: row.site_slots?.ends_at,
    cancellation_cutoff_at: row.cancellation_cutoff_at,
    hold_expires_at: row.hold_expires_at,
    created_at: row.created_at,
    manual_payment_id: manualPayment?.id ?? null,
    manual_payment_status: manualPayment?.payment_status ?? null,
    manual_payment_mode: (row.payments ?? []).find((payment: Record<string, string>) => payment.payment_mode === 'demo')?.payment_mode ?? null,
    payment_receipt_reference: paidPayment?.receipt_reference ?? null,
  });
  }) as Booking[];
}

export async function createHold(input: {
  slotId: string;
  name: string;
  adults: number;
  children: number;
  pwdCount: number;
  email: string;
  phone: string;
  visitors: Array<Record<string, string>>;
}): Promise<CreatedHold> {
  const { data, error } = await db().rpc('create_booking_hold', {
    p_slot_id: input.slotId,
    p_name: input.name,
    p_adult_count: input.adults,
    p_child_count: input.children,
    p_pwd_count: input.pwdCount,
    p_email: input.email || null,
    p_phone: input.phone || null,
    p_visitors: input.visitors,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('The booking hold could not be created.');
  return row as CreatedHold;
}

export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke(name, { body });
  if (error) {
    const context = (error as Error & { context?: Response }).context;
    if (context) {
      const payload = await context.clone().json().catch(() => null);
      if (payload?.error) throw new Error(String(payload.error));
    }
    throw error;
  }
  return data as T;
}

export async function issueTicket(reference: string, guestAccessToken?: string | null): Promise<Ticket> {
  return invokeFunction<Ticket>('ticket', {
    booking_reference: reference,
    guest_access_token: guestAccessToken ?? null,
  });
}

export async function exportCsv(filename: string, rows: Array<Record<string, unknown>>): Promise<void> {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const content = [
    keys.map(escapeCsvCell).join(','),
    ...rows.map((row) => keys.map((key) => escapeCsvCell(row[key])).join(',')),
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
