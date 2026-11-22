import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Banknote, CalendarDays, CreditCard, UserRound } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { Party } from '../lib/pendingReservation';
import { bookingContactError } from '../lib/bookingValidation';
import { completedVisitorCount, visitorInformationComplete, type VisitorInformation } from '../lib/visitorInformation';
import { loadLiveOccupancy, money, type LiveOccupancy, type Site, type Slot, type TravelerProfile } from '../lib/iliguide';
import { VisitorInformationForm } from './VisitorInformationForm';
import './VisitorBooking.css';

export type ManualPaymentSettings = {
  demo_mode: boolean; payment_window_minutes: number; onsite_instructions: string;
  gcash_enabled: boolean; gcash_account_name: string; gcash_account_identifier: string;
  maya_enabled: boolean; maya_account_name: string; maya_account_identifier: string;
};

export function VisitorBookingFlow(props: {
  site: Site; step: number; setStep: (step: number) => void; date: string; setDate: (date: string) => void;
  slots: Slot[]; slotsLoading: boolean; selectedSlot: string; setSelectedSlot: (id: string) => void;
  party: Party; setParty: (next: Party | ((current: Party) => Party)) => void;
  visitors: VisitorInformation[]; setVisitors: (next: VisitorInformation[] | ((current: VisitorInformation[]) => VisitorInformation[])) => void;
  contact: { name: string; email: string; phone: string }; setContact: (contact: { name: string; email: string; phone: string }) => void;
  travelers: TravelerProfile[]; selectedTravelerId: string; setSelectedTravelerId: (id: string) => void;
  paymentMethod: 'online' | 'onsite'; setPaymentMethod: (method: 'online' | 'onsite') => void;
  paymentApplication: 'gcash' | 'maya'; setPaymentApplication: (app: 'gcash' | 'maya') => void;
  paymentSettings: ManualPaymentSettings | null; amount: number; busy: boolean; onSubmit: () => void;
  onBackToDestination: () => void; notify: (message: string) => void; today: string;
}) {
  const site = props.site;
  const totalVisitors = props.party.adults + props.party.children;
  const selected = props.slots.find((slot) => slot.slot_id === props.selectedSlot);
  const [occupancy, setOccupancy] = useState<LiveOccupancy | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => void loadLiveOccupancy(site.id).then((row) => { if (active) setOccupancy(row); }).catch(() => {});
    refresh(); const timer = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [site.id]);
  const apps = props.paymentSettings?.demo_mode ? [
    ...(props.paymentSettings.gcash_enabled ? [{ id: 'gcash' as const, name: 'GCash', accountName: props.paymentSettings.gcash_account_name, accountId: props.paymentSettings.gcash_account_identifier }] : []),
    ...(props.paymentSettings.maya_enabled ? [{ id: 'maya' as const, name: 'Maya', accountName: props.paymentSettings.maya_account_name, accountId: props.paymentSettings.maya_account_identifier }] : []),
  ] : [];
  const selectedApp = apps.find((app) => app.id === props.paymentApplication);
  const firstEnabledApp = props.paymentSettings?.gcash_enabled ? 'gcash' : props.paymentSettings?.maya_enabled ? 'maya' : null;
  useEffect(() => {
    if (firstEnabledApp && !selectedApp) props.setPaymentApplication(firstEnabledApp);
  }, [firstEnabledApp, props.paymentApplication, props.setPaymentApplication, selectedApp]);
  const updateVisitor = (index: number, field: keyof VisitorInformation, value: string) => props.setVisitors((current) => current.map((person, personIndex) => personIndex === index ? { ...person, [field]: value } : person));
  const next = () => {
    if (props.step === 0 && (props.slotsLoading || !selected)) { props.notify('No booking capacity is available for this date.'); return; }
    if (props.step === 1) {
      if (!visitorInformationComplete(props.visitors, site.slug)) { props.notify('Complete the required details for every visitor.'); return; }
      const error = bookingContactError(props.contact.name, props.contact.email, props.contact.phone);
      if (error) { props.notify(error); return; }
    }
    props.setStep(Math.min(props.step + 1, 3));
  };
  const summary = <aside className="visitor-flow-summary"><b>Booking summary</b><span>{site.name}</span><span>{props.date}</span><span>{totalVisitors} visitors · {props.party.adults} adults · {props.party.children} children</span><span>Adult {money(site.adult_fee)} · Child {money(site.child_fee)}</span><strong>Total · {money(props.amount)}</strong></aside>;
  return <section className="visitor-flow section-wrap">
    <div className="visitor-flow-heading"><button className="back-link" onClick={props.onBackToDestination}><ArrowLeft size={15}/> {site.name}</button><span className="eyebrow"><span className="eyebrow-line"/> BOOK A VISIT</span><h1>Plan your <em>visit.</em></h1><p>Choose a date, add visitor details, review, then select a demo payment method.</p></div>
    <nav className="visitor-flow-progress" aria-label="Booking progress">{['Destination details', 'Visit details', 'Visitor information', 'Review booking', 'Payment method'].map((name, index) => <div key={name} className={index === props.step + 1 ? 'active' : index < props.step + 1 ? 'complete' : ''} aria-current={index === props.step + 1 ? 'step' : undefined}><b>{index < props.step ? '✓' : index + 1}</b><span>{name}</span></div>)}</nav>
    <div className="visitor-flow-columns"><div className="visitor-flow-main">
      {props.step === 0 && <section className="visitor-flow-card"><h2><CalendarDays size={20}/> Visit details</h2><label>Visit date<input type="date" min={props.today} value={props.date} onChange={(event) => props.setDate(event.target.value)}/></label>
        <div className="visitor-capacity-info" role="status"><b>Live capacity information</b><span>{props.slotsLoading ? 'Updating availability…' : props.slots.length ? `${Math.max(0, ...props.slots.map((slot) => slot.remaining_capacity))} booking spaces currently available for this date.` : 'No booking capacity available for this date.'}</span><small>{occupancy ? `${occupancy.current_visitor_count} visitors currently onsite · ${occupancy.arrivals_today} arrivals today · ${occupancy.departures_today} departures today.` : 'Onsite counts update after Gatekeepers record arrivals and departures.'} Availability refreshes every 15 seconds.</small></div>
        {!props.slotsLoading && !props.slots.length && <p className="empty-inline">No available times for this date.</p>}
        <div className="visitor-flow-counters"><span>Adults</span><button aria-label="Fewer adults" onClick={() => props.setParty((current) => ({ ...current, adults: Math.max(1, current.adults - 1), pwd: Math.min(current.pwd, current.adults - 1 + current.children) }))}>−</button><b>{props.party.adults}</b><button aria-label="More adults" onClick={() => props.setParty((current) => ({ ...current, adults: Math.min(site.max_per_booking - current.children, current.adults + 1) }))}>+</button>
          <span>Children</span><button aria-label="Fewer children" onClick={() => props.setParty((current) => ({ ...current, children: Math.max(0, current.children - 1), pwd: Math.min(current.pwd, current.adults + current.children - 1) }))}>−</button><b>{props.party.children}</b><button aria-label="More children" onClick={() => props.setParty((current) => ({ ...current, children: Math.min(site.max_per_booking - current.adults, current.children + 1) }))}>+</button></div>
        {site.pwd_discount_percent > 0 && <label>PWD visitors<input type="number" min="0" max={totalVisitors} value={props.party.pwd} onChange={(event) => props.setParty((current) => ({ ...current, pwd: Math.max(0, Math.min(totalVisitors, Number(event.target.value))) }))}/><small>{site.pwd_discount_percent}% discount per PWD visitor. Eligibility checked at the gate.</small></label>}
      </section>}
      {props.step === 1 && <section className="visitor-flow-card"><h2><UserRound size={20}/> Visitor information</h2><VisitorInformationForm siteSlug={site.slug} adults={props.party.adults} children={props.party.children} visitors={props.visitors} onChange={updateVisitor}/>
        <div className="visitor-contact-card"><h3>Booking contact</h3><p>Main contact for reservation updates.</p>{props.travelers.length > 0 && <label>Saved traveler<select value={props.selectedTravelerId} onChange={(event) => { const id = event.target.value; props.setSelectedTravelerId(id); const person = props.travelers.find((traveler) => traveler.id === id); if (person) props.setContact({ name: person.full_name, email: person.email ?? '', phone: person.phone ?? '' }); }}><option value="">Enter details manually</option>{props.travelers.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label>}
          <label>Full name<input value={props.contact.name} maxLength={120} onChange={(event) => { props.setSelectedTravelerId(''); props.setContact({ ...props.contact, name: event.target.value }); }}/></label><label>Email<input type="email" value={props.contact.email} maxLength={254} onChange={(event) => { props.setSelectedTravelerId(''); props.setContact({ ...props.contact, email: event.target.value }); }}/></label><label>Phone<input type="tel" value={props.contact.phone} maxLength={40} onChange={(event) => { props.setSelectedTravelerId(''); props.setContact({ ...props.contact, phone: event.target.value }); }}/></label>
        </div><p className="field-hint">{completedVisitorCount(props.visitors, site.slug)}/{totalVisitors} visitor records complete.</p>
      </section>}
      {props.step === 2 && <section className="visitor-flow-card"><h2>Review your booking</h2><div className="visitor-review-block"><div><h3>Visit details</h3><button onClick={() => props.setStep(0)}>Edit</button></div><p>{site.name} · {props.date}</p><p>{props.party.adults} adults · {props.party.children} children · {props.party.pwd} PWD</p></div><div className="visitor-review-block"><div><h3>Visitor information</h3><button onClick={() => props.setStep(0)}>Edit</button></div>{props.visitors.slice(0, totalVisitors).map((person, index) => <p key={index}>{person.fullName || `Visitor ${index + 1}`} · {person.address}</p>)}</div><div className="visitor-review-block"><h3>Booking contact</h3><p>{props.contact.name} · {props.contact.email || props.contact.phone}</p></div><div className="visitor-review-block"><h3>Admission fees</h3><p>Adult · {money(site.adult_fee)} × {props.party.adults}</p>{props.party.children > 0 && <p>Child · {money(site.child_fee)} × {props.party.children}</p>}{props.party.pwd > 0 && <p>PWD discount · {site.pwd_discount_percent}% × {props.party.pwd}</p>}<strong>Total · {money(props.amount)}</strong></div></section>}
      {props.step === 3 && <section className="visitor-flow-card"><h2><CreditCard size={20}/> Choose Payment Method</h2>{props.amount > 0 ? <><div className="visitor-payment-options"><button type="button" className={'visitor-payment-option' + (props.paymentMethod === 'online' ? ' selected' : '')} aria-pressed={props.paymentMethod === 'online'} onClick={() => props.setPaymentMethod('online')}><CreditCard size={22}/><b>Pay Online</b><span>Complete a simulated payment using GCash or Maya.</span></button><button type="button" className={'visitor-payment-option' + (props.paymentMethod === 'onsite' ? ' selected' : '')} aria-pressed={props.paymentMethod === 'onsite'} onClick={() => props.setPaymentMethod('onsite')}><Banknote size={22}/><b>Pay Onsite</b><span>Register your booking and pay at the destination.</span></button></div>
          {props.paymentMethod === 'online' && <fieldset className="visitor-app-choice"><legend>Choose Payment Application</legend>{apps.map((app) => <label key={app.id}><input type="radio" name="payment-application" checked={props.paymentApplication === app.id} onChange={() => props.setPaymentApplication(app.id)}/>{app.name} — Demo</label>)}{!apps.length && <p>Demo payment options are unavailable. Contact the Tourism Office or choose Pay Onsite.</p>}</fieldset>}
          {props.paymentMethod === 'online' && selectedApp && <div className="visitor-demo-payment-info"><div><b>{selectedApp.name} Demo instructions</b><p>Send a simulated payment to {selectedApp.accountName}. Never transfer real money.</p><dl><div><dt>Demo account identifier</dt><dd>{selectedApp.accountId}</dd></div><div><dt>Amount due</dt><dd>{money(props.amount)}</dd></div></dl><small>Payment session starts after you continue. You will have {props.paymentSettings?.payment_window_minutes ?? 15} minutes.</small></div><div className="visitor-demo-qr"><QRCodeSVG value={`DEMO_ILLIGUIDE_PAYMENT\nPayment Method: ${selectedApp.name} Demo\nAccount ID: ${selectedApp.accountId}\nMode: SIMULATION_ONLY`} size={120} level="M" title={`${selectedApp.name} demo QR code, not payable`} includeMargin/><strong>DEMO QR — NOT PAYABLE</strong><small>Scannable simulation details only</small></div></div>}
        </> : <p>No payment is due. Continue to register your free reservation.</p>}
        {props.paymentMethod === 'onsite' && <p className="visitor-onsite-instructions">{props.paymentSettings?.onsite_instructions || 'Pay at the destination entrance or ticket booth.'}</p>}
        {props.paymentMethod === 'online' && props.amount > 0 && props.paymentSettings && <p className="visitor-onsite-instructions">Complete the demo payment flow within {props.paymentSettings.payment_window_minutes} minutes. The Gatekeeper reviews proof before confirmation.</p>}
      </section>}
      <div className="visitor-flow-actions"><button className="btn btn-outline" onClick={() => props.step === 0 ? props.onBackToDestination() : props.setStep(props.step - 1)}><ArrowLeft size={15}/> Back</button>{props.step < 3 ? <button className="btn btn-primary" onClick={next}>Continue <ArrowRight size={15}/></button> : <button className="btn btn-primary" disabled={props.busy || props.slotsLoading || !selected || (props.paymentMethod === 'online' && props.amount > 0 && !apps.some((app) => app.id === props.paymentApplication))} onClick={props.onSubmit}>{props.busy ? 'Registering…' : props.paymentMethod === 'online' && props.amount > 0 ? 'Continue to Demo Payment' : 'Register reservation'} <ArrowRight size={15}/></button>}</div>
    </div>{summary}</div>
  </section>;
}
