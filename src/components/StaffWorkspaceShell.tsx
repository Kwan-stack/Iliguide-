import type { ReactNode } from 'react';
import { Check, LogOut, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Profile } from '../lib/iliguide';
import './StaffWorkspaceShell.css';

type StaffRole = Extract<Profile['role'], 'tourism_office' | 'site_admin' | 'gatekeeper'>;
type Props = {
  role: StaffRole;
  homePath: string;
  toast: string;
  dataError: string;
  onRetry: () => void;
  onSignOut: () => void;
  children: ReactNode;
};

const roleLabel: Record<StaffRole, string> = {
  tourism_office: 'Tourism Office', site_admin: 'Site administrator', gatekeeper: 'Gatekeeper',
};

export function StaffWorkspaceShell({ role, homePath, toast, dataError, onRetry, onSignOut, children }: Props) {
  return <div className={`office-app-shell office-app-${role}`}>
    <header className="office-app-topbar">
      <Link className="office-app-brand" to={homePath} aria-label="Iliguide staff workspace">
        <span className="office-app-brand-lockup"><img src="/iliguide-staff-logo.png" alt="Iliguide"/><small>OFFICE WORKSPACE</small></span>
      </Link>
      <div className="office-app-actions">
        <span className="office-app-role"><ShieldCheck size={15}/>{roleLabel[role]}</span>
        <button className="office-app-signout" onClick={onSignOut}><LogOut size={15}/> Log out</button>
      </div>
    </header>
    {dataError && <div className="office-app-error" role="status"><ShieldCheck size={16}/><span>{dataError}</span><button onClick={onRetry}>Retry</button></div>}
    <main className="office-app-main">{children}</main>
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}
