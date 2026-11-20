import { BadgeCheck, ChevronDown, UserRound } from 'lucide-react';
import { completedVisitorCount, requiredVisitorFields, type VisitorInformation } from '../lib/visitorInformation';

export function VisitorInformationForm({ siteSlug, adults, children, visitors, onChange }: {
  siteSlug: string; adults: number; children: number; visitors: VisitorInformation[];
  onChange: (index: number, field: keyof VisitorInformation, value: string) => void;
}) {
  const fields = requiredVisitorFields(siteSlug);
  const total = adults + children;
  const visibleVisitors = visitors.slice(0, total);
  const complete = completedVisitorCount(visibleVisitors, siteSlug);
  const names: Record<keyof VisitorInformation, string> = { fullName: 'Full name', address: 'Complete address', gender: 'Gender', nationality: 'Nationality' };
  return <section className="visitor-information" aria-labelledby="visitor-information-title">
    <div className="visitor-information-heading"><span><h4 id="visitor-information-title">Visitor Information <span className="required-mark" aria-hidden="true">*</span></h4><p><span className="required-mark" aria-hidden="true">*</span> Required. One record per person; booking contact stays separate.</p></span><b>{complete}/{total} complete</b></div>
    <progress aria-label={`${complete} of ${total} visitor records complete`} max={total} value={complete}/>
    {complete < total && <p className="visitor-information-required-note">Complete all required visitor fields before continuing.</p>}
    {!fields.length && <p className="form-error" role="alert">Visitor requirements are not configured for this destination.</p>}
    <div className="visitor-information-list">{visibleVisitors.map((visitor, index) => {
      const adult = index < adults;
      const ready = fields.length > 0 && fields.every((field) => visitor[field].trim());
      const title = (adult ? 'Adult' : 'Child') + ' ' + (adult ? index + 1 : index - adults + 1);
      return <details className="visitor-information-card" key={index} open={index === 0}>
        <summary><span className="visitor-card-icon"><UserRound size={15}/></span><span className="visitor-card-name"><b>{title}</b><small>{visitor.fullName.trim() || 'Visitor details'}</small></span><span className={ready ? 'visitor-card-status complete' : 'visitor-card-status'}>{ready ? 'Complete' : 'Incomplete'}</span><ChevronDown className="visitor-card-chevron" size={16}/></summary>
        <div className="visitor-information-fields">
          {fields.map((field) => <label key={field}><span>{names[field]} <span className="required-mark" aria-hidden="true">*</span></span>
            {field === 'address' ? <textarea required value={visitor.address} maxLength={500} rows={2} autoComplete="street-address" onChange={(event) => onChange(index, field, event.target.value)}/> : field === 'gender' ? <select required value={visitor.gender} onChange={(event) => onChange(index, field, event.target.value)}><option value="">Choose gender</option><option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option><option value="prefer_not_to_say">Prefer not to say</option></select> : <input required value={visitor[field]} maxLength={field === 'fullName' ? 120 : 100} autoComplete={field === 'fullName' ? 'name' : 'country-name'} onChange={(event) => onChange(index, field, event.target.value)}/>}
          </label>)}
        </div>
      </details>;
    })}</div>
    {complete === total && total > 0 && <p className="visitor-information-done"><BadgeCheck size={14}/> All visitor records are ready.</p>}
  </section>;
}
