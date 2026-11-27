import { BadgeCheck, ChevronDown, UserRound } from 'lucide-react';
import { useState } from 'react';
import { completedVisitorCount, requiredVisitorFields, type VisitorField, type VisitorInformation } from '../lib/visitorInformation';

export function VisitorInformationForm({ siteSlug, adults, children, visitors, onChange, pwdEnabled = false, pwdCount = 0, onPwdChange, onCategoryChange, onPhotoChange, onPhotoRemove }: {
  siteSlug: string; adults: number; children: number; visitors: VisitorInformation[];
  onChange: (index: number, field: VisitorField, value: string) => void;
  pwdEnabled?: boolean; pwdCount?: number; onPwdChange?: (index: number, value: boolean) => void;
  onCategoryChange?: (index: number, value: string) => void;
  onPhotoChange?: (index: number, file: File, preview: string) => void;
  onPhotoRemove?: (index: number) => void;
}) {
  const fields = requiredVisitorFields(siteSlug);
  const total = adults + children;
  const visibleVisitors = visitors.slice(0, total);
  const complete = completedVisitorCount(visibleVisitors, siteSlug);
  const names: Record<VisitorField, string> = { fullName: 'Full name', address: 'Complete address', gender: 'Gender', nationality: 'Nationality' };
  const claimed = visibleVisitors.filter((visitor) => visitor.isPwd).length;
  const [fileErrors, setFileErrors] = useState<Record<number, string>>({});
  const selectPhoto = async (index: number, file?: File) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setFileErrors((current) => ({ ...current, [index]: 'Choose an image smaller than 5 MB.' })); return; }
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const valid = file.type === 'image/jpeg' && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
      || file.type === 'image/png' && header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47
      || file.type === 'image/webp' && String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
    if (!valid) { setFileErrors((current) => ({ ...current, [index]: 'Upload a valid JPG, PNG, or WEBP image.' })); return; }
    const preview = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setFileErrors((current) => { const next = { ...current }; delete next[index]; return next; });
    onPhotoChange?.(index, file, preview);
  };
  return <section className="visitor-information" aria-labelledby="visitor-information-title">
    <div className="visitor-information-heading"><span><h4 id="visitor-information-title">Visitor Information <span className="required-mark" aria-hidden="true">*</span></h4><p><span className="required-mark" aria-hidden="true">*</span> Required. One record per person; booking contact stays separate.</p></span><b>{complete}/{total} complete</b></div>
    <progress aria-label={`${complete} of ${total} visitor records complete`} max={total} value={complete}/>
    {complete < total && <p className="visitor-information-required-note">Complete all required visitor fields before continuing.</p>}
    {!fields.length && <p className="form-error" role="alert">Visitor requirements are not configured for this destination.</p>}
    <div className="visitor-information-list">{visibleVisitors.map((visitor, index) => {
      const adult = index < adults;
      const ready = fields.length > 0 && fields.every((field) => visitor[field].trim())
        && (!pwdEnabled || !visitor.isPwd || Boolean(visitor.disabilityCategory && visitor.pwdIdPhoto));
      const title = (adult ? 'Adult' : 'Child') + ' ' + (adult ? index + 1 : index - adults + 1);
      return <details className="visitor-information-card" key={index} open={index === 0}>
        <summary><span className="visitor-card-icon"><UserRound size={15}/></span><span className="visitor-card-name"><b>{title}</b><small>{visitor.fullName.trim() || 'Visitor details'}</small></span><span className={ready ? 'visitor-card-status complete' : 'visitor-card-status'}>{ready ? 'Complete' : 'Incomplete'}</span><ChevronDown className="visitor-card-chevron" size={16}/></summary>
        <div className="visitor-information-fields">
          {fields.map((field) => <label key={field}><span>{names[field]} <span className="required-mark" aria-hidden="true">*</span></span>
            {field === 'address' ? <textarea required value={visitor.address} maxLength={500} rows={2} autoComplete="street-address" onChange={(event) => onChange(index, field, event.target.value)}/> : field === 'gender' ? <select required value={visitor.gender} onChange={(event) => onChange(index, field, event.target.value)}><option value="">Choose gender</option><option value="female">Female</option><option value="male">Male</option><option value="non_binary">Non-binary</option><option value="prefer_not_to_say">Prefer not to say</option></select> : <input required value={visitor[field]} maxLength={field === 'fullName' ? 120 : 100} autoComplete={field === 'fullName' ? 'name' : 'country-name'} onChange={(event) => onChange(index, field, event.target.value)}/>}
          </label>)}
          {pwdEnabled && <fieldset className="visitor-pwd-fields"><legend>Disability discount</legend>
            <label className="visitor-pwd-check"><input type="checkbox" checked={visitor.isPwd} onChange={(event) => onPwdChange?.(index, event.target.checked)}/> Is this visitor claiming the PWD discount?</label>
            {visitor.isPwd && <div className="visitor-pwd-details">
              <label><span>Type of Disability <span className="required-mark" aria-hidden="true">*</span></span><select required value={visitor.disabilityCategory} onChange={(event) => onCategoryChange?.(index, event.target.value)}><option value="">Choose a category</option>
                <option value="deaf_hard_of_hearing">Deaf or Hard of Hearing</option><option value="intellectual">Intellectual Disability</option><option value="learning">Learning Disability</option><option value="mental">Mental Disability</option><option value="physical_orthopedic">Physical / Orthopedic Disability</option><option value="psychosocial">Psychosocial Disability</option><option value="speech_language">Speech and Language Impairment</option><option value="visual">Visual Disability</option><option value="cancer">Cancer</option><option value="rare_disease">Rare Disease</option><option value="other_manual_review">Other / Requires Manual Review</option>
              </select></label>
              <div className="visitor-pwd-upload"><b>Upload PWD ID Photo <span className="required-mark" aria-hidden="true">*</span></b><p>Upload a clear photo of your PWD ID for discount verification. No detailed medical diagnosis needed.</p>
                <small>Discount verification status: {visitor.pwdIdPhoto ? 'Ready to submit · authorized staff review required' : 'Not submitted'}</small>
                {visitor.pwdIdPreview && <img className="visitor-pwd-preview" src={visitor.pwdIdPreview} alt={`PWD ID photo preview for ${title}`}/>}
                <div><label className="btn btn-outline">{visitor.pwdIdPhoto ? 'Replace Photo' : 'Upload Photo'}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => { void selectPhoto(index, event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}/></label>{visitor.pwdIdPhoto && <button type="button" className="btn btn-quiet" onClick={() => onPhotoRemove?.(index)}>Remove Photo</button>}</div>
                {fileErrors[index] && <small className="visitor-pwd-error" role="alert">{fileErrors[index]}</small>}
                {visitor.pwdIdUploading && <progress aria-label={`Uploading PWD ID photo for ${title}`}/>}
                <small>JPG, PNG, or WEBP · up to 5 MB · private and visible only to you and authorized destination staff.</small>
                <button type="button" className="link-btn" onClick={() => onPwdChange?.(index, false)}>Continue without PWD discount</button>
              </div>
            </div>}
          </fieldset>}
        </div>
      </details>;
    })}</div>
    {pwdEnabled && <p className={claimed === pwdCount ? 'visitor-pwd-count matched' : 'visitor-pwd-count'} role="status">PWD claims: {claimed} of {pwdCount} selected. {claimed !== pwdCount && 'Update visitor selections to match the count above.'}</p>}
    {pwdEnabled && <p className="visitor-pwd-privacy">PWD ID photos support discount verification, remain private, and stay eligible for deletion after 30 days.</p>}
    {complete === total && total > 0 && <p className="visitor-information-done"><BadgeCheck size={14}/> All visitor records are ready.</p>}
  </section>;
}
