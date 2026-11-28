import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { adminCancelBooking, dateLabel, timeLabel, type AdminCancelBookingResult } from '../lib/iliguide';
import {
  ADMIN_CANCELLATION_CATEGORIES,
  validateAdminCancellationInput,
  type AdminCancellationCategory,
} from '../lib/adminCancellation';
import './AdminCancelBookingModal.css';

export type AdminCancelTarget = {
  id: string;
  booking_reference: string;
  site_name: string;
  visitor_name: string;
  visitor_count: number;
  slot_date?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
};

type Props = {
  booking: AdminCancelTarget;
  onClose: () => void;
  onCancelled: (result: AdminCancelBookingResult) => void;
  notify: (message: string) => void;
};

export function AdminCancelBookingModal({ booking, onClose, onCancelled, notify }: Props) {
  const [category, setCategory] = useState<AdminCancellationCategory>('Weather Condition');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitLockRef = useRef(false);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitLockRef.current) {
        event.preventDefault();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      if (previousFocused && previousFocused.isConnected) {
        previousFocused.focus();
      }
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLockRef.current) return;
    const validationError = validateAdminCancellationInput(category, reason);
    if (validationError) {
      setError(validationError);
      return;
    }
    submitLockRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await adminCancelBooking(booking.id, category, reason.trim());
      notify(`Booking ${result.booking_reference} cancelled (${result.cancellation_category}).`);
      onCancelled(result);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : 'Could not cancel this booking.';
      setError(text);
      notify(text);
    } finally {
      submitLockRef.current = false;
      setBusy(false);
    }
  };

  const slotSummary = booking.slot_date
    ? `${dateLabel(booking.slot_date)}${booking.starts_at ? ` · ${timeLabel(booking.starts_at)}${booking.ends_at ? `–${timeLabel(booking.ends_at)}` : ''}` : ''}`
    : 'Scheduled slot';

  return (
    <div
      className="modal-backdrop admin-cancel-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal admin-cancel-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-cancel-modal-title"
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          disabled={busy}
          aria-label="Close cancellation dialog"
        >
          <X size={18} />
        </button>

        <div className="admin-cancel-header">
          <span className="admin-cancel-icon" aria-hidden="true">
            <AlertTriangle size={20} />
          </span>
          <div>
            <span className="eyebrow">
              <span className="eyebrow-line" /> CITY TOURISM OFFICE
            </span>
            <h2 id="admin-cancel-modal-title">Cancel booking</h2>
          </div>
        </div>

        <p className="admin-cancel-intro">
          Cancelling this booking immediately releases its slot capacity, notifies the visitor, and invalidates its QR ticket at the gate.
        </p>

        <dl className="admin-cancel-summary">
          <div>
            <dt>Reference</dt>
            <dd>{booking.booking_reference}</dd>
          </div>
          <div>
            <dt>Destination</dt>
            <dd>{booking.site_name}</dd>
          </div>
          <div>
            <dt>Visit slot</dt>
            <dd>{slotSummary}</dd>
          </div>
          <div>
            <dt>Group size</dt>
            <dd>
              {booking.visitor_count} visitor{booking.visitor_count === 1 ? '' : 's'} · {booking.visitor_name}
            </dd>
          </div>
        </dl>

        <form className="admin-cancel-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            <span>
              Reason category <span className="required-mark" aria-hidden="true">*</span>
            </span>
            <select
              value={category}
              disabled={busy}
              required
              onChange={(event) => setCategory(event.target.value as AdminCancellationCategory)}
            >
              {ADMIN_CANCELLATION_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>
              Custom message <span className="field-optional">optional</span>
            </span>
            <textarea
              value={reason}
              disabled={busy}
              rows={3}
              maxLength={1000}
              placeholder="Heavy rainfall and flash flood advisory at Tinago Falls"
              onChange={(event) => setReason(event.target.value)}
            />
            <small className="field-hint">
              Shown to the visitor in their dashboard and to the Gatekeeper if this ticket is scanned. ({reason.length}/1000)
            </small>
          </label>

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <div className="admin-cancel-actions">
            <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
              Keep booking
            </button>
            <button type="submit" className="btn btn-danger" disabled={busy} aria-busy={busy}>
              {busy ? 'Cancelling booking…' : 'Confirm Cancellation'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
