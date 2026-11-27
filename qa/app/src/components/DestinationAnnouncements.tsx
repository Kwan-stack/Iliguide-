import { useEffect, useState, type FormEvent } from 'react';
import { Megaphone, Pencil, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { db } from '../lib/iliguide';
import type { Profile, Site } from '../lib/iliguide';
import './DestinationAnnouncements.css';

type Category = 'general' | 'operating_hours' | 'closure' | 'booking' | 'safety' | 'guideline';
type Announcement = { id: string; site_id: string; announcement_group_id: string; title: string; body: string; category: Category; status: 'draft' | 'published'; published_at: string; expires_at: string | null; created_at: string };
type Draft = { title: string; body: string; category: Category; status: 'draft' | 'published'; expires_on: string };
const ALL_DESTINATIONS = '__all__';
const emptyDraft = (): Draft => ({ title: '', body: '', category: 'general', status: 'draft', expires_on: '' });
const manilaDate = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(value));
const expiryDate = (value: string | null) => value ? manilaDate(value) : '';

export function DestinationAnnouncementsPage({ role, sites, user, notify }: { role: Profile['role']; sites: Site[]; user: { id: string } | null; notify: (message: string) => void }) {
  const [siteId, setSiteId] = useState(sites.length > 1 ? ALL_DESTINATIONS : sites[0]?.id ?? '');
  const [rows, setRows] = useState<Announcement[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [expandedAnnouncements, setExpandedAnnouncements] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (siteId === ALL_DESTINATIONS && sites.length > 1) return;
    if (!sites.some((site) => site.id === siteId)) setSiteId(sites.length > 1 ? ALL_DESTINATIONS : sites[0]?.id ?? '');
  }, [siteId, sites]);

  useEffect(() => {
    if (!sites.length) { setRows([]); return; }
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const { data, error } = await db().from('site_announcements').select('id,site_id,announcement_group_id,title,body,category,status,published_at,expires_at,created_at')
          .in('site_id', sites.map((site) => site.id)).order('created_at', { ascending: false }).limit(Math.min(sites.length * 100, 1000));
        if (error) throw error;
        if (active) setRows((data ?? []) as Announcement[]);
      } catch {
        if (active) { setRows([]); notify('Could not load destination updates. Apply the latest database migration and try again.'); }
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [notify, reload, sites]);

  const resetForm = () => { setDraft(emptyDraft()); setEditingId(''); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const targets = siteId === ALL_DESTINATIONS ? sites : sites.filter((site) => site.id === siteId);
    if (!user || !targets.length) return;
    if (draft.expires_on && draft.expires_on < new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())) {
      notify('Choose an expiry date today or later.'); return;
    }
    setSaving(true);
    try {
      const existing = rows.find((row) => row.id === editingId);
      const payload = {
        title: draft.title.trim(),
        body: draft.body.trim(),
        category: draft.category,
        status: draft.status,
        published_at: draft.status === 'published' && existing?.status !== 'published' ? new Date().toISOString() : existing?.published_at ?? new Date().toISOString(),
        expires_at: draft.expires_on ? new Date(`${draft.expires_on}T23:59:59+08:00`).toISOString() : null,
      };
      if (editingId && existing) {
        const { data, error } = await db().from('site_announcements').update(payload)
          .eq('announcement_group_id', existing.announcement_group_id).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('No destination updates were changed.');
      } else {
        const announcementGroupId = crypto.randomUUID();
        const { error } = await db().from('site_announcements').insert(targets.map((target) => ({
          ...payload, site_id: target.id, announcement_group_id: announcementGroupId, created_by: user.id,
        })));
        if (error) throw error;
      }
      const savedAudience = existing ? audienceLabel(existing) : targets.length === 1 ? targets[0].name : `${targets.length} destinations`;
      notify(draft.status === 'published' ? `Destination update published to ${savedAudience}.` : 'Draft saved.');
      resetForm();
      setReload((value) => value + 1);
    } catch {
      notify('Could not save this destination update. Check destination access and try again.');
    } finally { setSaving(false); }
  };

  const edit = (row: Announcement) => {
    setEditingId(row.id);
    setDraft({ title: row.title, body: row.body, category: row.category, status: row.status, expires_on: expiryDate(row.expires_at) });
    document.querySelector('.destination-announcement-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const remove = async (row: Announcement) => {
    const audience = audienceLabel(row);
    if (!window.confirm(`Delete “${row.title}” from ${audience}?`)) return;
    try {
      const { error } = await db().from('site_announcements').delete().eq('announcement_group_id', row.announcement_group_id);
      if (error) throw error;
      if (editingId === row.id) resetForm();
      notify('Destination update deleted.');
      setReload((value) => value + 1);
    } catch { notify('Could not delete this destination update. Check destination access and try again.'); }
  };

  const audienceLabel = (row: Announcement) => {
    const targetIds = new Set(rows.filter((item) => item.announcement_group_id === row.announcement_group_id).map((item) => item.site_id));
    if (targetIds.size > 1) return targetIds.size === sites.length ? 'All destinations' : `${targetIds.size} destinations`;
    return sites.find((item) => targetIds.has(item.id))?.name ?? 'this destination';
  };
  const visibleRows = rows.filter((row) => siteId === ALL_DESTINATIONS || row.site_id === siteId);
  const groupedRows = [...new Map(visibleRows.map((row) => [row.announcement_group_id, row])).values()];
  const selectedAll = siteId === ALL_DESTINATIONS;
  const selectionValid = selectedAll && sites.length > 1 || sites.some((item) => item.id === siteId);
  const editingRow = rows.find((row) => row.id === editingId);
  const targetLabel = selectedAll ? `All ${sites.length} destinations` : editingRow ? audienceLabel(editingRow) : sites.find((item) => item.id === siteId)?.name;
  return <section className="dashboard-page section-wrap destination-announcements-page">
    <div className="dash-header"><div><span className="eyebrow"><span className="eyebrow-line"/> DESTINATION INFORMATION</span><h1>Destination <em>updates.</em></h1><p>Publish visitor announcements for destinations you manage.</p></div>
      <div className="announcement-page-actions">{(role === 'tourism_office' || sites.length > 1) && <label>Destination<select value={siteId} onChange={(event) => { setSiteId(event.target.value); resetForm(); }} aria-label="Destination for announcements">{sites.length > 1 && <option value={ALL_DESTINATIONS}>All destinations</option>}{sites.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <button className="btn btn-outline" onClick={() => setReload((value) => value + 1)} disabled={loading}><RefreshCw size={15}/> Refresh</button></div></div>
    {!sites.length || !selectionValid ? <div className="empty-card"><Megaphone size={28}/><h3>No managed destinations</h3><p>Update access follows the destinations assigned to your account.</p></div> : <div className="announcement-manager">
      <form className="destination-announcement-form" onSubmit={(event) => void save(event)} aria-busy={saving}>
        <div className="announcement-form-heading"><span><small>{targetLabel?.toUpperCase()}</small><h2>{editingId ? 'Edit destination update' : 'Create destination update'}</h2></span>{editingId && <button className="icon-btn" type="button" aria-label="Cancel editing" onClick={resetForm}><X size={17}/></button>}</div>
        <label>Title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required maxLength={160}/></label>
        <label>Message<textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} required maxLength={2000} rows={4}/></label>
        <div className="announcement-form-row"><label>Type<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as Category })}>
          <option value="general">General</option><option value="operating_hours">Operating hours</option><option value="closure">Closure</option><option value="booking">Booking</option><option value="safety">Safety</option><option value="guideline">Visitor guideline</option>
        </select></label><label>Visibility<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Draft['status'] })}><option value="draft">Draft</option><option value="published">Published</option></select></label><label>Expires (Asia/Manila)<input type="date" value={draft.expires_on} onChange={(event) => setDraft({ ...draft, expires_on: event.target.value })}/></label></div>
        <p className="field-hint">Published updates appear to visitors until expiry. Leave expiry blank to keep an update active until unpublished.</p>
        <div className="announcement-form-actions"><button className="btn btn-primary" disabled={saving || loading}>{draft.status === 'published' ? <Send size={15}/> : <Plus size={15}/>} {saving ? 'Saving…' : editingId ? 'Save changes' : draft.status === 'published' ? 'Publish update' : 'Save draft'}</button>{editingId && <button type="button" className="btn btn-outline" onClick={resetForm}>Cancel</button>}</div>
      </form>
      <section className="announcement-list" aria-labelledby="announcement-list-title"><div className="announcement-form-heading"><span><small>ANNOUNCEMENTS</small><h2 id="announcement-list-title">Updates for {selectedAll ? 'all destinations' : targetLabel}</h2></span><span className="announcement-count">{groupedRows.length}</span></div>
        {loading ? <p role="status">Loading destination updates…</p> : groupedRows.length ? groupedRows.map((row) => <article className="announcement-row" key={row.announcement_group_id}>
          <div><span className={`announcement-status announcement-status-${row.status}`}>{row.status}</span><small>{audienceLabel(row)} · {row.category.replace(/_/g, ' ')} · {new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' }).format(new Date(row.created_at))}{row.expires_at ? ` · Expires ${expiryDate(row.expires_at)}` : ''}</small><h3>{row.title}</h3><p id={`announcement-body-${row.announcement_group_id}`} className={`announcement-body${expandedAnnouncements.has(row.announcement_group_id) ? ' expanded' : ''}`}>{row.body}</p>{row.body.length > 220 && <button className="announcement-expand" aria-expanded={expandedAnnouncements.has(row.announcement_group_id)} aria-controls={`announcement-body-${row.announcement_group_id}`} onClick={() => setExpandedAnnouncements((current) => { const next = new Set(current); if (next.has(row.announcement_group_id)) next.delete(row.announcement_group_id); else next.add(row.announcement_group_id); return next; })}>{expandedAnnouncements.has(row.announcement_group_id) ? 'Close' : 'See more'}</button>}</div>
          <div className="announcement-row-actions"><button className="btn btn-outline" onClick={() => edit(row)} aria-label={`Edit ${row.title}`}><Pencil size={14}/> Edit</button><button className="btn btn-outline" onClick={() => void remove(row)} aria-label={`Delete ${row.title}`}><Trash2 size={14}/> Delete</button></div>
        </article>) : <div className="announcement-empty"><Megaphone size={25}/><b>No destination updates yet.</b><p>Save a draft or publish a message for visitors.</p></div>}
      </section>
    </div>}
  </section>;
}
