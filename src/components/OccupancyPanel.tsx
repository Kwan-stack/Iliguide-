import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarDays, RefreshCw } from 'lucide-react';
import { capacityStatus, isScheduledOpen, operatingStatus, scheduledCapacityStatus } from '../lib/capacity';
import { loadSiteCapacityForDate, type Site } from '../lib/iliguide';
import { useCapacityForDate } from '../lib/useCapacityForDate';
import { useCapacityRecommendations } from '../lib/useCapacityRecommendations';
import { useLiveCapacity } from '../lib/useLiveCapacity';
import './OccupancyPanel.css';

type Props = { site: Site; sites: Site[]; onOpen: (site: Site) => void; onBook: (site: Site) => void; onBookingAvailabilityChange?: (siteId: string, date: string, allowed: boolean, reason: string) => void; visitDate: string; setVisitDate: (date: string) => void; visitorCount: number };
const stamp = (value: string) => new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
}).format(new Date(value));

export default function OccupancyPanel({ site, sites, onOpen, onBook, onBookingAvailabilityChange, visitDate, setVisitDate, visitorCount }: Props) {
  const feed = useLiveCapacity(sites.filter((item) => item.status === 'published').map((item) => item.id));
  const occupancy = feed.rows[site.id] ?? null;
  const dateCapacity = useCapacityForDate(site.id, visitDate, feed.updatedAt, feed.state);
  const snapshot = ['ready', 'stale'].includes(dateCapacity.state) ? dateCapacity.data : null;
  const liveStatus = capacityStatus(['ready', 'stale'].includes(feed.state) ? occupancy : null);
  const crowd = snapshot ? scheduledCapacityStatus(snapshot) : liveStatus;
  const { recommendations, loading } = useCapacityRecommendations(site, sites, dateCapacity.state === 'ready' ? snapshot : null, visitDate, visitorCount, feed.updatedAt);
  const [showDetails, setShowDetails] = useState(false);
  const [activeRecommendationId, setActiveRecommendationId] = useState('');
  const [bookingSiteId, setBookingSiteId] = useState('');
  const [bookingError, setBookingError] = useState('');
  const carouselRef = useRef<HTMLDivElement>(null);
  const activeIndex = Math.max(0, recommendations.findIndex(({ site: item }) => item.id === activeRecommendationId));
  useEffect(() => {
    if (loading || !recommendations.length) return;
    const retainedIndex = recommendations.findIndex(({ site: item }) => item.id === activeRecommendationId);
    const nextIndex = retainedIndex >= 0 ? retainedIndex : 0;
    const nextId = recommendations[nextIndex].site.id;
    setActiveRecommendationId(nextId);
    if (carouselRef.current) carouselRef.current.scrollLeft = nextIndex * carouselRef.current.clientWidth;
  }, [loading, recommendations]);
  const limit = crowd.limit;
  const count = snapshot?.current_visitor_count ?? occupancy?.current_visitor_count;
  const projected = snapshot?.projected_visitor_count;
  const percent = snapshot ? crowd.percent : null;
  const remaining = snapshot && limit != null && projected != null ? Math.max(0, limit - projected) : null;
  const bookingFull = dateCapacity.state === 'ready' && snapshot != null && (snapshot.max_slot_remaining < visitorCount || snapshot.remaining_bookable_capacity < visitorCount);
  const statusLabel = dateCapacity.state === 'loading' ? 'Checking selected-date capacity…'
    : dateCapacity.state === 'unavailable' ? 'Selected-date capacity unavailable'
      : dateCapacity.state === 'stale' ? 'Capacity update delayed' : percent != null && percent >= 100 ? 'Full'
        : crowd.level === 'critical' ? 'Critical · approaching full capacity' : crowd.label;
  const isFull = percent != null && percent >= 100;
  const bookingAllowed = dateCapacity.state === 'ready' && snapshot != null && !isFull && !bookingFull;
  const bookingUnavailableReason = dateCapacity.state !== 'ready' ? 'Checking availability…' : isFull ? 'Fully booked for this date' : bookingFull ? 'No slot fits your group' : '';
  const panelLevel = dateCapacity.state === 'unavailable' ? 'unknown' : isFull ? 'full' : crowd.level;
  const showAlternatives = dateCapacity.state === 'ready' && snapshot != null && (crowd.level === 'critical' || isFull || bookingFull);
  const changeRecommendation = (offset: number) => {
    if (!recommendations.length) return;
    const next = (activeIndex + offset + recommendations.length) % recommendations.length;
    setRecommendation(recommendations[next].site.id);
  };
  const setRecommendation = (siteId: string) => {
    const index = recommendations.findIndex(({ site: item }) => item.id === siteId);
    if (index < 0) return;
    setActiveRecommendationId(siteId);
    carouselRef.current?.scrollTo({ left: index * (carouselRef.current?.clientWidth ?? 0), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  const syncCarouselIndex = (element: HTMLDivElement) => {
    const next = recommendations[Math.round(element.scrollLeft / element.clientWidth)];
    if (next) setActiveRecommendationId((current) => current === next.site.id ? current : next.site.id);
  };
  const bookAlternative = async (alternative: Site) => {
    setBookingSiteId(alternative.id);
    setBookingError('');
    try {
      const canAcceptBooking = alternative.status === 'published' && alternative.fee_information_confirmed
        && visitorCount <= alternative.max_per_booking && isScheduledOpen(alternative, visitDate);
      const capacity = canAcceptBooking ? await loadSiteCapacityForDate(alternative.id, visitDate) : null;
      const status = scheduledCapacityStatus(capacity);
      const eligible = capacity?.visit_date === visitDate
        && capacity.max_slot_remaining >= visitorCount
        && capacity.remaining_bookable_capacity >= visitorCount
        && status.percent != null && status.percent < 100 && status.level !== 'critical';
      if (!eligible) {
        setBookingError(`${alternative.name} no longer has enough available capacity for your group. Choose another destination or date.`);
        void feed.refresh();
        return;
      }
      onBook(alternative);
    } catch {
      setBookingError(`Could not verify ${alternative.name}'s latest availability. Try again.`);
      void feed.refresh();
    } finally {
      setBookingSiteId('');
    }
  };
  const messages = {
    available: 'Capacity is available for your selected date.',
    near: 'This destination is getting busy. Check remaining booking spaces before you reserve.',
    almost: 'This destination is approaching capacity. Consider a less crowded destination.',
    critical: 'This destination is nearing full capacity. Explore an available alternative.',
    full: 'This destination has reached its maximum capacity for your selected date. Choose another available date or an alternative destination.',
    unconfigured: 'Capacity limit is not configured. Recorded attendance is shown without a utilization percentage.',
    unknown: 'Capacity data is unavailable. Try refreshing.',
  };
  useEffect(() => { onBookingAvailabilityChange?.(site.id, visitDate, bookingAllowed, bookingUnavailableReason); }, [bookingAllowed, bookingUnavailableReason, onBookingAvailabilityChange, site.id, visitDate]);
  return <div className="occupancy-wrap">
    <section className={`occupancy-panel occupancy-${panelLevel}`} aria-label="Live destination capacity">
      <div className="occupancy-heading"><small>LIVE DESTINATION CAPACITY</small><button type="button" onClick={() => void feed.refresh()} aria-label="Refresh capacity"><RefreshCw size={15}/></button></div>
      <div className="occupancy-status"><span className="occupancy-dot"/><b>{statusLabel}</b></div>
      <div className="occupancy-metrics">
        <article><small>Currently inside</small><b>{count?.toLocaleString() ?? (feed.state === 'loading' ? '…' : '—')}</b><small>{liveStatus.percent != null ? `${Math.round(liveStatus.percent)}% of ${liveStatus.basis === 'estimate' ? 'estimated ' : ''}capacity now` : liveStatus.label}</small></article>
        <article><small>Reserved, not yet checked in</small><b>{snapshot?.reserved_visitor_count.toLocaleString() ?? (dateCapacity.state === 'loading' ? '…' : '—')}</b></article>
      </div>
      {percent != null && limit != null && projected != null && <>
        <div className="occupancy-progress-heading"><b>Projected capacity utilization</b><b>{Math.round(percent)}%</b></div>
        <div className="occupancy-progress" role="progressbar" aria-label="Projected capacity utilization" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(percent))}><i style={{ width: `${Math.min(100, percent)}%` }}/></div>
        <div className="occupancy-capacity-foot"><span>{remaining?.toLocaleString()} spaces remaining{crowd.basis === 'estimate' ? ' · estimate' : ''}</span><span>{limit.toLocaleString()} total capacity</span></div>
      </>}
      <div className="occupancy-booking-facts">
        <span><b>{snapshot?.remaining_bookable_capacity.toLocaleString() ?? '—'}</b> booking spaces for {visitDate}</span>
        <span><b>{snapshot?.arrivals_today.toLocaleString() ?? occupancy?.arrivals_today ?? '—'}</b> arrivals today</span>
        <span><b>{snapshot?.departures_today.toLocaleString() ?? occupancy?.departures_today ?? '—'}</b> departures today</span>
      </div>
      {showAlternatives && !bookingFull && <p className="occupancy-message">{isFull ? messages.full : messages[crowd.level]}</p>}
      {dateCapacity.state === 'stale' && <div className="occupancy-limit"><AlertTriangle size={16}/><span>Live updates interrupted. Showing last successful capacity data.</span></div>}
      {bookingFull && <div className="occupancy-limit"><AlertTriangle size={16}/><span>No open booking slot can fit your group on this date. Choose another date or an alternative destination.</span></div>}
      <label className="occupancy-visit-date"><span><CalendarDays size={15}/> Planned visit date</span><input type="date" value={visitDate} min={new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())} onChange={(event) => setVisitDate(event.target.value)}/></label>
      <details className="occupancy-details" open={showDetails} onToggle={(event) => setShowDetails(event.currentTarget.open)}>
        <summary>View capacity details</summary>
        <p>{isFull ? messages.full : messages[crowd.level]}</p>
        {crowd.basis === 'estimate' && <p>Provisional estimate; not an approved simultaneous-occupancy limit.</p>}
        <p>Includes confirmed online reservations and active payment holds. Personal visitor records are not shown.</p>
        <p>Destination status: {operatingStatus(site)}.</p>
      </details>
      <p className="occupancy-update">Last successful update: {feed.updatedAt ? stamp(feed.updatedAt) : 'Unavailable'}{snapshot?.updated_at ? ` · capacity changed ${stamp(snapshot.updated_at)}` : ''}</p>
    </section>
    {showAlternatives && <section className="occupancy-alternatives" aria-label="Alternative destinations">
      <div className="occupancy-alternatives-heading"><div><b>Explore alternative destinations</b><p>Similar destinations with open booking space for your group.</p></div>{loading && <span role="status">Updating</span>}</div>
      {recommendations.length ? <>
        <div className="occupancy-carousel" ref={carouselRef} role="region" aria-roledescription="carousel" aria-label="Recommended destinations" tabIndex={0}
          onKeyDown={(event) => { if (event.key === 'ArrowLeft') { event.preventDefault(); changeRecommendation(-1); } else if (event.key === 'ArrowRight') { event.preventDefault(); changeRecommendation(1); } }}
          onScroll={(event) => syncCarouselIndex(event.currentTarget)}>
          <div className="occupancy-carousel-track">
            {recommendations.map(({ site: item, capacity }, index) => {
              const status = scheduledCapacityStatus(capacity);
              const cover = item.images.find((image) => image.image_role === 'cover') ?? item.images[0];
              return <article className="occupancy-alternative" key={item.id} role="group" aria-roledescription="slide" aria-hidden={index !== activeIndex} aria-label={`${item.name}, ${index + 1} of ${recommendations.length}`}>
                {cover ? <img src={cover.public_url} alt={cover.alt_text || item.name} draggable={false}/> : <div className="occupancy-alternative-image-placeholder" aria-hidden="true"><CalendarDays size={28}/></div>}
                <div className="occupancy-alternative-details">
                  <div className="occupancy-alternative-title"><b>{item.name}</b><span className="occupancy-alternative-status">{status.label}</span></div>
                  <small className="occupancy-alternative-location">{item.address || 'Iligan City'}</small>
                  <div className="occupancy-alternative-progress-heading"><span>{Math.round(status.percent ?? 0)}% capacity utilization</span><b>{capacity.remaining_bookable_capacity.toLocaleString()} spaces left</b></div>
                  <div className="occupancy-alternative-progress" role="progressbar" aria-label={`${item.name} capacity utilization`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(status.percent ?? 0))}><i style={{ width: `${Math.min(100, status.percent ?? 0)}%` }}/></div>
                </div>
                <div className="occupancy-alternative-actions">
                  <button type="button" tabIndex={index === activeIndex ? 0 : -1} onClick={() => onOpen(item)}>View Destination</button>
                  <button type="button" tabIndex={index === activeIndex ? 0 : -1} disabled={bookingSiteId !== ''} onClick={() => void bookAlternative(item)}>{bookingSiteId === item.id ? 'Checking…' : <>Book This Instead <ArrowRight size={14}/></>}</button>
                </div>
              </article>;
            })}
          </div>
        </div>
        {bookingError && <p className="occupancy-alternative-error" role="alert">{bookingError}</p>}
        {recommendations.length > 1 && <div className="occupancy-carousel-controls" role="group" aria-label="Destination carousel controls">
          <div className="occupancy-carousel-pagination">{recommendations.map(({ site: item }, index) => <button key={item.id} type="button" aria-label={`Show ${item.name}`} aria-current={index === activeIndex ? 'true' : undefined} onClick={() => setRecommendation(item.id)}/>)}</div>
          <span className="occupancy-carousel-counter" aria-live="polite">{activeIndex + 1} of {recommendations.length}</span>
        </div>}
      </> : loading ? <div className="occupancy-carousel-loading" role="status">Checking destinations with availability for {visitDate}…</div> : <p>No alternative has verified capacity for this date and group. Try another date.</p>}
    </section>}
  </div>;
}
