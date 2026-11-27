import { useEffect, useState } from 'react';
import SignInForm from '../components/auth/SignInForm.jsx';
import StatusCard from '../components/StatusCard.jsx';
import { fetchHealth } from '../services/healthService.js';
import { REGISTRATION_ROLES } from '../utils/accountValidation.js';

const CHECKING = { status: 'checking', application: null, database: null };

/** Public entry page for signed-out visitors: product summary, sign-in form and system status. */
export default function SignInPage({ onSignIn, onNavigate }) {
  const [health, setHealth] = useState(CHECKING);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth({ signal: controller.signal })
      .then(setHealth)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const apiState = health.status === 'checking' ? 'checking' : health.status === 'ok' ? 'ok' : health.status === 'degraded' ? 'degraded' : 'unreachable';
  const dbStatus = health.database?.status ?? (health.status === 'checking' ? 'checking' : 'unreachable');
  const dbDetail =
    health.database?.schema_initialized === false
      ? 'Run "python scripts/init_db.py" in the backend folder to create the schema.'
      : null;

  return (
    <div className="auth-page">
      <section className="auth-intro" aria-labelledby="public-heading">
        <h1 id="public-heading" className="auth-intro__title">
          Blockchain Product Tracking
        </h1>
        <p className="auth-intro__text">
          Trace agricultural products from the farm to the retailer. Every supply-chain event is recorded in a
          tamper-evident ledger, and consumers can check a product&apos;s journey by scanning its QR code.
        </p>
        <ul className="auth-intro__roles">
          {REGISTRATION_ROLES.map((role) => (
            <li key={role.key}>
              <strong>{role.label}</strong> {role.description}
            </li>
          ))}
        </ul>
      </section>

      <section className="auth-card" aria-labelledby="sign-in-heading">
        <h2 id="sign-in-heading" className="auth-card__title">
          Welcome Back
        </h2>
        <p className="auth-card__subtitle">Sign in with your username and password.</p>
        <SignInForm onSignIn={onSignIn} onNavigate={onNavigate} />
      </section>

      <section className="auth-status" aria-labelledby="system-status-heading">
        <h2 id="system-status-heading" className="dashboard__section-heading">
          System status
        </h2>
        <div className="status-grid" aria-live="polite">
          <StatusCard title="Backend API" state={apiState} detail={health.application ? `Application: ${health.application}` : null} />
          <StatusCard title="Database" state={dbStatus} detail={dbDetail} />
        </div>
      </section>
    </div>
  );
}
