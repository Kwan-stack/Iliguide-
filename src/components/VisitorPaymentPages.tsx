import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock3, FileText, Upload, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { db, dateLabel, lookupBooking, money, type Booking } from '../lib/iliguide';
import { isFreeRegistration, paymentStatusLabel } from '../lib/paymentStatus';
import { validatePaymentProofPhoto } from '../lib/paymentProof';
import type { ManualPaymentSettings } from './VisitorBookingFlow';
import './VisitorPayment.css';

type Payment = {
  id: string; booking_id: string; provider: string; payment_mode: string; payment_application: 'gcash' | 'maya' | null;
  amount: number; payment_status: string; payment_deadline: string | null; proof_storage_path: string | null;
  transaction_reference: string | null; proof_submitted_at: string | null; verified_at: string | null;
  receipt_reference: string | null; rejection_reason: string | null;
};

async function loadPayment(reference: string, manualOnly: boolean) {
  const booking = await lookupBooking(reference);
  if (!booking) throw new Error('Booking not found for this visitor account.');
  let query = db().from('payments').select('id,booking_id,provider,payment_mode,payment_application,amount,payment_status,payment_deadline,proof_storage_path,transaction_reference,proof_submitted_at,verified_at,receipt_reference,rejection_reason')
    .eq('booking_id', booking.booking_id);
  if (manualOnly) query = query.eq('provider', 'manual');
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (manualOnly && !data) throw new Error('Manual payment session not found for this booking.');
  return { booking, payment: data as Payment | null };
}

function useBookingPayment(reference: string, manualOnly = true) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [settings, setSettings] = useState<ManualPaymentSettings | null>(null);
  const [fees, setFees] = useState<{ adult_fee: number; child_fee: number; pwd_discount_percent: number } | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    const result = await loadPayment(reference, manualOnly);
    const [globalResult, siteResult, feeResult] = await Promise.all([
      db().from('tourism_payment_settings').select('demo_mode,payment_window_minutes').eq('id', true).maybeSingle(),
      db().from('site_demo_payment_settings').select('gcash_enabled,gcash_account_name,gcash_account_identifier,maya_enabled,maya_account_name,maya_account_identifier,onsite_instructions').eq('site_id', result.booking.site_id).maybeSingle(),
      db().from('site_settings').select('adult_fee,child_fee,pwd_discount_percent').eq('site_id', result.booking.site_id).maybeSingle(),
    ]);
    if (globalResult.error || siteResult.error || feeResult.error) throw globalResult.error ?? siteResult.error ?? feeResult.error;
    setBooking(result.booking);
    setPayment(result.payment);
    setSettings(globalResult.data && siteResult.data ? { ...globalResult.data, ...siteResult.data } as ManualPaymentSettings : null);
    setFees(feeResult.data as typeof fees);
    setError('');
  }, [manualOnly, reference]);
  useEffect(() => {
    let active = true;
    const run = () => void refresh().catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load payment details.'); });
    run();
    const timer = window.setInterval(run, 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refresh]);
  useEffect(() => {
    if (!booking?.booking_id) return;
    const channel = db().channel(`booking-payment-${booking.booking_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `booking_id=eq.${booking.booking_id}` }, () => { void refresh(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `id=eq.${booking.booking_id}` }, () => { void refresh(); })
      .subscribe();
    return () => { void db().removeChannel(channel); };
  }, [booking?.booking_id, refresh]);
  return { booking, payment, settings, fees, error, refresh };
}

export function VisitorManualPaymentPage({ reference, notify, onBack, onConfirmed }: { reference: string; notify: (message: string) => void; onBack: () => void; onConfirmed: () => void }) {
  const { booking, payment, settings, fees, error, refresh } = useBookingPayment(reference);
  const [transactionReference, setTransactionReference] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [storedProofUrl, setStoredProofUrl] = useState<string | null>(null);
  const [photoValidating, setPhotoValidating] = useState(false);
  const [resubmitReady, setResubmitReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!payment?.transaction_reference) return;
    if (payment.payment_status === 'rejected') {
      if (!resubmitReady) { setTransactionReference(''); setFile(null); }
      return;
    }
    setTransactionReference(payment.transaction_reference);
  }, [payment?.payment_status, payment?.transaction_reference, resubmitReady]);
  useEffect(() => {
    const path = payment?.proof_storage_path;
    let active = true;
    if (!path) { setStoredProofUrl(null); return; }
    void db().storage.from('manual-payment-proofs').createSignedUrl(path, 3600).then(({ data, error }) => {
      if (active) setStoredProofUrl(error ? null : data?.signedUrl ?? null);
    }).catch(() => { if (active) setStoredProofUrl(null); });
    return () => { active = false; };
  }, [payment?.proof_storage_path]);
  useEffect(() => { if (payment?.payment_status === 'paid') onConfirmed(); }, [onConfirmed, payment?.payment_status]);
  const app = payment?.payment_application === 'gcash' ? 'GCash' : 'Maya';
  const deadline = payment?.payment_deadline ? new Date(payment.payment_deadline).getTime() : 0;
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const expired = Boolean(deadline && remaining === 0 && ['pending', 'rejected'].includes(payment?.payment_status ?? ''));
  const simulatePayment = async () => {
    if (!booking || !payment || expired) return;
    setBusy(true);
    try {
      const { data, error } = await db().rpc('simulate_manual_payment', { p_booking_id: booking.booking_id });
      if (error) throw error;
      const reference = String(data);
      if (payment.payment_status === 'rejected') setResubmitReady(true);
      setTransactionReference(reference); setFile(null);
      notify('Demo transaction created. Choose a JPG or PNG photo, then submit for staff review.');
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Could not simulate demo payment.'); }
    finally { setBusy(false); }
  };
  const submitProof = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!booking || !payment || !app || !file) return;
    if (!transactionReference.startsWith('DEMO-')) { notify('Complete the demo simulation before submitting proof.'); return; }
    setBusy(true);
    try {
      const photo = await validatePaymentProofPhoto(file);
      const extension = photo.type === 'image/jpeg' ? 'jpg' : 'png';
      const path = `${booking.booking_id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await db().storage.from('manual-payment-proofs').upload(path, photo, { contentType: photo.type, upsert: false });
      if (uploadError) throw uploadError;
      const { error: submitError } = await db().rpc('submit_manual_payment_proof', {
        p_booking_id: booking.booking_id, p_payment_application: payment.payment_application,
        p_transaction_reference: transactionReference.trim(), p_proof_storage_path: path,
      });
      if (submitError) { await db().storage.from('manual-payment-proofs').remove([path]); throw submitError; }
      notify('Proof submitted. Gatekeeper review is pending.');
      setFile(null); setTransactionReference(''); await refresh();
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Could not submit payment proof. Try again.'); }
    finally { setBusy(false); }
  };
  if (error) return <section className="visitor-payment-page section-wrap"><div className="empty-card" role="alert"><h2>Payment details unavailable</h2><p>{error}</p><button className="btn btn-outline" onClick={() => void refresh()}>Retry</button></div></section>;
  if (!booking || !payment) return <section className="visitor-payment-page section-wrap"><div className="empty-inline" role="status">Loading payment details…</div></section>;
  return <section className="visitor-payment-page section-wrap">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15}/> My bookings</button><span className="eyebrow"><span className="eyebrow-line"/> BOOKING {booking.booking_reference}</span>
    <h1>{payment.payment_status === 'paid' ? 'Demo payment verified.' : 'Complete demo payment.'}</h1>
    <p>{payment.payment_status === 'pending_verification' ? 'Your demo proof is awaiting verification by an authorized destination administrator.' : payment.payment_status === 'rejected' ? 'Review the rejection note and resubmit before the deadline.' : 'Create a fictional transaction reference, then attach a demo payment photo. No money moves.'}</p>
    <div className="visitor-payment-columns"><main className="visitor-payment-card">
      {payment.payment_status === 'pending_verification' && <div className="visitor-payment-status pending"><Clock3 size={20}/><span><b>Pending verification</b><small>Reservation capacity remains held while staff review your proof.</small></span></div>}
      {payment.payment_status === 'paid' && <div className="visitor-payment-status paid"><Check size={20}/><span><b>Payment verified</b><small>Your booking is confirmed.</small></span></div>}
      {payment.payment_status === 'expired' || expired ? <div className="visitor-payment-status expired"><X size={20}/><span><b>Payment session expired</b><small>Your reservation hold has expired. Start a new booking to reserve a slot.</small></span></div> : null}
      {payment.payment_status === 'rejected' && <div className="visitor-payment-status rejected"><X size={20}/><span><b>Proof rejected</b><small>{payment.rejection_reason || 'The Gatekeeper could not verify this payment.'}</small></span></div>}
      {payment.payment_status === 'pending' && !expired && <><div className="visitor-payment-countdown"><Clock3 size={23}/><span>Time remaining<b>{String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}</b></span></div>
        <div className="visitor-payment-account"><h2>{app} · Demo payment</h2><p><b>DEMO PAYMENT — NO REAL MONEY WILL BE TRANSFERRED.</b> Never send funds. This internal simulation does not connect to GCash or Maya.</p><dl><div><dt>Booking reference</dt><dd>{booking.booking_reference}</dd></div><div><dt>Destination</dt><dd>{booking.site_name}</dd></div><div><dt>Visit date</dt><dd>{dateLabel(booking.slot_date)}</dd></div><div><dt>Visitors</dt><dd>{booking.visitor_count} · {booking.adult_count} adults, {booking.child_count} children</dd></div><div><dt>Demo account</dt><dd>{payment.payment_application === 'gcash' ? settings?.gcash_account_name : settings?.maya_account_name}</dd></div><div><dt>Demo account identifier</dt><dd>{payment.payment_application === 'gcash' ? settings?.gcash_account_identifier : settings?.maya_account_identifier}</dd></div>{fees && <><div><dt>Adults · {money(fees.adult_fee)} each</dt><dd>{money(fees.adult_fee * booking.adult_count)}</dd></div><div><dt>Children · {money(fees.child_fee)} each</dt><dd>{money(fees.child_fee * booking.child_count)}</dd></div>{booking.pwd_count > 0 && <div><dt>PWD discount · {fees.pwd_discount_percent}%</dt><dd>Applied to total</dd></div>}</>}<div><dt>Amount due · demo</dt><dd>{money(Number(booking.total_amount))}</dd></div></dl>
          <div className="visitor-demo-qr visitor-payment-demo-qr"><QRCodeSVG value={`DEMO_ILLIGUIDE_PAYMENT\nPayment Method: ${app} Demo\nAccount ID: ${payment.payment_application === 'gcash' ? settings?.gcash_account_identifier ?? 'DEMO-GCASH-001' : settings?.maya_account_identifier ?? 'DEMO-MAYA-001'}\nMode: SIMULATION_ONLY`} size={136} level="M" title={`${app} demo QR code, not payable`} includeMargin/><strong>DEMO QR — NOT PAYABLE</strong><small>Simulation details only. Do not scan to send money.</small></div>
          {!transactionReference && <button className="btn btn-primary" disabled={busy || remaining === 0} onClick={() => void simulatePayment()}>{busy ? 'Creating…' : 'Generate demo transaction'} <ArrowRight size={15}/></button>}
          {transactionReference && <p>Demo transaction reference: <b>{transactionReference}</b></p>}
          <small className="visitor-demo-explainer">This creates a demo reference for review. It does not open GCash or Maya, and never transfers money.</small>
        </div>
        <form className="visitor-proof-form" onSubmit={(event) => void submitProof(event)}><h2>Add demo proof</h2>
          <label>Transaction reference <span className="visitor-required-mark" aria-hidden="true">*</span><input value={transactionReference} readOnly required maxLength={120}/></label>
          <ProofPhotoField file={file} onChange={setFile} onValidatingChange={setPhotoValidating} disabled={!transactionReference || busy} notify={notify} helpId="visitor-demo-proof-help"/>
          <button className="btn btn-primary" disabled={busy || photoValidating || remaining === 0 || !file}>{busy ? 'Submitting…' : 'Submit'} <ArrowRight size={15}/></button>
        </form></>}
      {payment.payment_status === 'rejected' && !expired && <form className="visitor-proof-form" onSubmit={(event) => void submitProof(event)}><h2>Resubmit demo proof</h2><p>Generate a new demo transaction before resubmitting.</p><button type="button" className="btn btn-outline" disabled={busy || remaining === 0 || resubmitReady} onClick={() => void simulatePayment()}>{resubmitReady ? 'New demo reference ready' : 'Generate demo transaction'}</button>{transactionReference && <><label>Demo transaction reference <span className="visitor-required-mark" aria-hidden="true">*</span><input value={transactionReference} readOnly required/></label><ProofPhotoField file={file} onChange={setFile} onValidatingChange={setPhotoValidating} disabled={busy} notify={notify} helpId="visitor-demo-proof-help-retry"/><button className="btn btn-primary" disabled={busy || photoValidating || remaining === 0 || !file}>{busy ? 'Submitting…' : 'Submit'}</button></>}</form>}
      {!file && storedProofUrl && <div className="visitor-proof-stored"><b>Submitted payment photo</b><img src={storedProofUrl} alt={`Submitted payment photo for booking ${booking.booking_reference}`}/><a href={storedProofUrl} target="_blank" rel="noreferrer">Open photo</a></div>}
      {payment.payment_status === 'paid' && <Receipt booking={booking} payment={payment}/>}
      {payment.proof_submitted_at && <small className="visitor-proof-submitted">Proof submitted {new Date(payment.proof_submitted_at).toLocaleString()} · {payment.transaction_reference}</small>}
    </main><aside className="visitor-payment-summary"><h2>Booking summary</h2><b>{booking.site_name}</b><span>{dateLabel(booking.slot_date)}</span><span>{booking.visitor_count} visitors</span><span>Reference · {booking.booking_reference}</span><strong>Total · {money(Number(booking.total_amount))}</strong><small>{paymentStatusLabel(payment.payment_status, Number(booking.total_amount))}</small></aside></div>
  </section>;
}

function ProofPhotoField({ file, onChange, onValidatingChange, disabled, notify, helpId }: {
  file: File | null; onChange: (file: File | null) => void; onValidatingChange: (validating: boolean) => void;
  disabled: boolean; notify: (message: string) => void; helpId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  useEffect(() => {
    if (!file) { setPreviewUrl(null); if (inputRef.current) inputRef.current.value = ''; return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const selectPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selected = input.files?.[0];
    if (!selected) return;
    setValidating(true); onValidatingChange(true);
    try { onChange(await validatePaymentProofPhoto(selected)); }
    catch (cause) { input.value = ''; notify(cause instanceof Error ? cause.message : 'Could not read that photo. Choose another JPG or PNG.'); }
    finally { setValidating(false); onValidatingChange(false); }
  };
  return <div className="visitor-proof-photo-field">
    <label className="visitor-proof-upload"><span className="visitor-proof-upload-label"><Upload size={16} aria-hidden="true"/>Demo payment photo or screenshot <span className="visitor-required-mark" aria-hidden="true">*</span></span>
      <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" required={!file} aria-required="true" aria-describedby={helpId} disabled={disabled || validating} onChange={(event) => void selectPhoto(event)}/>
      <small id={helpId}>Choose an existing JPG, JPEG, or PNG photo from your device. Maximum 10 MiB.</small>
    </label>
    {validating && <small role="status">Checking photo…</small>}
    {file && <div className="visitor-proof-preview" aria-live="polite">{previewUrl && <img src={previewUrl} alt="Preview of selected demo payment photo"/>}<span><b>{file.name}</b><small>Selected photo · no real payment data</small></span><button type="button" className="btn btn-outline" disabled={disabled} onClick={() => { if (inputRef.current) inputRef.current.value = ''; onChange(null); }}>Remove photo</button></div>}
  </div>;
}

export function BookingConfirmationPage({ reference, onBookings }: { reference: string; onBookings: () => void }) {
  const { booking, payment, settings, error } = useBookingPayment(reference, false);
  if (error) return <section className="visitor-payment-page section-wrap"><div className="empty-card" role="alert"><h2>Booking unavailable</h2><p>{error}</p></div></section>;
  if (!booking) return <section className="visitor-payment-page section-wrap"><div className="empty-inline" role="status">Loading booking…</div></section>;
  const onsitePending = booking.payment_method === 'onsite' && booking.payment_status === 'pending';
  const waiting = booking.payment_status === 'pending_verification';
  const freeRegistration = isFreeRegistration(booking.payment_status, Number(booking.total_amount));
  return <section className="visitor-confirmation section-wrap"><div className="visitor-confirmation-card"><span className="visitor-confirmation-icon">{waiting || onsitePending ? <Clock3 size={32}/> : <Check size={34}/>}</span>
    <span className="eyebrow"><span className="eyebrow-line"/> BOOKING {booking.booking_reference}</span>
    <h1>{waiting ? 'Payment under review.' : onsitePending ? 'Booking registered.' : booking.payment_status === 'paid' || booking.payment_status === 'not_required' ? 'Booking confirmed.' : 'Booking status updated.'}</h1>
    <p>{freeRegistration ? 'Your free reservation is confirmed. Keep this reference for your visit.' : waiting ? 'An authorized destination administrator is verifying your payment proof. Your reservation remains held while staff review it.' : onsitePending ? settings?.onsite_instructions || 'Please complete payment at the destination during your scheduled visit.' : booking.payment_status === 'paid' ? 'Payment was verified. Your reservation is confirmed.' : 'Check your current booking and payment status below.'}</p>
    <dl><div><dt>Destination</dt><dd>{booking.site_name}</dd></div><div><dt>Visit</dt><dd>{dateLabel(booking.slot_date)}</dd></div><div><dt>Visitors</dt><dd>{booking.visitor_count}</dd></div>{freeRegistration ? <><div><dt>Registration method</dt><dd>Online reservation</dd></div><div><dt>Admission status</dt><dd>Free</dd></div><div><dt>Admission fee</dt><dd>{money(Number(booking.total_amount))}</dd></div></> : <><div><dt>Payment method</dt><dd>{booking.payment_method === 'onsite' ? `Pay onsite${payment?.payment_mode === 'demo' ? ' · Demo' : ''}` : `Pay online${payment?.payment_mode === 'demo' ? ' · Demo' : ''}`}</dd></div><div><dt>Payment status</dt><dd>{payment?.payment_mode === 'demo' && booking.payment_status === 'paid' ? 'Demo paid' : paymentStatusLabel(booking.payment_status, Number(booking.total_amount))}</dd></div><div><dt>Total</dt><dd>{money(Number(booking.total_amount))}</dd></div></>}</dl>
    {payment?.receipt_reference && booking.payment_status === 'paid' && <Receipt booking={booking} payment={payment}/>}
    <button className="btn btn-primary" onClick={onBookings}>Open My Bookings <ArrowRight size={15}/></button>
  </div></section>;
}

function Receipt({ booking, payment }: { booking: Booking; payment: Payment }) {
  if (!payment.receipt_reference || payment.payment_status !== 'paid') return null;
  const demo = payment.payment_mode === 'demo';
  return <article className="visitor-receipt"><div className="visitor-receipt-header"><span className="brand-mark"><img src="/iliguide-logo.svg" alt=""/></span><b>Iliguide{demo ? ' · Demo' : ''}</b></div>{demo && <><strong className="demo-watermark">DEMO RECEIPT — NOT VALID AS PROOF OF PAYMENT</strong><h2>Simulated payment confirmation</h2><p>No money was transferred or received. This is not an official tax invoice or receipt.</p></>}<dl><div><dt>Receipt reference</dt><dd>{payment.receipt_reference}</dd></div><div><dt>Booking reference</dt><dd>{booking.booking_reference}</dd></div><div><dt>Visitor/contact</dt><dd>{booking.visitor_name}</dd></div><div><dt>Destination</dt><dd>{booking.site_name}</dd></div><div><dt>Visit date</dt><dd>{dateLabel(booking.slot_date)}</dd></div><div><dt>Visitors</dt><dd>{booking.visitor_count}</dd></div><div><dt>Payment method</dt><dd>{booking.payment_method === 'onsite' ? `Onsite${demo ? ' · Demo' : ''}` : `${payment.payment_application?.toUpperCase()}${demo ? ' · Demo' : ''}`}</dd></div><div><dt>{demo ? 'Simulated amount' : 'Amount paid'}</dt><dd>{money(Number(payment.amount))}</dd></div><div><dt>Verified</dt><dd>{payment.verified_at ? new Date(payment.verified_at).toLocaleString() : 'Confirmed'}</dd></div><div><dt>Status</dt><dd>{demo ? 'Demo paid' : 'Paid'}</dd></div></dl><button className="btn btn-outline no-print" onClick={() => window.print()}><FileText size={15}/> Print / Save as PDF</button></article>;
}
