import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CalendarClock, CalendarDays, Check, UserRound, X } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { db, timeLabel, type Site, type StaffAssignment } from '../lib/iliguide';
import { dutyWindowStatus } from '../lib/dutyStatus';
import { useSilentLoad } from '../lib/useSilentLoad';

type Props = {
  sites: Site[];
  siteId: string;
  setSiteId: (value: string) => void;
  assignments: StaffAssignment[];
  notify: (message: string) => void;
  user: User | null;
};
type ProfileName = { full_name: string; account_status?: string; role?: string };
type GatekeeperOption = { profile_id: string; profiles: ProfileName | ProfileName[] | null };
type DutyRow = {
  id: string;
  duty_date: string;
  shift_start_at: string;
  shift_end_at: string;
  status: string;
  primary_gatekeeper_id: string;
  primary: ProfileName | ProfileName[] | null;
  supports: Array<{ gatekeeper_id: string; gatekeeper: ProfileName | ProfileName[] | null }>;
};

const phToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dutyMonthStart = (date: string) => date.slice(0, 7) + '-01';
const addDutyDays = (date: string, days: number) => {
  const value = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(value.getTime())) return '';
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const dutyMonthEnd = (month: string) => {
  const [year, monthNumber] = month.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
};
const shiftDutyMonth = (month: string, delta: number) => {
  const [year, monthNumber] = month.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7) + '-01';
};
const dutyMonthLabel = (month: string) => new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + 'T00:00:00Z'));
const dutyDateWeekday = (date: string) => new Date(date + 'T00:00:00Z').getUTCDay();
const dutyDateLabel = (date: string) => new Intl.DateTimeFormat('en-PH', { dateStyle: 'full', timeZone: 'Asia/Manila' }).format(new Date(date + 'T00:00:00+08:00'));
const profileName = (profile: ProfileName | ProfileName[] | null) => (Array.isArray(profile) ? profile[0] : profile)?.full_name ?? 'Gatekeeper';
const dutyErrorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message
  : typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : fallback;
const dutySelect = 'id,duty_date,shift_start_at,shift_end_at,status,primary_gatekeeper_id,primary:profiles!site_gatekeeper_duties_primary_gatekeeper_id_fkey(full_name),supports:site_gatekeeper_duty_support!site_gatekeeper_duty_support_duty_id_fkey(gatekeeper_id,gatekeeper:profiles!site_gatekeeper_duty_support_gatekeeper_id_fkey(full_name))';

function DutyMonthCalendar(props: { month: string; selectedDate: string; duties: DutyRow[]; onSelect: (date: string) => void; onMonthChange: (delta: number) => void }) {
  const [year, monthNumber] = props.month.slice(0, 7).split('-').map(Number);
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const dates: Array<string | null> = [...Array(firstWeekday).fill(null), ...Array.from({ length: dayCount }, (_, index) => {
    return year + '-' + String(monthNumber).padStart(2, '0') + '-' + String(index + 1).padStart(2, '0');
  })];
  return <section className="duty-calendar-card">
    <header className="duty-calendar-month"><button type="button" className="btn btn-outline" aria-label="Previous month" onClick={() => props.onMonthChange(-1)}><ArrowLeft size={16}/></button><h2>{dutyMonthLabel(props.month)}</h2><button type="button" className="btn btn-outline" aria-label="Next month" onClick={() => props.onMonthChange(1)}><ArrowRight size={16}/></button></header>
    <div className="duty-calendar-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div>
    <div className="duty-calendar-grid">{dates.map((date, index) => {
      if (!date) return <span className="duty-calendar-spacer" key={'empty-' + index} aria-hidden="true"/>;
      const assigned = props.duties.filter((duty) => duty.duty_date === date);
      const primaryNames = assigned.map((duty) => profileName(duty.primary));
      const supportNames = assigned.flatMap((duty) => duty.supports.map((support) => profileName(support.gatekeeper)));
      const names = [...new Set([...primaryNames, ...supportNames])];
      return <button type="button" key={date} className={'duty-calendar-day' + (date === props.selectedDate ? ' selected' : '') + (assigned.length ? ' assigned' : '') + (date === phToday() ? ' today' : '')}
        aria-pressed={date === props.selectedDate} aria-label={dutyDateLabel(date) + (names.length ? ', assigned: ' + names.join(', ') : ', unassigned')} onClick={() => props.onSelect(date)}>
        <span className="duty-calendar-day-number">{Number(date.slice(-2))}</span>
        {assigned.length ? <span className="duty-calendar-day-assignments">{assigned.map((duty) => <span key={duty.id}><b>{profileName(duty.primary)}</b>{duty.supports.map((support) => <small key={support.gatekeeper_id}>+ {profileName(support.gatekeeper)}</small>)}</span>)}</span> : <small className="duty-calendar-unassigned">Unassigned</small>}
      </button>;
    })}</div>
    <div className="duty-calendar-legend"><span><i className="selected"/>Selected date</span><span><i className="assigned"/>Assigned</span><span><i/>Unassigned</span></div>
  </section>;
}

export function DutyRosterPage(props: Props & { embedded?: boolean }) {
  const site = props.sites.find((item) => item.id === props.siteId);
  return <section className={props.embedded ? 'duty-roster-embedded' : 'dashboard-page section-wrap'}>{!props.embedded && <div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> OPERATIONS · DUTY ROSTER</span><h1>Gatekeeper Duty <em>Calendar.</em></h1><p>Assign gatekeepers by day. Destination operating hours set the duty period.</p></div><label className="staff-site-picker">Destination<select aria-label="Destination" value={props.siteId} onChange={(event) => props.setSiteId(event.target.value)}>{props.sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>}
    {site ? <DutyRosterPanel {...props} site={site}/> : <div className="empty-card"><CalendarClock size={28}/><h3>No destination available</h3><p>Assign this account to a destination before managing its duty roster.</p></div>}
  </section>;
}

function DutyRosterPanel(props: Props & { site: Site }) {
  const [gatekeepers, setGatekeepers] = useState<GatekeeperOption[]>([]);
  const [duties, setDuties] = useState<DutyRow[]>([]);
  const [weeklyHours, setWeeklyHours] = useState<Array<{ weekday: number; opens_at: string | null; closes_at: string | null; is_closed: boolean }>>([]);
  const [specialHours, setSpecialHours] = useState<Array<{ exception_date: string; opens_at: string | null; closes_at: string | null; is_closed: boolean; reason: string }>>([]);
  const [closures, setClosures] = useState<Array<{ starts_on: string; ends_on: string; starts_at: string | null; ends_at: string | null; reason: string }>>([]);
  const [month, setMonth] = useState(() => dutyMonthStart(phToday()));
  const [selectedDate, setSelectedDate] = useState(phToday());
  const [form, setForm] = useState({ primary: '', supports: [] as string[] });
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [repeatForm, setRepeatForm] = useState({ from: '', through: '', weekdays: [] as number[] });
  const [loading, finishLoading] = useSilentLoad((props.user?.id ?? 'staff') + ':' + props.site.id + ':' + month);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [staff, roster, weekly, exceptions, closureRows] = await Promise.all([
        db().from('staff_assignments').select('profile_id, profiles!staff_assignments_profile_id_fkey(full_name,account_status,role)')
          .eq('site_id', props.site.id).eq('staff_role', 'gatekeeper').eq('is_active', true),
        db().from('site_gatekeeper_duties').select(dutySelect).eq('site_id', props.site.id)
          .gte('duty_date', month).lte('duty_date', dutyMonthEnd(month)).in('status', ['scheduled', 'active', 'completed', 'replaced']).order('duty_date').order('shift_start_at').limit(500),
        db().from('site_operating_hours').select('weekday,opens_at,closes_at,is_closed').eq('site_id', props.site.id),
        db().from('site_operating_exceptions').select('exception_date,opens_at,closes_at,is_closed,reason').eq('site_id', props.site.id).gte('exception_date', month).lte('exception_date', dutyMonthEnd(month)),
        db().from('site_closures').select('starts_on,ends_on,starts_at,ends_at,reason').eq('site_id', props.site.id).lte('starts_on', dutyMonthEnd(month)).gte('ends_on', month),
      ]);
      if (staff.error) throw staff.error;
      if (weekly.error) throw weekly.error;
      if (exceptions.error) throw exceptions.error;
      if (closureRows.error) throw closureRows.error;
      setGatekeepers(((staff.data ?? []) as unknown as GatekeeperOption[]).filter((person) => {
        const profile = Array.isArray(person.profiles) ? person.profiles[0] : person.profiles;
        return profile?.role === 'gatekeeper' && profile.account_status === 'active';
      }));
      if (roster.error) throw roster.error;
      setDuties((roster.data ?? []) as unknown as DutyRow[]);
      setWeeklyHours(weekly.data ?? []);
      setSpecialHours(exceptions.data ?? []);
      setClosures(closureRows.data ?? []);
    } catch (error) { props.notify(dutyErrorMessage(error, 'Could not load the duty roster.')); }
    finally { finishLoading(); }
  }, [finishLoading, month, props.notify, props.site.id]);
  useEffect(() => { void refresh(); }, [refresh]);

  const selectedDuties = duties.filter((duty) => duty.duty_date === selectedDate);
  const selectedDuty = selectedDuties[0];
  const selectedSupports = selectedDuty?.supports.map((support) => support.gatekeeper_id).join(',') ?? '';
  useEffect(() => {
    setForm({ primary: selectedDuty?.primary_gatekeeper_id ?? '', supports: selectedDuty?.supports.map((support) => support.gatekeeper_id) ?? [] });
  }, [selectedDate, selectedDuty?.id, selectedDuty?.primary_gatekeeper_id, selectedSupports]);

  const exception = specialHours.find((item) => item.exception_date === selectedDate);
  const dayHours = exception ?? weeklyHours.find((hour) => hour.weekday === dutyDateWeekday(selectedDate));
  const closure = dayHours && !dayHours.is_closed && closures.find((item) => selectedDate >= item.starts_on && selectedDate <= item.ends_on
    && (!item.starts_at || (item.starts_at < (dayHours.closes_at ?? '') && (item.ends_at ?? '') > (dayHours.opens_at ?? ''))));
  const canOperate = props.site.status === 'published' && Boolean(dayHours && !dayHours.is_closed && !closure);
  const editableDuty = selectedDuties.length === 1 && selectedDuty?.status === 'scheduled' && new Date(selectedDuty.shift_start_at).getTime() > Date.now();
  const canEdit = selectedDate >= phToday() && canOperate && !selectedDuties.some((duty) => duty.status === 'active' || duty.status === 'completed')
    && (selectedDuties.length === 0 || editableDuty);
  const supportOptions = gatekeepers.filter((person) => person.profile_id !== form.primary && person.profile_id !== props.user?.id);
  const operatingHoursLabel = dayHours && !dayHours.is_closed && dayHours.opens_at && dayHours.closes_at
    ? timeLabel(dayHours.opens_at) + ' – ' + timeLabel(dayHours.closes_at) : '';
  const unavailableMessage = props.site.status !== 'published' ? 'Destination is not currently open for duty assignments.'
    : exception?.is_closed ? 'Closed: ' + exception.reason
      : closure ? 'Closed: ' + closure.reason : !dayHours || dayHours.is_closed ? 'Destination is closed on this date.'
      : selectedDate < phToday() ? 'Past assignments are view-only.'
        : selectedDuty && !editableDuty ? 'Started or completed duties are view-only.'
          : selectedDuties.length > 1 ? 'Multiple legacy shifts exist on this date. Resolve them before editing.' : '';

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || !form.primary || selectedDuties.length > 1) { props.notify('Choose an open date and one active primary gatekeeper.'); return; }
    setSaving(true);
    try {
      const { error } = await db().rpc('save_gatekeeper_day_assignment', {
        p_site_id: props.site.id, p_duty_date: selectedDate,
        p_primary_gatekeeper_id: form.primary, p_support_gatekeeper_ids: form.supports,
      });
      if (error) throw error;
      props.notify('Daily gatekeeper assignment saved.');
      await refresh();
    } catch (error) { props.notify(dutyErrorMessage(error, 'Could not save gatekeeper assignment.')); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    setSaving(true);
    try {
      const { data, error } = await db().rpc('remove_gatekeeper_day_assignment', { p_site_id: props.site.id, p_duty_date: selectedDate });
      if (error) throw error;
      props.notify(data ? 'Gatekeeper assignment removed.' : 'No scheduled assignment to remove.');
      await refresh();
    } catch (error) { props.notify(dutyErrorMessage(error, 'Could not remove gatekeeper assignment.')); }
    finally { setSaving(false); }
  };
  const repeat = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.primary || !repeatForm.weekdays.length) { props.notify('Choose a primary gatekeeper and at least one weekday.'); return; }
    setSaving(true);
    try {
      const { data, error } = await db().rpc('repeat_gatekeeper_day_assignment', {
        p_site_id: props.site.id, p_from_date: repeatForm.from, p_through_date: repeatForm.through,
        p_weekdays: repeatForm.weekdays, p_primary_gatekeeper_id: form.primary,
        p_support_gatekeeper_ids: form.supports,
      });
      if (error) throw error;
      props.notify(`Assigned ${Number(data ?? 0)} duty dates.`);
      setRepeatOpen(false);
      await refresh();
    } catch (error) { props.notify(dutyErrorMessage(error, 'Could not repeat gatekeeper assignment.')); }
    finally { setSaving(false); }
  };

  return <div className="duty-calendar-layout">
    <div className="duty-calendar-main">
      <DutyMonthCalendar month={month} selectedDate={selectedDate} duties={duties} onSelect={setSelectedDate} onMonthChange={(delta) => {
        const next = shiftDutyMonth(month, delta); setMonth(next); setSelectedDate(next);
      }}/>
      <section className="duty-calendar-assignment-list" id="duty-assignment-list"><div><small>DAILY ACCOUNTABILITY</small><h2>Assigned Gatekeepers — {dutyDateLabel(selectedDate)}</h2></div>
        {!selectedDuties.length && <p className="empty-inline">No gatekeeper assigned for this date.</p>}
        {selectedDuties.map((duty) => <article key={duty.id}><span className="duty-person-icon"><UserRound size={20}/></span><div><b>{profileName(duty.primary)}</b><small>Primary · {duty.status}</small></div><span>{duty.supports.length ? duty.supports.map((support) => profileName(support.gatekeeper)).join(', ') : 'No support assigned'}</span></article>)}
      </section>
    </div>
    <aside className="duty-calendar-aside">
      <section className="duty-calendar-assignment-card">
        <div className="duty-calendar-card-title"><CalendarDays size={21}/><h2>Assign Duty</h2></div>
        <div className="duty-calendar-summary"><b>{dutyDateLabel(selectedDate)}</b><span>{props.site.name}</span></div>
        <div className="duty-calendar-hours"><CalendarClock size={19}/><span><b>{exception ? 'Special operating hours' : 'Operating hours'}</b><small>{operatingHoursLabel || (dayHours?.is_closed ? 'Closed' : 'Not configured')}</small></span></div>
        {unavailableMessage && <p className="duty-calendar-notice" role="status">{unavailableMessage}</p>}
        {!gatekeepers.length && !loading && <p className="duty-calendar-notice" role="status">Assign an active gatekeeper to this destination first.</p>}
        <form className="duty-calendar-form" onSubmit={(event) => void save(event)}>
          <label>Primary Gatekeeper <em>*</em><select value={form.primary} onChange={(event) => setForm({ primary: event.target.value, supports: form.supports.filter((id) => id !== event.target.value) })} disabled={!canEdit || loading} required><option value="">Choose primary</option>{gatekeepers.filter((person) => person.profile_id !== props.user?.id).map((person) => <option key={person.profile_id} value={person.profile_id}>{profileName(person.profiles)}</option>)}</select></label>
          {!!supportOptions.length && <fieldset disabled={!canEdit || loading}><legend>Support Gatekeepers <small>(optional)</small></legend>{supportOptions.map((person) => <label key={person.profile_id}><input type="checkbox" checked={form.supports.includes(person.profile_id)} onChange={(event) => setForm({ ...form, supports: event.target.checked ? [...form.supports, person.profile_id] : form.supports.filter((id) => id !== person.profile_id) })}/>{profileName(person.profiles)}</label>)}</fieldset>}
          <div className="duty-calendar-actions"><button className="btn btn-primary" disabled={saving || loading || !canEdit || !form.primary}>{saving ? 'Saving…' : selectedDuty ? 'Save Assignment' : 'Assign Gatekeeper'} <Check size={15}/></button>
            {selectedDuty && <button type="button" className="btn btn-outline" disabled={saving || loading || !editableDuty} onClick={() => void remove()}><X size={15}/> Remove</button>}</div>
        </form>
        {loading && <p className="field-hint" role="status">Loading calendar…</p>}
      </section>
      <section className="duty-calendar-quick"><small>QUICK ACTIONS</small><h3>Duty roster</h3>
        <button type="button" className="quick-row" disabled={!canEdit || !form.primary || saving} aria-expanded={repeatOpen}
          onClick={() => { setRepeatForm({ from: selectedDate, through: addDutyDays(selectedDate, 30), weekdays: [dutyDateWeekday(selectedDate)] }); setRepeatOpen(!repeatOpen); }}>
          <CalendarDays size={17}/> Repeat Assignment <ArrowRight size={14}/>
        </button>
        {repeatOpen && <form className="duty-repeat-form" onSubmit={(event) => void repeat(event)}>
          <label>From<input type="date" min={phToday()} value={repeatForm.from} onChange={(event) => setRepeatForm({ ...repeatForm, from: event.target.value, through: repeatForm.through < event.target.value ? event.target.value : repeatForm.through })} required/></label>
          <label>Through<input type="date" min={repeatForm.from} max={addDutyDays(repeatForm.from, 89)} value={repeatForm.through} onChange={(event) => setRepeatForm({ ...repeatForm, through: event.target.value })} required/></label>
          <fieldset><legend>Repeat on</legend>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday, index) => <label key={weekday}><input type="checkbox" checked={repeatForm.weekdays.includes(index)} onChange={(event) => setRepeatForm({ ...repeatForm, weekdays: event.target.checked ? [...repeatForm.weekdays, index] : repeatForm.weekdays.filter((day) => day !== index) })}/>{weekday}</label>)}</fieldset>
          <button className="btn btn-primary" disabled={saving || loading}>{saving ? 'Saving…' : 'Save Repeated Assignments'} <Check size={15}/></button>
        </form>}
        <button type="button" className="quick-row" onClick={() => document.getElementById('duty-assignment-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><CalendarDays size={17}/> View Assignment List <ArrowRight size={14}/></button>
      </section>
    </aside>
  </div>;
}

export function DutyDetailsPage(props: Props) {
  const activeAssignments = props.assignments.filter((assignment) => assignment.staff_role === 'gatekeeper' && assignment.is_active);
  const site = activeAssignments.length === 1 && activeAssignments[0].site_id === props.siteId
    ? props.sites.find((item) => item.id === props.siteId) : undefined;
  const [month, setMonth] = useState(() => dutyMonthStart(phToday()));
  const [selectedDate, setSelectedDate] = useState(phToday());
  const [duties, setDuties] = useState<DutyRow[]>([]);
  const [now, setNow] = useState(Date.now);
  const [loading, finishLoading] = useSilentLoad((props.user?.id ?? 'staff') + ':' + (site?.id ?? 'unassigned') + ':' + month);
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(interval); }, []);

  useEffect(() => {
    let active = true;
    if (!site) { setDuties([]); finishLoading(); return () => { active = false; }; }
    void (async () => {
      try {
        const { data, error } = await db().from('site_gatekeeper_duties').select(dutySelect).eq('site_id', site.id)
          .gte('duty_date', month).lte('duty_date', dutyMonthEnd(month)).in('status', ['scheduled', 'active', 'completed', 'replaced']).order('duty_date').order('shift_start_at').limit(500);
        if (error) throw error;
        const mine = ((data ?? []) as unknown as DutyRow[]).filter((duty) => duty.primary_gatekeeper_id === props.user?.id
          || duty.supports.some((support) => support.gatekeeper_id === props.user?.id));
        if (active) setDuties(mine);
      } catch (error) { if (active) props.notify(dutyErrorMessage(error, 'Could not load your duty details.')); }
      finally { if (active) finishLoading(); }
    })();
    return () => { active = false; };
  }, [finishLoading, month, props.notify, props.user?.id, site?.id]);

  const selectedDuties = duties.filter((duty) => duty.duty_date === selectedDate);
  const assigned = (duty: DutyRow) => duty.primary_gatekeeper_id === props.user?.id
    ? 'Primary gatekeeper' : 'Support gatekeeper';
  const statusLabel = (duty: DutyRow) => duty.status === 'completed' ? 'Completed'
    : dutyWindowStatus(duty.shift_start_at, duty.shift_end_at, now);
  return <section className="dashboard-page section-wrap"><div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> GATEKEEPER · ASSIGNMENTS</span><h1>Your duty <em>calendar.</em></h1><p>Scheduled dates and operating hours for {site?.name ?? 'your assigned destination'}.</p></div></div>
    {loading && <div className="empty-inline" role="status">Loading your duty calendar…</div>}
    {!site && !loading && <div className="empty-card"><CalendarClock size={28}/><h3>Destination assignment needs review</h3><p>Ask the Tourism Office to confirm your active destination assignment.</p></div>}
    {site && <div className="duty-calendar-layout duty-calendar-personal">
      <DutyMonthCalendar month={month} selectedDate={selectedDate} duties={duties} onSelect={setSelectedDate} onMonthChange={(delta) => {
        const next = shiftDutyMonth(month, delta); setMonth(next); setSelectedDate(next);
      }}/>
      <aside className="duty-calendar-assignment-card">
        <div className="duty-calendar-card-title"><CalendarDays size={21}/><h2>{site.name}</h2></div>
        <div className="duty-calendar-summary"><b>{selectedDate === phToday() ? 'Today’s duty' : dutyDateLabel(selectedDate)}</b><span>{selectedDuties.length ? statusLabel(selectedDuties[0]) : 'No assigned duty'}</span></div>
        {selectedDate === phToday() && <p className="field-hint">Duty status follows the assigned shift hours. Assignment alone does not record physical presence.</p>}
        {!selectedDuties.length && <div className="empty-inline">Ask the Tourism Office to assign you for this date.</div>}
        {selectedDuties.map((duty) => <article className="duty-calendar-personal-duty" key={duty.id}><span className="status-tag">{assigned(duty)}</span><p>{dutyDateLabel(duty.duty_date)} · {timeLabel(duty.shift_start_at)} – {timeLabel(duty.shift_end_at)} · Asia/Manila</p><small>Primary: {profileName(duty.primary)} · {duty.supports.length ? 'Support: ' + duty.supports.map((item) => profileName(item.gatekeeper)).join(', ') : 'No support gatekeeper'}</small><span className="status-tag">{statusLabel(duty)}</span></article>)}
      </aside>
    </div>}
  </section>;
}
