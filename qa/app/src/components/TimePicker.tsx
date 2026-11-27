import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Keyboard } from 'lucide-react';
import './TimePicker.css';

type Draft = { hour: string; minute: string; period: 'AM' | 'PM' };
type Props = { value: string; onChange: (value: string) => void; required?: boolean };
const initial: Draft = { hour: '07', minute: '00', period: 'AM' };
const pad = (value: number) => String(value).padStart(2, '0');

function readTime(value: string): Draft | null {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour: pad(hour % 12 || 12), minute: pad(minute), period: hour >= 12 ? 'PM' : 'AM' };
}

function displayTime(value: string) {
  const time = readTime(value);
  return time ? `${time.hour}:${time.minute} ${time.period}` : '';
}

export function TimePicker({ value, onChange, required = false }: Props) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'hour' | 'minute'>('hour');
  const [keyboardMode, setKeyboardMode] = useState(false);
  const [draft, setDraft] = useState<Draft>(initial);
  const valid = draft.hour !== '' && Number(draft.hour) >= 1 && Number(draft.hour) <= 12
    && draft.minute !== '' && Number.isInteger(Number(draft.minute)) && Number(draft.minute) >= 0 && Number(draft.minute) <= 59;

  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) node.showModal();
    else if (!open && node?.open) node.close();
  }, [open]);

  const show = () => {
    setDraft(readTime(value) ?? initial);
    setPhase('hour');
    setKeyboardMode(false);
    setOpen(true);
  };
  const commit = () => {
    if (!valid) return;
    const hour = Number(draft.hour) % 12 + (draft.period === 'PM' ? 12 : 0);
    onChange(`${pad(hour)}:${pad(Number(draft.minute))}`);
    dialog.current?.close();
  };
  const dialIndex = phase === 'hour' ? Number(draft.hour) % 12 : Math.round(Number(draft.minute) / 5) % 12;
  const point = (index: number) => {
    const angle = index * Math.PI / 6 - Math.PI / 2;
    return { x: 50 + Math.cos(angle) * 38, y: 50 + Math.sin(angle) * 38 };
  };
  const hand = point(dialIndex);
  const values = Array.from({ length: 12 }, (_, index) => phase === 'hour'
    ? { label: String(index || 12), value: index || 12 }
    : { label: pad(index * 5), value: index * 5 });

  return <>
    <span className="time-picker"><input className="time-picker-trigger" type="text" value={displayTime(value)} placeholder="Select time" readOnly aria-required={required}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={show}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show(); } }}/></span>
    {createPortal(<>
    <dialog ref={dialog} id={id} className="time-picker-dialog" aria-labelledby={`${id}-title`}
      onClose={() => setOpen(false)} onCancel={(event) => { event.preventDefault(); dialog.current?.close(); }}
      onClick={(event) => { if (event.target === dialog.current) dialog.current?.close(); }}>
      <div className="time-picker-panel">
        <h2 id={`${id}-title`}>SELECT TIME</h2>
        <div className="time-picker-readout">
          <button type="button" className={phase === 'hour' ? 'selected' : ''} aria-label="Select hour" aria-pressed={phase === 'hour'} onClick={() => setPhase('hour')}>{draft.hour}</button>
          <span>:</span>
          <button type="button" className={phase === 'minute' ? 'selected' : ''} aria-label="Select minute" aria-pressed={phase === 'minute'} onClick={() => setPhase('minute')}>{draft.minute}</button>
          <span className="time-picker-period" role="group" aria-label="AM or PM">
            {(['AM', 'PM'] as const).map((period) => <button type="button" key={period} className={draft.period === period ? 'selected' : ''} aria-pressed={draft.period === period} onClick={() => setDraft({ ...draft, period })}>{period}</button>)}
          </span>
        </div>
        {keyboardMode ? <div className="time-picker-keyboard">
          <label>Hour<input type="text" inputMode="numeric" maxLength={2} value={draft.hour} onChange={(event) => setDraft({ ...draft, hour: event.target.value.replace(/\D/g, '').slice(0, 2) })}/></label>
          <label>Minute<input type="text" inputMode="numeric" maxLength={2} value={draft.minute} onChange={(event) => setDraft({ ...draft, minute: event.target.value.replace(/\D/g, '').slice(0, 2) })}/></label>
          {!valid && <small>Enter an hour from 1 to 12 and minutes from 00 to 59.</small>}
        </div> : <div className="time-picker-dial-wrap"><p>Select {phase}</p><div className="time-picker-dial" role="group" aria-label={`Select ${phase}`}>
          <svg viewBox="0 0 100 100" aria-hidden="true"><line x1="50" y1="50" x2={hand.x} y2={hand.y}/><circle cx="50" cy="50" r="1.5"/></svg>
          {values.map(({ label, value: dialValue }, index) => {
            const position = point(index);
            const selected = phase === 'hour' ? Number(draft.hour) === dialValue : Math.round(Number(draft.minute) / 5) % 12 * 5 === dialValue;
            return <button type="button" key={dialValue} className={selected ? 'selected' : ''}
              style={{ left: `${position.x}%`, top: `${position.y}%` }} aria-label={`Select ${phase} ${label}`} aria-pressed={selected}
              onClick={() => phase === 'hour'
                ? (setDraft({ ...draft, hour: pad(dialValue) }), setPhase('minute'))
                : setDraft({ ...draft, minute: pad(dialValue) })}>{label}</button>;
          })}
        </div></div>}
        <div className="time-picker-actions"><button type="button" className="time-picker-keyboard-toggle" aria-label={keyboardMode ? 'Use clock face' : 'Enter time with keyboard'} onClick={() => setKeyboardMode(!keyboardMode)}><Keyboard size={20}/></button>
          <span/><button type="button" onClick={() => dialog.current?.close()}>CANCEL</button><button type="button" disabled={!valid} onClick={commit}>OK</button></div>
      </div>
    </dialog>
    </>, document.body)}
  </>;
}
