import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Banknote, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Compass, CreditCard, Filter, Heart, MapPin, Menu, Search, ShieldCheck, Ticket as TicketIcon, UserRound, X } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from './lib/supabase';
import { createHold, db, invokeFunction, loadAssignments, loadProfile, loadSites, loadSlots, loadTravelerProfiles, money, timeLabel, type Booking, type CreatedHold, type Profile, type Site, type Slot, type StaffAssignment, type Ticket as IssuedTicket, type TravelerProfile } from './lib/iliguide';
import { type Party } from './lib/pendingReservation';
import { completedVisitorCount, emptyVisitorInformation, resizeVisitorInformation, visitorInformationComplete, visitorInformationPayload, type VisitorInformation } from './lib/visitorInformation';
import { bookingContactError } from './lib/bookingValidation';
import { useSilentLoad } from './lib/useSilentLoad';
import { VisitorInformationForm } from './components/VisitorInformationForm';
import { AuthDialog, type AuthMode } from './components/AuthDialog';
import { StaffWorkspaceShell } from './components/StaffWorkspaceShell';
import DestinationLocator from './components/DestinationLocator';
import OccupancyPanel from './components/OccupancyPanel';
import './components/DestinationMap.css';
import { gatekeeperPath, isGatekeeperPath, parseGatekeeperRoute, type GatekeeperPage } from './lib/gatekeeperRoutes';
import { staffPageForRole, type AppPage } from './lib/actorRoutes';
import { authSuccessPath, canShowVisitorAuthModal, destinationSlugFromPath, isAuthPath, isKnownAppPath, isWorkspacePath, pageFromPath, passwordRecoveryPath, staffLoginUrl, staffReturnPath, visitorAuthDismissPath, visitorLoginUrl, visitorReturnPath, visitorRoutePaths, workspaceRoutePaths, STAFF_LOGIN_PATH, VISITOR_LOGIN_PATH } from './lib/appRoutes';
const VisitorPages = lazy(() => import('./components/VisitorPages').then((module) => ({ default: module.VisitorPages })));
const StaffPages = lazy(() => import('./components/StaffPages').then((module) => ({ default: module.StaffPages })));
const DestinationMap = lazy(() => import('./components/DestinationMap'));

type Page = AppPage;
type StaffPage = Extract<Page, GatekeeperPage | 'Activity' | 'Slots and closures' | 'Staff and accounts' | 'Sites and staff'>;
const todayPh = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const timePh = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const destinationPhotos: Record<string, { src: string; author: string; source: string; license: string; licenseUrl: string }> = {
  'tinago-falls': { src: '/falls/tinago-waterfall.jpg', author: 'Muel04', source: 'https://commons.wikimedia.org/wiki/File:Tinago_falls_in_Iligan_City.jpg', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  'timoga-cold-springs': { src: '/falls/timoga-spring-pool.jpg', author: 'EcoVibe', source: 'https://commons.wikimedia.org/wiki/File:Mimars_Timoga_Spring_Pool_a_Natural_Spring.jpg', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  'mimbalot-falls': { src: '/falls/mimbalot-falls-real.jpg', author: 'KishonShrill', source: 'https://commons.wikimedia.org/wiki/File:Iligan-city-mimbalot-falls-center-bottom.jpg', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' },
  'sikyop-agri-tourism-adventure': { src: '/falls/sikyop-underground-river.jpg', author: 'Ada Marie Bahian / DOST Media Officer', source: 'https://pia.gov.ph/features/sikyop-agricultural-cooperative-growing-empowerment-in-the-highlands-of-rogongon/', license: 'PIA public-domain notice', licenseUrl: 'https://pia.gov.ph/features/sikyop-agricultural-cooperative-growing-empowerment-in-the-highlands-of-rogongon/' },
  'maria-cristina-falls': { src: '/falls/maria-cristina-falls.jpg', author: 'Rolly Magpayo', source: 'https://commons.wikimedia.org/wiki/File:Maria_Cristina_Falls_Agus_River.jpg', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  'maria-christina-falls': { src: '/falls/maria-cristina-falls.jpg', author: 'Rolly Magpayo', source: 'https://commons.wikimedia.org/wiki/File:Maria_Cristina_Falls_Agus_River.jpg', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
};
const destinationPhoto = (slug: string) => destinationPhotos[slug];
const isPasswordRecoveryUrl = () => new URLSearchParams(window.location.search).get('type') === 'recovery'
  || new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery';
const heroSlides = [
  { src: '/carousel/carousel1.webp', name: 'Tinago Falls', alt: 'Tinago Falls flowing through a forested gorge' },
  { src: '/carousel/carousel2.webp', name: 'Timoga Cold Spring', alt: 'Clear spring water at Timoga Cold Spring' },
  { src: '/carousel/carousel3.webp', name: 'Mimbalot Falls', alt: 'Mimbalot Falls surrounded by tropical greenery' },
  { src: '/carousel/carousel4.webp', name: 'Sikyop Underground Cave', alt: 'An underground cave attraction in Sikyop' },
] as const;
const savedSitesKey = (userId: string | null) => 'iliguide.saved-sites.' + (userId || 'guest');
const readSavedSiteIds = (userId: string | null): string[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(savedSitesKey(userId)) || '[]');
    return Array.isArray(saved) ? [...new Set(saved.filter((id): id is string =>
      typeof id === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id))) ] : [];
  } catch { return []; }
};
const isStaffPage = (page: Page): page is StaffPage => ['Overview', 'Reservations', 'Visitor Management', 'Scan and exit', 'Walk-in registration', 'Visitor Logbook', 'Capacity map', 'Duty details', 'Reports', 'Activity', 'Slots and closures', 'Staff and accounts', 'Sites and staff', 'Duty roster', 'Change password'].includes(page);

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const staffPasswordReset = location.pathname === STAFF_LOGIN_PATH && new URLSearchParams(location.search).get('mode') === 'reset';
  const [user, setUser] = useState<User | null>(null);
  const authUserId = useRef<string | null>(null);
  const [savedSiteIds, setSavedSiteIds] = useState<string[]>(() => readSavedSiteIds(null));
  const [profile, setProfile] = useState<Profile | null>(null);
  const [travelers, setTravelers] = useState<TravelerProfile[]>([]);
  const [assignments, setAssignments] = useState<StaffAssignment[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [sitesLoaded, setSitesLoaded] = useState(false);
  const [page, setPage] = useState<Page>(() => pageFromPath(location.pathname));
  const [siteId, setSiteId] = useState('');
  const [date, setDate] = useState(todayPh());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [party, setParty] = useState<Party>({ adults: 1, children: 0, pwd: 0 });
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'onsite'>('online');
  const [visitorInformation, setVisitorInformation] = useState<VisitorInformation[]>(() => emptyVisitorInformation(1));
  const [visitor, setVisitor] = useState({ name: '', email: '', phone: '' });
  const [selectedTravelerId, setSelectedTravelerId] = useState('');
  const [search, setSearch] = useState('');
  const [destinationQuery, setDestinationQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [authMode, setAuthMode] = useState<AuthMode>(() => new URLSearchParams(window.location.search).get('mode') === 'reset' || isPasswordRecoveryUrl() ? 'reset' : null);
  const [passwordRecovery, setPasswordRecovery] = useState(isPasswordRecoveryUrl);
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState('');
  const [dataError, setDataError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accountReady, setAccountReady] = useState(false);
  const [activeBooking, setActiveBooking] = useState<Booking | null>(null);
  const [activeTicket, setActiveTicket] = useState<IssuedTicket | null>(null);
  const [activeGuestCode, setActiveGuestCode] = useState('');

  useEffect(() => {
    try { Object.keys(localStorage).filter((key) => key.startsWith('iliguide.access.')).forEach((key) => localStorage.removeItem(key)); } catch { /* storage may be unavailable */ }
    try { localStorage.removeItem('iliguide.pending-reservation'); localStorage.removeItem('iliguide.pending-visitor-information'); } catch { /* storage may be unavailable */ }
  }, []);

  const staffRole = user && profile?.account_status === 'active' && profile.role !== 'visitor' ? profile.role : null;
  const role: Profile['role'] = profile?.account_status === 'active' ? profile.role : 'visitor';
  const activeSite = sites.find((site) => site.id === siteId) ?? null;
  const slotScope = `${activeSite?.id ?? 'no-site'}:${date}`;
  const previousSlotScope = useRef(slotScope);
  const [slotsLoading, finishSlotsLoading] = useSilentLoad(slotScope);
  const gatekeeperAssignments = assignments.filter((assignment) => assignment.staff_role === 'gatekeeper' && assignment.is_active);
  const assignedGatekeeperSite = gatekeeperAssignments.length === 1
    ? sites.find((site) => site.id === gatekeeperAssignments[0].site_id) ?? null : null;
  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 4000);
  }, []);
  const go = useCallback((next: Page) => {
    const allowed = staffPageForRole(role, next);
    if (allowed === 'Account' && !user) {
      setPage('Visitor login');
      navigate(visitorLoginUrl('/account'));
      setMobileNav(false);
      return;
    }
    setPage(allowed);
    if (role === 'gatekeeper') {
      if (assignedGatekeeperSite) navigate(gatekeeperPath(assignedGatekeeperSite.slug, allowed as GatekeeperPage));
    } else if (role === 'site_admin' || role === 'tourism_office') {
      navigate(workspaceRoutePaths[allowed] ?? '/workspace');
    } else if (allowed === 'Destination') {
      const slug = activeSite?.slug;
      navigate(slug ? `/destinations/${encodeURIComponent(slug)}` : '/');
    } else navigate(visitorRoutePaths[allowed] ?? '/');
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeSite?.slug, assignedGatekeeperSite, navigate, role, user]);

  useEffect(() => {
    setVisitorInformation((current) => resizeVisitorInformation(current, party.adults + party.children));
  }, [party.adults, party.children]);

  useEffect(() => {
    if (previousSlotScope.current !== slotScope) setSlots([]);
    previousSlotScope.current = slotScope;
  }, [slotScope]);

  const reloadSites = useCallback(async (nextRole: Profile['role'] = 'visitor', nextAssignments: StaffAssignment[] = []) => {
    if (!supabaseConfigured) { setSites([]); setSitesLoaded(true); return; }
    try {
      const rows = await loadSites(nextRole !== 'visitor');
      setSites(rows);
      setSitesLoaded(true);
      setDataError('');
      const permitted = nextRole === 'visitor' ? rows : rows.filter((site) =>
        nextRole === 'tourism_office' || nextAssignments.some((assignment) => assignment.site_id === site.id),
      );
      setSiteId((current) => permitted.some((site) => site.id === current) ? current : permitted[0]?.id ?? '');
    } catch (error) {
      setSitesLoaded(true);
      setDataError(error instanceof Error ? error.message : 'Could not load destinations.');
    }
  }, []);

  const applyUser = useCallback(async (nextUser: User | null) => {
    authUserId.current = nextUser?.id ?? null;
    setAccountReady(false);
    setUser(nextUser);
    if (nextUser) setPage((current) => current === 'Landing' ? 'Discover' : current);
    if (!nextUser) {
      setProfile(null);
      setAssignments([]);
      setTravelers([]);
      setVisitor({ name: '', email: '', phone: '' });
      setActiveBooking(null);
      setActiveTicket(null);
      setActiveGuestCode('');
      setAccountReady(true);
      return;
    }
    try {
      const nextProfile = await loadProfile(nextUser.id);
      setProfile(nextProfile);
      if (nextProfile?.account_status === 'active' && nextProfile.role !== 'visitor') {
        void invokeFunction<{ accepted: number }>('accept-staff-invitation', {}).catch((error) => {
          console.warn('Could not update staff invitation status', error);
        });
      }
      setVisitor({
        name: nextProfile?.full_name || String(nextUser.user_metadata?.full_name ?? ''),
        email: nextUser.email ?? '',
        phone: nextProfile?.phone ?? String(nextUser.user_metadata?.phone ?? ''),
      });
      const nextAssignments = nextProfile && nextProfile.role !== 'visitor'
        ? await loadAssignments(nextUser.id) : [];
      const nextTravelers = nextProfile?.role === 'visitor' ? await loadTravelerProfiles(nextUser.id) : [];
      setAssignments(nextAssignments);
      setTravelers(nextTravelers);
      await reloadSites(nextProfile?.account_status === 'active' ? nextProfile.role : 'visitor', nextAssignments);
    } catch (error) {
      setDataError(error instanceof Error ? error.message : 'Could not load the account.');
    } finally {
      setAccountReady(true);
    }
  }, [reloadSites]);

  useEffect(() => {
    const auth = supabase;
    if (!auth) { setAccountReady(true); return; }
    let active = true;
    void auth.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (!active) return;
      authUserId.current = data.session?.user.id ?? null;
      void applyUser(data.session?.user ?? null);
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.slice(1));
      const callbackError = url.searchParams.get('error_description') || url.searchParams.get('error')
        || hash.get('error_description') || hash.get('error');
      let changed = false;
      for (const key of ['error', 'error_code', 'error_description']) {
        if (url.searchParams.has(key)) { url.searchParams.delete(key); changed = true; }
        if (hash.has(key)) { hash.delete(key); changed = true; }
      }
      if (changed) {
        url.hash = hash.toString() ? '#' + hash.toString() : '';
        window.history.replaceState(window.history.state, '', url.toString());
      }
      if (callbackError) { setAuthMode('login'); notify(callbackError); }
    }).catch(() => {
      if (active) {
        setAccountReady(true);
        setAuthMode('login');
        notify('Could not restore the sign-in session. Please log in again.');
      }
    });
    const { data: { subscription } } = auth.auth.onAuthStateChange((event, session) => {
      if (active && ['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED', 'PASSWORD_RECOVERY'].includes(event)) {
        authUserId.current = session?.user.id ?? null;
        setAccountReady(false);
        if (event === 'SIGNED_IN') setAuthMode(null);
        if (event === 'PASSWORD_RECOVERY') { setPasswordRecovery(true); setAuthMode('reset'); }
        if (event === 'SIGNED_OUT') setPasswordRecovery(false);
        window.setTimeout(() => { if (active) void applyUser(session?.user ?? null); }, 0);
      }
    });
    const syncSession = () => {
      if (document.visibilityState !== 'visible') return;
      void auth.auth.getSession().then(({ data, error }) => {
        const nextUser = data.session?.user ?? null;
        if (!active || error || (nextUser?.id ?? null) === authUserId.current) return;
        authUserId.current = nextUser?.id ?? null;
        if (nextUser) setAuthMode(null);
        void applyUser(nextUser);
      }).catch(() => {});
    };
    window.addEventListener('focus', syncSession);
    document.addEventListener('visibilitychange', syncSession);
    return () => {
      active = false;
      subscription.unsubscribe();
      window.removeEventListener('focus', syncSession);
      document.removeEventListener('visibilitychange', syncSession);
    };
  }, [applyUser, notify]);

  useEffect(() => { void reloadSites(role, assignments); }, [role, assignments, reloadSites]);

  useEffect(() => {
    if (!accountReady) return;
    if (passwordRecovery && user) {
      const recoveryRole = profile?.role ?? 'visitor';
      const resetPath = passwordRecoveryPath(recoveryRole);
      setAuthMode('reset');
      setPage(recoveryRole === 'visitor' ? 'Visitor login' : 'Staff login');
      if (`${location.pathname}${location.search}` !== resetPath) navigate(resetPath, { replace: true });
      return;
    }
    if (staffPasswordReset) { setPage('Staff login'); return; }
    const path = location.pathname;
    const workspacePath = isWorkspacePath(path);
    const gatekeeperPathRequested = isGatekeeperPath(path);
    if (!user) {
      if (workspacePath || gatekeeperPathRequested) {
        setPage('Staff login');
        setAuthMode('login');
        if (path !== STAFF_LOGIN_PATH) navigate(staffLoginUrl(path), { replace: true });
      } else {
        if (!isKnownAppPath(path)) {
          setPage('Landing');
          navigate('/', { replace: true });
          return;
        }
        const routePage = pageFromPath(path);
        if (path === VISITOR_LOGIN_PATH) {
          const nextPath = visitorAuthDismissPath(new URLSearchParams(location.search).get('next'));
          setPage(pageFromPath(nextPath));
          setAuthMode((current) => current ?? 'login');
          const slug = destinationSlugFromPath(nextPath);
          const destination = sites.find((site) => site.slug === slug);
          if (destination) setSiteId(destination.id);
          return;
        }
        setPage(routePage);
        if (routePage === 'Staff login') setAuthMode((current) => current ?? 'login');
        if (routePage === 'Destination') {
          const slug = destinationSlugFromPath(path);
          const destination = sites.find((site) => site.slug === slug);
          if (destination) setSiteId(destination.id);
          else if (sitesLoaded) { setPage('Discover'); navigate('/', { replace: true }); }
        }
      }
      return;
    }

    if (role === 'visitor') {
      if (workspacePath || gatekeeperPathRequested || path === STAFF_LOGIN_PATH) {
        setPage('Staff login');
        if (path !== STAFF_LOGIN_PATH) navigate(staffLoginUrl(path), { replace: true });
        return;
      }
      if (!isKnownAppPath(path)) {
        setPage('Discover');
        navigate('/', { replace: true });
        return;
      }
      if (path === VISITOR_LOGIN_PATH) {
        const nextPath = visitorReturnPath(new URLSearchParams(location.search).get('next'));
        const nextPage = pageFromPath(nextPath);
        setPage(nextPage === 'Landing' ? 'Discover' : nextPage);
        const slug = destinationSlugFromPath(nextPath);
        const destination = sites.find((site) => site.slug === slug);
        if (destination) setSiteId(destination.id);
        navigate(nextPath, { replace: true });
        return;
      }
      const routePage = pageFromPath(path);
      setPage(routePage === 'Landing' ? 'Discover' : routePage);
      if (routePage === 'Destination') {
        const slug = destinationSlugFromPath(path);
        const destination = sites.find((site) => site.slug === slug);
        if (destination) setSiteId(destination.id);
        else if (sitesLoaded) { setPage('Discover'); navigate('/', { replace: true }); }
      }
      return;
    }

    if (role === 'gatekeeper') {
      if (workspacePath || gatekeeperAssignments.length !== 1 || !assignedGatekeeperSite) {
        setSiteId('');
        setPage('Overview');
        if (path !== '/gatekeeper/access') navigate('/gatekeeper/access', { replace: true });
        return;
      }
      const requestedPath = isAuthPath(path) ? staffReturnPath(new URLSearchParams(location.search).get('next')) : path;
      const route = parseGatekeeperRoute(requestedPath);
      if (!route || route.siteSlug !== assignedGatekeeperSite.slug) {
        setSiteId(assignedGatekeeperSite.id);
        setPage('Overview');
        navigate(gatekeeperPath(assignedGatekeeperSite.slug, 'Overview'), { replace: true });
        return;
      }
      const nextPage = staffPageForRole(role, route.page) as GatekeeperPage;
      setSiteId(assignedGatekeeperSite.id);
      setPage(nextPage);
      if (nextPage !== route.page) navigate(gatekeeperPath(assignedGatekeeperSite.slug, nextPage), { replace: true });
      return;
    }

    const requestedPath = isAuthPath(path) ? staffReturnPath(new URLSearchParams(location.search).get('next')) || '/workspace' : path;
    if (!isWorkspacePath(requestedPath)) {
      setPage('Overview');
      navigate('/workspace', { replace: true });
      return;
    }
    const requestedPage = pageFromPath(requestedPath);
    const nextPage = staffPageForRole(role, requestedPage);
    setPage(nextPage);
    const nextPath = workspaceRoutePaths[nextPage] ?? '/workspace';
    if (nextPath !== path) navigate(nextPath, { replace: true });
  }, [accountReady, assignedGatekeeperSite, gatekeeperAssignments.length, location.pathname, location.search, navigate, notify, passwordRecovery, profile, role, sites, sitesLoaded, staffPasswordReset, user]);

  useEffect(() => {
    const slug = destinationSlugFromPath(location.pathname);
    if (!slug || !sites.length) return;
    const destination = sites.find((site) => site.slug === slug);
    if (destination) setSiteId(destination.id);
  }, [location.pathname, sites]);

  /* Protected staff routes use their own sign-in entry point. */
  useEffect(() => {
    if (!user && (isWorkspacePath(location.pathname) || isGatekeeperPath(location.pathname) || isAuthPath(location.pathname))) {
      setAuthMode((current) => current ?? 'login');
    }
  }, [location.pathname, user]);

  useEffect(() => {
    if (!user) { setSavedSiteIds(readSavedSiteIds(null)); return; }
    let active = true;
    const localIds = [...new Set([...readSavedSiteIds(user.id), ...readSavedSiteIds(null)])];
    void (async () => {
      const { data, error } = await db().from('visitor_saved_sites').select('site_id').eq('user_id', user.id);
      if (error) throw error;
      const validLocalIds = localIds.length
        ? await db().from('tourism_sites').select('id').in('id', localIds).then(({ data: rows, error: siteError }) => {
            if (siteError) throw siteError;
            return (rows ?? []).map((row) => row.id as string);
          })
        : [];
      if (validLocalIds.length) {
        const { error: saveError } = await db().from('visitor_saved_sites').upsert(
          validLocalIds.map((site_id) => ({ user_id: user.id, site_id })),
          { onConflict: 'user_id,site_id', ignoreDuplicates: true },
        );
        if (saveError) throw saveError;
      }
      const merged = [...new Set([...(data ?? []).map((row) => row.site_id as string), ...validLocalIds])];
      if (!active) return;
      setSavedSiteIds(merged);
      try {
        localStorage.setItem(savedSitesKey(user.id), JSON.stringify(merged));
        localStorage.removeItem(savedSitesKey(null));
      } catch { /* storage may be unavailable */ }
    })().catch((error) => {
      if (active) { setSavedSiteIds(localIds); notify(error instanceof Error ? error.message : 'Saved places could not sync.'); }
    });
    return () => { active = false; };
  }, [user?.id]);

  const toggleSavedSite = async (siteId: string) => {
    const saved = savedSiteIds.includes(siteId);
    if (user) {
      const result = saved
        ? await db().from('visitor_saved_sites').delete().eq('user_id', user.id).eq('site_id', siteId)
        : await db().from('visitor_saved_sites').upsert({ user_id: user.id, site_id: siteId }, { onConflict: 'user_id,site_id', ignoreDuplicates: true });
      if (result.error) { notify(result.error.message); return; }
    }
    const next = saved ? savedSiteIds.filter((id) => id !== siteId) : [...savedSiteIds, siteId];
    setSavedSiteIds(next);
    try { localStorage.setItem(savedSitesKey(user?.id ?? null), JSON.stringify(next)); } catch { /* storage may be unavailable */ }
  };

  useEffect(() => {
    if (!activeSite || page !== 'Destination') {
      if (!activeSite) { setSlots([]); finishSlotsLoading(); }
      return;
    }
    if (!supabaseConfigured) { setSlots([]); finishSlotsLoading(); return; }
    let active = true;
    void loadSlots(activeSite.id, date, date)
      .then((rows) => { if (active) setSlots(rows); })
      .catch((error) => { if (active) setDataError(error instanceof Error ? error.message : 'Could not load available times.'); })
      .finally(() => { if (active) finishSlotsLoading(); });
    return () => { active = false; };
  }, [activeSite?.id, date, finishSlotsLoading, page]);

  const permittedSites = useMemo(() => role === 'visitor' || role === 'tourism_office'
    ? sites
    : role === 'gatekeeper' && assignments.filter((assignment) => assignment.staff_role === 'gatekeeper' && assignment.is_active).length !== 1
      ? [] : sites.filter((site) => assignments.some((assignment) => assignment.site_id === site.id)), [assignments, role, sites]);
  const categories = useMemo(() => ['All', ...new Set(sites.map((site) => site.category))], [sites]);
  const visibleSites = useMemo(() => permittedSites.filter((site) =>
    (category === 'All' || site.category === category) &&
    (site.name + ' ' + site.address + ' ' + site.category).toLowerCase().includes(search.toLowerCase()),
  ), [category, permittedSites, search]);
  const destinationSites = useMemo(() => permittedSites.filter((site) => category === 'All' || site.category === category), [category, permittedSites]);
  const today = todayPh();
  const availableSlots = (slotsLoading ? [] : slots).filter((slot) => slot.status === 'open' && slot.remaining_capacity >= party.adults + party.children
    && (slot.slot_date > today || (slot.slot_date === today && slot.ends_at.slice(0, 5) > timePh())));
  const selectedSlot = availableSlots[0]?.slot_id ?? '';
  const bookingTotal = activeSite ? activeSite.adult_fee * party.adults + activeSite.child_fee * party.children - activeSite.adult_fee * activeSite.pwd_discount_percent / 100 * party.pwd : 0;

  const openSite = (site: Site) => {
    setSiteId(site.id);
    setParty({ adults: 1, children: 0, pwd: 0 });
    setVisitorInformation(emptyVisitorInformation(1));
    setPage('Destination');
    navigate(`/destinations/${encodeURIComponent(site.slug)}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const reserve = async () => {
    if (!supabaseConfigured || !supabase) { notify('Add the Supabase project URL and publishable key to .env.local first.'); return; }
    if (!user) { navigate(visitorLoginUrl(location.pathname)); return; }
    if (profile?.account_status !== 'active' || profile.role !== 'visitor') { notify('Only active visitor accounts can make a reservation.'); return; }
    if (!activeSite || !selectedSlot) { notify('No booking capacity is available for this date.'); return; }
    if (!activeSite.fee_information_confirmed) { notify('Reservations are unavailable until this destination confirms its current fees.'); return; }
    if (!visitorInformationComplete(visitorInformation, activeSite.slug)) { notify('Complete visitor information for everyone in the reservation.'); return; }
    if (party.adults < 1 || party.adults + party.children > activeSite.max_per_booking || party.pwd > party.adults + party.children) {
      notify('Check the visitor count for this destination.'); return;
    }
    if (!accountReady) { notify('Checking your account details. Try again in a moment.'); return; }
    const contactError = bookingContactError(visitor.name, visitor.email, visitor.phone);
    if (contactError) { notify(contactError); return; }
    setBusy(true);
    let createdHold: CreatedHold | null = null;
    let confirmed = false;
    try {
      const hold: CreatedHold = await createHold({
        slotId: selectedSlot,
        name: visitor.name.trim(),
        adults: party.adults,
        children: party.children,
        pwdCount: party.pwd,
        email: visitor.email.trim(),
        phone: visitor.phone.trim(),
        visitors: visitorInformationPayload(visitorInformation, activeSite.slug),
      });
      createdHold = hold;
      const token = hold.guest_access_token ?? '';
      setActiveGuestCode(token);
      if (hold.total_amount <= 0) {
        const { error } = await db().rpc('confirm_reservation_without_payment', { p_booking_id: hold.booking_id });
        if (error) throw error;
        confirmed = true;
      } else if (paymentMethod === 'onsite') {
        const { error } = await db().rpc('confirm_onsite_booking', { p_booking_id: hold.booking_id });
        if (error) throw error;
        confirmed = true;
      } else {
        const { checkout_url } = await invokeFunction<{ checkout_url: string }>('paymongo-checkout', {
          booking_reference: hold.booking_reference, guest_access_token: token || null,
        });
        window.location.assign(checkout_url);
        return;
      }
      setVisitorInformation(emptyVisitorInformation(party.adults + party.children));
      if (visitor.email.trim()) void invokeFunction('send-booking-email', {
        booking_reference: hold.booking_reference, event: 'confirmed',
      }).catch(() => notify('Reservation confirmed, but the confirmation email could not be sent.'));
      const { data, error: lookupError } = await db().rpc('lookup_booking', {
        p_booking_reference: hold.booking_reference,
        p_guest_access_token: token || null,
      });
      if (lookupError) throw lookupError;
      const booking = ((data ?? []) as Booking[])[0];
      if (!booking) throw new Error('Reservation confirmed, but booking details could not be loaded.');
      setActiveBooking(booking);
      go('Bookings');
      notify(hold.total_amount <= 0 ? 'Free reservation confirmed.' : 'Reservation confirmed. Pay at the destination when you arrive.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create the booking hold.';
      if (confirmed) { setActiveBooking(null); go('Bookings'); }
      notify(message + (createdHold && !confirmed ? ' The reservation hold expires in ten minutes.' : ''));
    } finally { setBusy(false); }
  };

  const signOut = async () => {
    if (!supabase) return;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setAuthMode(null);
      setPage(role === 'visitor' ? 'Discover' : 'Staff login');
      navigate(role === 'visitor' ? '/' : STAFF_LOGIN_PATH, { replace: true });
      notify('You are signed out.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not sign out. Try again.');
    }
  };
  const makeTicket = async (booking: Booking, token = activeGuestCode) => {
    setBusy(true);
    try {
      const ticket = await invokeFunction<{ token: string; booking: Booking }>('ticket', {
        booking_reference: booking.booking_reference,
        guest_access_token: token || null,
      });
      setActiveTicket(ticket as unknown as IssuedTicket);
      setActiveBooking({ ...booking, ...ticket.booking });
      go('Tickets');
    } catch (error) { notify(error instanceof Error ? error.message : 'Could not issue the ticket.'); }
    finally { setBusy(false); }
  };

  const nav = role === 'visitor'
    ? [['Discover', 'Discover'], ['Destinations', 'Destinations'], ['Destination map', 'Destination map'], ['How it works', 'How it works'], ['My bookings', 'Bookings']] as const
    : [];
  const staffLoginRoute = location.pathname === STAFF_LOGIN_PATH;
  const visitorLoginRoute = location.pathname === VISITOR_LOGIN_PATH;
  const authPage = staffLoginRoute;
  const authNext = new URLSearchParams(location.search).get('next');
  const authReturnTo = `${window.location.origin}${location.pathname}${location.search}`;
  const visitorAuthModalOpen = canShowVisitorAuthModal(location.pathname) && !staffRole
    && (!passwordRecovery || profile?.role === 'visitor')
    && (authMode !== null || (!user && visitorLoginRoute));

  if (!accountReady && !user && (isWorkspacePath(location.pathname) || isGatekeeperPath(location.pathname))) {
    return <div className="office-app-loading" role="status" aria-live="polite">
      <span className="office-app-spinner" aria-hidden="true"/><b>Checking office access</b>
      <p>Verifying the current session before opening staff pages.</p>
    </div>;
  }

  if (user && !accountReady) return <div className="office-app-loading" role="status" aria-live="polite">
    <span className="office-app-spinner" aria-hidden="true"/><b>Opening your Iliguide workspace</b>
    <p>Checking your account role and access before loading its pages.</p>
  </div>;

  if (user && accountReady && !profile) return <div className="office-app-account-error" role="alert">
    <span className="office-app-mark"><img src="/iliguide-logo.svg" alt=""/></span>
    <h1>Account access could not be loaded</h1>
    <p>Your session is active, but Iliguide could not confirm the account role. Retry the profile lookup or sign out before continuing.</p>
    <div className="office-app-account-actions"><button className="btn btn-outline" onClick={() => void applyUser(user)}>Retry account check</button>
      <button className="btn btn-primary" onClick={() => void signOut()}>Sign out</button></div>
  </div>;

  if (user && staffRole && !staffPasswordReset) {
    const staffPage = isStaffPage(page) ? page : 'Overview';
    const staffHomePath = staffRole === 'gatekeeper' && assignedGatekeeperSite
      ? gatekeeperPath(assignedGatekeeperSite.slug, 'Overview') : '/workspace';
    return <StaffWorkspaceShell role={staffRole} homePath={staffHomePath} dataError={dataError}
      onRetry={() => { setDataError(''); void reloadSites(role, assignments); }} toast={toast}
      onSignOut={() => { void signOut(); }}>
      <Suspense fallback={<section className="section-wrap loading-screen">Loading workspace…</section>}>
        <StaffPages page={staffPage} role={staffRole} sites={permittedSites} siteId={siteId} setSiteId={setSiteId}
          assignments={assignments} notify={notify} busy={busy} setBusy={setBusy}
          refresh={() => { void reloadSites(role, assignments); }} go={go} user={user}/>
      </Suspense>
    </StaffWorkspaceShell>;
  }

  return <div className={page === 'Landing' ? 'app-shell landing-shell' : authPage ? 'app-shell auth-shell' : 'app-shell'}>
    <header className={page === 'Landing' ? 'topbar landing-topbar' : authPage ? 'topbar auth-topbar' : 'topbar'}>
      <Link className="brand" to={authPage ? STAFF_LOGIN_PATH : '/'} onClick={authPage ? undefined : (event) => { event.preventDefault(); go('Discover'); }}>
        <span className="brand-mark"><img src="/iliguide-logo.svg" alt=""/></span><span>Iliguide</span>
      </Link>
      {!authPage && role === 'visitor' && <button className="mobile-menu icon-btn" onClick={() => setMobileNav(!mobileNav)} aria-label="Toggle navigation">{mobileNav ? <X/> : <Menu/>}</button>}
      {!authPage && role === 'visitor' && <nav className={mobileNav ? 'main-nav open' : 'main-nav'}>{nav.map(([label, target]) =>
        <button key={label} aria-current={page === target ? 'page' : undefined} onClick={() => { go(target as Page); setMobileNav(false); }}>{label}</button>)}</nav>
      }
      <div className="header-actions">{authPage
        ? <Link className="link-btn" to="/">Explore Iligan</Link>
        : role === 'visitor'
        ? user
          ? <><button className={page === 'Account' ? 'profile-nav-btn active' : 'profile-nav-btn'} aria-label="Open profile" title="Profile" aria-current={page === 'Account' ? 'page' : undefined} onClick={() => go('Account')}><span className="profile-nav-icon"><UserRound size={18}/></span><span className="profile-nav-label">My account</span></button><button className="link-btn" onClick={() => void signOut()}>Log out</button></>
          : <><button className="link-btn" onClick={() => setAuthMode('signup')}>Sign up</button><Link className="btn btn-primary btn-sm header-auth-login" to={visitorLoginUrl(page === 'Discover' ? '/discover' : location.pathname)}>Log in</Link></>
        : <><span className="role-pill"><span className="status-dot"/>{role.replace('_', ' ')}</span><button className="link-btn" onClick={signOut}>Log out</button></>}
      </div>
    </header>
    {dataError && <div className="connection-banner" role="status"><ShieldCheck size={16}/><span>{dataError}</span><button onClick={() => { setDataError(''); void reloadSites(role, assignments); }}>Retry</button></div>}
    {!supabaseConfigured && <div className="connection-banner"><ShieldCheck size={16}/><span>Add Supabase URL and publishable key to connect live data.</span></div>}

    <main>{authPage
      ? user && !staffPasswordReset
        ? <section className="auth-page auth-page-staff"><section className="auth-page-card" aria-labelledby="staff-access-title">
            <span className="eyebrow"><span className="eyebrow-line"/> ILIGUIDE STAFF ACCESS</span>
            <h2 id="staff-access-title">This account has no office access.</h2>
            <p>{profile?.account_status === 'active' ? 'Sign out and use an account assigned by the Tourism Office.' : 'Staff access is inactive. Contact the Tourism Office to confirm your account.'}</p>
            <button className="btn btn-primary btn-wide" onClick={() => void signOut()}>Sign out and switch account <ArrowRight size={16}/></button>
          </section></section>
        : <AuthDialog mode={authMode ?? (staffPasswordReset ? 'reset' : 'login')} audience="staff" presentation="page"
            onClose={() => {
              setPasswordRecovery(false);
              setAuthMode(null);
              navigate(staffRole === 'gatekeeper' && assignedGatekeeperSite
                ? gatekeeperPath(assignedGatekeeperSite.slug, 'Overview')
                : authSuccessPath('staff', authNext), { replace: true });
            }}
            onMode={setAuthMode} initialVisitor={visitor} redirectTo={authReturnTo}/>
      : <Suspense fallback={<section className="section-wrap loading-screen">Loading workspace…</section>}>
      {page === 'Landing' && <LandingPage onExplore={() => go('Discover')}/>}
      {page === 'Discover' && role !== 'gatekeeper' && <HomePage
        sites={visibleSites} destinationOptions={permittedSites} allCount={sites.length} categories={categories} category={category}
        setCategory={setCategory} destinationQuery={destinationQuery} setDestinationQuery={setDestinationQuery} search={search} setSearch={setSearch} visitDate={date} setVisitDate={setDate} openSite={openSite}
        signedIn={Boolean(user)} onHow={() => go('How it works')} savedSiteIds={savedSiteIds} onToggleSavedSite={toggleSavedSite}
      />}
      {page === 'Destinations' && role !== 'gatekeeper' && <DestinationsPage
        sites={destinationSites} allCount={permittedSites.length} categories={categories} category={category}
        setCategory={setCategory} destinationQuery={destinationQuery} setDestinationQuery={setDestinationQuery} openSite={openSite} savedSiteIds={savedSiteIds} onToggleSavedSite={toggleSavedSite}
      />}
      {page === 'Destination map' && role !== 'gatekeeper' && <DestinationLocator sites={sites} openSite={openSite}/>}
      {page === 'Destination' && !activeSite && <section className="content-page section-wrap"><div className="empty-card" role="status"><Compass size={28}/><h3>{sitesLoaded ? 'Destination unavailable' : 'Loading destination details'}</h3><p>{sitesLoaded ? 'This destination is not currently available.' : 'Fetching the current published destination details.'}</p><button className="btn btn-outline" onClick={() => go('Discover')}>Browse destinations</button></div></section>}
      {page === 'Destination' && activeSite && <section className="details-page section-wrap">
        <button className="back-link" onClick={() => go('Discover')}>← All destinations</button>
        <div className="details-top"><div><span className="eyebrow"><span className="eyebrow-line"/> ILIGAN CITY · {activeSite.category.toUpperCase()}</span>
          <h1>{activeSite.name}</h1>
        </div><span className="status-tag">{activeSite.status.replace('_', ' ')}</span></div>
        <div className="details-layout"><div>
          <div className="gallery">{activeSite.images.length ? activeSite.images.slice(0, 3).map((image, index) =>
            <img className={index === 0 ? 'gallery-main' : ''} key={image.id} src={image.public_url} alt={image.alt_text || activeSite.name}/>) :
            destinationPhoto(activeSite.slug) ? <img className="gallery-main" src={destinationPhoto(activeSite.slug).src} alt={activeSite.name}/> :
              <div className="gallery-empty"><Compass size={32}/><span>Photos will appear here when this destination adds them.</span></div>}</div>
          {!activeSite.images.length && destinationPhoto(activeSite.slug) && <PhotoCredit slug={activeSite.slug}/>}
          <div className="detail-copy"><h3>About this place</h3><p>{activeSite.description || 'The destination manager has not added a description yet.'}</p>
            <p><MapPin size={14}/> {activeSite.address || 'Location details not provided'}</p>
            <Suspense fallback={<div className="destination-map-placeholder" role="status">Loading interactive map…</div>}><DestinationMap site={activeSite}/></Suspense>
            {activeSite.fee_information_confirmed
              ? <div className="fee-table"><div><b>VISITOR</b><b>ADMISSION</b><b>FEE</b></div><div><span>Adult</span><span>Standard admission</span><b>{money(activeSite.adult_fee)}</b></div><div><span>Child</span><span>Child admission</span><b>{money(activeSite.child_fee)}</b></div>{activeSite.pwd_discount_percent > 0 && <div><span>PWD</span><span>{activeSite.pwd_discount_percent}% discount</span><b>{money(activeSite.adult_fee * (1 - activeSite.pwd_discount_percent / 100))}</b></div>}</div>
              : <p className="empty-inline">Admission fee information has not been confirmed by destination management.</p>}
            <div className="destination-hours"><h3>Operating hours</h3>{activeSite.operating_hours.filter((hours) => !hours.is_closed && hours.opens_at && hours.closes_at).length
              ? activeSite.operating_hours.filter((hours) => !hours.is_closed && hours.opens_at && hours.closes_at).sort((a, b) => a.weekday - b.weekday).map((hours) => <span key={hours.weekday}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][hours.weekday]} · {timeLabel(hours.opens_at!)}–{timeLabel(hours.closes_at!)}</span>)
              : <p>Operating hours have not been published.</p>}
              {activeSite.closures.filter((closure) => date >= closure.starts_on && date <= closure.ends_on).map((closure) => <p className="closure-notice" key={`${closure.starts_on}-${closure.reason}`}>{closure.reason} · {closure.starts_on}{closure.ends_on !== closure.starts_on ? ` to ${closure.ends_on}` : ''}</p>)}</div>
          </div>
        </div><aside className="booking-card">
          <span className="eyebrow"><span className="eyebrow-line"/> RESERVATION</span><h3>Plan your visit</h3>
          <OccupancyPanel site={activeSite} sites={sites} onOpen={openSite}/>
          {!user ? <div className="booking-gate"><p>Sign in or create a visitor account before entering reservation details.</p><button className="btn btn-primary btn-wide" onClick={() => navigate(visitorLoginUrl(location.pathname))}>Book now <ArrowRight size={16}/></button></div>
          : !accountReady ? <div className="booking-gate" role="status"><p>Checking your visitor account…</p></div>
          : profile?.account_status !== 'active' || profile.role !== 'visitor' ? <div className="booking-gate" role="status"><p>Reservations are available to active visitor accounts. Staff accounts use their office workspace.</p></div>
          : !activeSite.fee_information_confirmed ? <div className="booking-gate" role="status"><p>Reservations are unavailable until destination management confirms current admission fees.</p></div>
          : <>
          <p className="price-intro">Starting at <b>{money(activeSite.adult_fee)}</b> / adult</p>
          <label className="field-label">Visit date<input type="date" min={todayPh()} value={date} onChange={(event) => setDate(event.target.value)}/></label>
          <div className="slot-heading"><span>Daily booking limit</span><small>{activeSite.daily_capacity == null ? 'No daily limit published' : `${activeSite.daily_capacity} visitors total`}</small></div>
          {slotsLoading ? <div className="empty-inline" role="status">Checking booking capacity…</div> : !availableSlots.length && <div className="empty-inline">No booking capacity is available for this date.</div>}
          <div className="party-count"><span><b>Visitors</b><small>Adults + children</small></span><span>
            <button className="mini-counter" aria-label="Fewer adults" onClick={() => setParty((current) => { const adults = Math.max(1, current.adults - 1); return { ...current, adults, pwd: Math.min(current.pwd, adults + current.children) }; })}>−</button>
            <b>{party.adults}</b><button className="mini-counter" aria-label="More adults" onClick={() => setParty((current) => ({ ...current, adults: Math.min(activeSite.max_per_booking - current.children, current.adults + 1) }))}>+</button>
            <span className="counter-divider"/>
            <button className="mini-counter" aria-label="Fewer children" onClick={() => setParty((current) => { const children = Math.max(0, current.children - 1); return { ...current, children, pwd: Math.min(current.pwd, current.adults + children) }; })}>−</button>
            <b>{party.children}</b><button className="mini-counter" aria-label="More children" onClick={() => setParty((current) => ({ ...current, children: Math.min(activeSite.max_per_booking - current.adults, current.children + 1) }))}>+</button>
          </span></div>
          <VisitorInformationForm siteSlug={activeSite.slug} adults={party.adults} children={party.children} visitors={visitorInformation}
            onChange={(index, field, value) => setVisitorInformation((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))}/>
          {activeSite.pwd_discount_percent > 0 && <label className="field-label">PWD visitors<input type="number" min="0" max={party.adults + party.children} value={party.pwd} onChange={(event) => setParty((current) => ({ ...current, pwd: Math.max(0, Math.min(current.adults + current.children, Number(event.target.value))) }))}/><small>{activeSite.pwd_discount_percent}% discount per PWD visitor. Eligibility must be verified at the gate.</small></label>}
          {travelers.length > 0 && <label className="field-label">Use a saved traveler<select value={selectedTravelerId} onChange={(event) => {
            const id = event.target.value; setSelectedTravelerId(id);
            const traveler = travelers.find((item) => item.id === id);
            if (traveler) setVisitor({ name: traveler.full_name, email: traveler.email ?? '', phone: traveler.phone ?? '' });
          }}><option value="">Enter contact details manually</option>{travelers.map((traveler) => <option key={traveler.id} value={traveler.id}>{traveler.full_name}</option>)}</select></label>}
          <div className="reservation-contact-heading"><h4>Booking contact</h4><p>Primary reservation contact; entered separately from visitor records.</p></div>
          <div className="price-fields"><label>Your name<input value={visitor.name} onChange={(event) => { setSelectedTravelerId(''); setVisitor({ ...visitor, name: event.target.value }); }} maxLength={120}/></label>
            <label>Email<input type="email" value={visitor.email} onChange={(event) => { setSelectedTravelerId(''); setVisitor({ ...visitor, email: event.target.value }); }} maxLength={254}/></label>
            <label>Phone<input type="tel" value={visitor.phone} onChange={(event) => { setSelectedTravelerId(''); setVisitor({ ...visitor, phone: event.target.value }); }} maxLength={40}/></label></div>
          {bookingTotal > 0 && <div className="visitor-payment-choice"><div className="reservation-contact-heading"><h4>Choose Payment Method</h4><p>Choose how you want to pay for {activeSite.name}.</p></div>
            <div className="visitor-payment-options"><button type="button" className={'visitor-payment-option' + (paymentMethod === 'online' ? ' selected' : '')} aria-pressed={paymentMethod === 'online'} onClick={() => setPaymentMethod('online')}><CreditCard size={22}/><b>Pay Online</b><span>Secure PayMongo checkout with card, GCash, or QR Ph where enabled. Confirmation follows provider verification.</span></button>
              <button type="button" className={'visitor-payment-option' + (paymentMethod === 'onsite' ? ' selected' : '')} aria-pressed={paymentMethod === 'onsite'} onClick={() => setPaymentMethod('onsite')}><Banknote size={22}/><b>Pay Onsite</b><span>Reserve now and pay at the destination under its payment policy.</span></button></div>
          </div>}
          <div className="visitor-booking-summary"><b>Booking summary</b><span>{activeSite.name} · {date}</span><span>{party.adults + party.children} visitors</span><span>Admission · {money(activeSite.adult_fee)} / adult · {money(activeSite.child_fee)} / child</span><strong>Total amount · {money(bookingTotal)}</strong>{bookingTotal > 0 && <small>Payment method · {paymentMethod === 'online' ? 'Pay Online' : 'Pay Onsite'}</small>}</div>
          <button className="btn btn-primary btn-wide" disabled={busy || slotsLoading || !selectedSlot || completedVisitorCount(visitorInformation, activeSite.slug) !== visitorInformation.length} onClick={() => void reserve()}>{busy ? 'Please wait…' : bookingTotal <= 0 ? 'Confirm free reservation' : paymentMethod === 'online' ? 'Continue to secure payment' : 'Confirm and pay onsite'} <ArrowRight size={16}/></button>
          <p className="secure-note"><ShieldCheck size={14}/>{bookingTotal <= 0 ? 'No payment is due for this reservation.' : paymentMethod === 'online' ? 'Payment is confirmed only after PayMongo verifies it.' : 'Your reservation is confirmed now. Payment remains due at the destination.'}</p>
          </>}
        </aside></div>
      </section>}
      {page === 'How it works' && <HowPage/>}
      {(page === 'Bookings' || page === 'Tickets' || page === 'Account') && <VisitorPages key={user?.id ?? 'visitor'}
        page={page} user={user} profile={profile} booking={activeBooking} ticket={activeTicket} guestAccessToken={activeGuestCode}
        onTicket={(booking, code) => void makeTicket(booking, code)} notify={notify} reloadUser={() => { if (user) void applyUser(user); }}
        go={go} onSignOut={signOut} configured={supabaseConfigured} sites={sites} savedSiteIds={savedSiteIds} travelers={travelers}
        onToggleSavedSite={toggleSavedSite} onOpenSite={openSite} onLogin={() => navigate(visitorLoginUrl(location.pathname))}
        onPasswordReset={() => setAuthMode('forgot')}
      />}
      {page === 'Discover' && role === 'visitor' && <VisitorShortcuts go={go} signedIn={Boolean(user)}/>}
    </Suspense>}</main>
    {page !== 'Landing' && !authPage && role === 'visitor' && <MobileTabs page={page} go={go}/>}
    {page !== 'Landing' && !authPage && role === 'visitor' && <footer className="footer"><div className="section-wrap footer-inner"><><div className="footer-brand"><span>Iliguide</span></div>
      <div className="footer-col"><b>Explore</b><button onClick={() => go('Destinations')}>Destinations</button><button onClick={() => go('How it works')}>How it works</button><button onClick={() => go('Bookings')}>My bookings</button></div>
      <div className="footer-col"><b>Your account</b>{user ? <><button onClick={() => go('Account')}>My account</button><button onClick={() => go('Bookings')}>My bookings</button></> : <><Link to={visitorLoginUrl()}>Log in</Link><button onClick={() => setAuthMode('signup')}>Create account</button></>}<span>Private visitor details</span></div>
      <div className="footer-col"><b>Destination teams</b><Link to={STAFF_LOGIN_PATH}>Office sign in</Link><span>Live capacity and attendance</span><span>Recorded operational changes</span></div>
      <div className="footer-bottom"><span>© {new Date().getFullYear()} Iliguide · Iligan City</span><span>Local destinations, managed live</span></div></></div></footer>}
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
    {visitorAuthModalOpen && <AuthDialog mode={authMode ?? 'login'} onClose={() => {
      setAuthMode(null);
      setPasswordRecovery(false);
      if (visitorLoginRoute) navigate(visitorAuthDismissPath(authNext), { replace: true });
    }} onSuccess={() => {
      setAuthMode(null);
      setPasswordRecovery(false);
      if (visitorLoginRoute) navigate(authSuccessPath('visitor', authNext), { replace: true });
    }} onMode={setAuthMode}
      audience="visitor" presentation="dialog"
      initialVisitor={visitor}
      redirectTo={authReturnTo}/>
    }
  </div>;
}

function LandingPage({ onExplore }: { onExplore: () => void }) {
  return <section className="landing-page">
    <img className="landing-photo" src="/tropical-waterfall-lagoon.png" alt="Tropical waterfall lagoon with a bamboo raft"/>
    <div className="landing-shade"/>
    <div className="landing-copy">
      <span className="eyebrow"><span className="eyebrow-line"/> ILIGAN CITY · ILIGUIDE</span>
      <h1>Explore the city of<br/><em>majestic waterfalls.</em></h1>
      <p>Discover Iligan’s waterfalls and cold springs, review destination details, and plan your visit.</p>
      <button className="btn btn-primary landing-explore" onClick={onExplore}>Explore now <ArrowRight size={17}/></button>
    </div>
  </section>;
}

function HomePage({ sites, destinationOptions, allCount, categories, category, setCategory, destinationQuery, setDestinationQuery, search, setSearch, visitDate, setVisitDate, openSite, signedIn, onHow, savedSiteIds, onToggleSavedSite }: {
  sites: Site[]; destinationOptions: Site[]; allCount: number; categories: string[]; category: string;
  destinationQuery: string; setDestinationQuery: (value: string) => void;
  setCategory: (value: string) => void; search: string; setSearch: (value: string) => void;
  visitDate: string; setVisitDate: (value: string) => void;
  openSite: (site: Site) => void; signedIn: boolean; onHow: () => void; savedSiteIds: string[]; onToggleSavedSite: (siteId: string) => void;
}) {
  const filteredSites = sites.filter((site) => (site.name + ' ' + site.address + ' ' + site.category).toLowerCase().includes(destinationQuery.trim().toLowerCase()));
  return <>
    <section className="hero"><HeroSlideshow/><div className="hero-copy"><span className="eyebrow"><span className="eyebrow-line"/> YOUR NEXT GREAT ESCAPE</span>
      <h1>Majestic City<br/><em>of waterfalls.</em></h1>
      <p>Chase waterfalls, cool off in crystal springs, and find the quieter side of Iligan. Explore destinations and plan a visit.</p>
      <div className="search-panel"><label className="search-field"><MapPin size={17}/><span><small>DESTINATION</small><select aria-label="Destination" value={search} onChange={(event) => setSearch(event.target.value)}><option value="" disabled hidden>Where do you want to go?</option>{destinationOptions.map((site) => <option key={site.id} value={site.name}>{site.name}</option>)}</select></span><ChevronDown size={15}/></label>
        <label className="search-field date-field"><CalendarDays size={17}/><span><small>WHEN</small><input type="date" min={todayPh()} value={visitDate} onChange={(event) => setVisitDate(event.target.value)}/></span></label>
        <button className="btn btn-primary" onClick={() => { const destination = destinationOptions.find((site) => site.name === search); if (destination) openSite(destination); else document.getElementById('destinations')?.scrollIntoView({ behavior: 'smooth' }); }}><Search size={17}/> Search destination</button></div>
      <div className="hero-note"><div className="avatar-stack"><span>✦</span><span>✦</span><span>✦</span></div><span><b>{allCount} destinations listed</b><br/>Published by Iligan destination teams.</span></div>
    </div></section>
      <div className="trust-strip"><div className="trust-strip-inner"><span><ShieldCheck size={18}/> Capacity-checked reservations</span><span><BadgeCheck size={18}/> Admission fees published by each site</span><span><TicketIcon size={18}/> QR tickets after confirmation</span><span className="strip-location"><MapPin size={16}/> Iligan City, Philippines</span></div></div>
    <section className="destinations-section section-wrap" id="destinations"><div className="section-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> THE GOOD STUFF</span><h2>Places worth<br className="mobile-only"/> <em>getting lost in.</em></h2></div><Link className="text-link" to="/destinations" aria-label={'View all ' + allCount + ' published destinations'} onClick={() => setCategory('All')}>{allCount} published destinations <ArrowRight size={17}/></Link></div>
      <div className="dest-toolbar"><p>Explore destinations published by the Tourism Office.</p><div className="dest-filter-controls"><label className="destination-search"><Search size={15}/><input value={destinationQuery} onChange={(event) => setDestinationQuery(event.target.value)} placeholder="Search destinations" aria-label="Search destinations"/></label><label className="destination-category-filter"><Filter size={15}/><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter destinations by category">{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div></div>
      <div className="site-grid">{filteredSites.map((site, index) => <SiteCard key={site.id} site={site} index={index} onOpen={() => openSite(site)} isSaved={savedSiteIds.includes(site.id)} onToggleSaved={() => onToggleSavedSite(site.id)}/>)}</div>
      {!filteredSites.length && <div className="empty-state"><Compass size={32}/><h3>No destinations listed yet</h3><p>{allCount === 0 ? 'When a Tourism Office administrator publishes a destination, it will appear here.' : 'No places match this search. Try a different name or category.'}</p></div>}
    </section>
    <section className="how-section"><div className="section-wrap how-inner"><div className="how-intro"><span className="eyebrow"><span className="eyebrow-line"/> EASY AS 1, 2, 3</span><h2>Less planning.<br/><em>More exploring.</em></h2><p>Choose a destination, reserve a live slot, and show your ticket at the gate.</p><button className="btn btn-outline" onClick={onHow}>How it works <ArrowRight size={16}/></button></div>
      <div className="steps">{[{ n: '01', title: 'Find your spot', text: 'Browse current destination details and operating hours.', icon: <Compass/> }, { n: '02', title: 'Book your visit', text: 'Choose a time with availability confirmed by the reservation service.', icon: <CalendarDays/> }, { n: '03', title: 'Show your ticket', text: 'Present your QR reservation at the destination for validation.', icon: <TicketIcon/> }].map((step) => <div className="step" key={step.n}><span className="step-icon">{step.icon}</span><span className="step-body"><span className="step-number">{step.n} /</span><b>{step.title}</b><small>{step.text}</small></span><ArrowRight className="step-arrow" size={19}/></div>)}</div></div></section>
    {!signedIn && <section className="local-note section-wrap"><div className="local-art"><span className="sun-disc"/><span className="hill hill-one"/><span className="hill hill-two"/><span className="hill hill-three"/></div><div className="local-copy"><span className="eyebrow"><span className="eyebrow-line"/> MADE FOR YOUR NEXT DAY OUT</span><h2>Good days start<br/><em>with a plan.</em></h2><p>Create a visitor account to keep reservations and tickets together.</p></div></section>}
  </>;
}

function DestinationsPage({ sites, allCount, categories, category, setCategory, destinationQuery, setDestinationQuery, openSite, savedSiteIds, onToggleSavedSite }: {
  sites: Site[]; allCount: number; categories: string[]; category: string; setCategory: (value: string) => void;
  destinationQuery: string; setDestinationQuery: (value: string) => void;
  openSite: (site: Site) => void; savedSiteIds: string[]; onToggleSavedSite: (siteId: string) => void;
}) {
  const filteredSites = sites.filter((site) => (site.name + ' ' + site.address + ' ' + site.category).toLowerCase().includes(destinationQuery.trim().toLowerCase()));
  return <section className="destinations-section destination-list-page section-wrap">
    <div className="section-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> ILIGAN CITY · PLACES TO EXPLORE</span><h1>Explore <em>destinations.</em></h1></div><span className="text-link">{allCount} published destinations</span></div>
    <div className="dest-toolbar"><p>Browse destinations published by Iligan destination teams.</p><div className="dest-filter-controls"><label className="destination-search"><Search size={15}/><input value={destinationQuery} onChange={(event) => setDestinationQuery(event.target.value)} placeholder="Search destinations" aria-label="Search destinations"/></label><label className="destination-category-filter"><Filter size={15}/><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter destinations by category">{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div></div>
    <div className="site-grid">{filteredSites.map((site, index) => <SiteCard key={site.id} site={site} index={index} onOpen={() => openSite(site)} isSaved={savedSiteIds.includes(site.id)} onToggleSaved={() => onToggleSavedSite(site.id)}/>)}</div>
    {!filteredSites.length && <div className="empty-state"><Compass size={32}/><h3>No destinations listed yet</h3><p>{allCount === 0 ? 'When a Tourism Office administrator publishes a destination, it will appear here.' : destinationQuery ? 'No destinations match this search. Try a different name or category.' : 'No places in this category. Try another category.'}</p></div>}
  </section>;
}

function HeroSlideshow() {
  const [activeSlide, setActiveSlide] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const slide = heroSlides[activeSlide];

  useEffect(() => {
    const nextImage = new Image();
    nextImage.src = heroSlides[(activeSlide + 1) % heroSlides.length].src;
  }, [activeSlide]);

  useEffect(() => {
    if (paused || (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const timer = window.setInterval(() => setActiveSlide((index) => (index + 1) % heroSlides.length), 6500);
    return () => window.clearInterval(timer);
  }, [paused]);

  const moveSlide = (offset: number) => setActiveSlide((index) => (index + offset + heroSlides.length) % heroSlides.length);

  return <div className="hero-image" role="region" aria-roledescription="carousel" aria-label="Iligan City destinations" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    {heroSlides.map((item, index) => <img key={item.src} className={`hero-slide-image hero-slide-image--${index + 1}${activeSlide === index ? ' active' : ''}`} src={item.src} alt={activeSlide === index ? item.alt : ''} aria-hidden={activeSlide !== index} loading={activeSlide === index ? 'eager' : 'lazy'} decoding="async" fetchPriority={activeSlide === index ? 'high' : 'low'}/>)}
    <div className="image-shade"/><div className="hero-image-label"><span className="live-dot"/> ILIGAN CITY</div>
    <div className="image-caption"><span>{slide.name}</span><i/><span>NORTHERN MINDANAO</span></div>
    <div className="hero-slider-controls" aria-label="Choose a featured destination">
      <button className="hero-slide-arrow" type="button" aria-label="Previous destination" onClick={() => moveSlide(-1)}><ChevronLeft size={16}/></button>
      {heroSlides.map((item, index) => <button key={item.src} className={'hero-slide-dot' + (activeSlide === index ? ' active' : '')} type="button" aria-label={'Show ' + item.name} aria-pressed={activeSlide === index} onClick={() => setActiveSlide(index)}/>) }
      <button className="hero-slide-arrow" type="button" aria-label="Next destination" onClick={() => moveSlide(1)}><ChevronRight size={16}/></button>
    </div>
  </div>;
}

function SiteCard({ site, index, onOpen, isSaved, onToggleSaved }: { site: Site; index: number; onOpen: () => void; isSaved: boolean; onToggleSaved: () => void }) {
  const image = site.images.find((item) => item.image_role === 'cover') ?? site.images[0];
  const fallbackPhoto = !image ? destinationPhoto(site.slug) : undefined;
  return <article className={'site-card card-' + (index % 4)}><button className="site-photo" onClick={onOpen} aria-label={'View ' + site.name}>
    {image ? <img src={image.public_url} alt={image.alt_text || site.name}/> : fallbackPhoto ? <img src={fallbackPhoto.src} alt={site.name}/> : <span className="site-photo-empty"><Compass size={27}/></span>}
    <span className="photo-index">{String(index + 1).padStart(2, '0')} <i/> ILIGAN</span></button>
    <button className={isSaved ? 'site-save-btn saved' : 'site-save-btn'} aria-label={isSaved ? 'Remove ' + site.name + ' from saved places' : 'Save ' + site.name} aria-pressed={isSaved} onClick={onToggleSaved}><Heart size={17} fill={isSaved ? 'currentColor' : 'none'}/></button>
    <div className="site-card-info">{fallbackPhoto && <PhotoCredit slug={site.slug}/>}<div className="site-meta"><span>{site.category}</span><span>{site.status.replace('_', ' ')}</span></div>
      <button className="site-title" onClick={onOpen}>{site.name}<ArrowRight size={17}/></button>
      <div className="site-loc"><MapPin size={13}/>{site.address || 'Iligan City'}</div>
      <div className="card-bottom"><span>{site.fee_information_confirmed ? <>From <b>{money(site.adult_fee)}</b> <small>/ adult</small></> : 'Fees not published'}</span><button onClick={onOpen}>See details <ArrowRight size={14}/></button></div></div>
  </article>;
}

function PhotoCredit({ slug }: { slug: string }) {
  const photo = destinationPhoto(slug);
  if (!photo) return null;
  return <small className="destination-photo-credit">Photo: <a href={photo.source} target="_blank" rel="noopener noreferrer">{photo.author}</a> · <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">{photo.license}</a></small>;
}

function HowPage() {
  return <section className="content-page section-wrap"><span className="eyebrow"><span className="eyebrow-line"/> A SIMPLE WAY TO VISIT</span><h1>Plan less.<br/><em>Be there more.</em></h1>
    <p className="page-intro">Choose a published destination and reserve a visit date. No online payment is collected.</p>
    <div className="how-page-grid">{[
      ['01', 'Choose a destination', 'Review destination details, admission fees, published hours, and daily capacity.'],
      ['02', 'Reserve a visit date', 'The booking service checks capacity and records your reservation. No payment is collected.'],
      ['03', 'View your ticket', 'Present the QR reservation at the destination so gate staff can validate it.'],
    ].map(([number, title, text]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
    <div className="config-note"><ShieldCheck size={16}/> Sign in to view reservations and tickets linked to your visitor account.</div>
  </section>;
}

function VisitorShortcuts({ go, signedIn }: { go: (page: Page) => void; signedIn: boolean }) {
  return <div className="visitor-shortcuts section-wrap"><button onClick={() => go('Bookings')}><CalendarDays size={17}/>{signedIn ? 'Your bookings' : 'Sign in to see bookings'}<ArrowRight size={15}/></button><button onClick={() => go('Tickets')}><TicketIcon size={17}/>Tickets<ArrowRight size={15}/></button><button onClick={() => go('Account')}><ShieldCheck size={17}/>Account<ArrowRight size={15}/></button></div>;
}

function MobileTabs({ page, go }: { page: Page; go: (page: Page) => void }) {
  const items: Array<[string, Page]> = [['Discover', 'Discover'], ['Bookings', 'Bookings'], ['Tickets', 'Tickets'], ['Account', 'Account']];
  return <nav className="mobile-tabs" aria-label="Mobile navigation">{items.map(([label, target]) =>
    <button className={page === target ? 'active' : ''} key={target} onClick={() => go(target)}><span>
      {label === 'Bookings' ? <CalendarDays size={18}/> : label === 'Tickets' || label === 'Walk-in' ? <TicketIcon size={18}/>
        : label === 'Account' || label === 'Today' ? <ShieldCheck size={18}/> : label === 'Scan' ? <Search size={18}/>
          : <Compass size={18}/>}
    </span>{label}</button>)}</nav>;
}
