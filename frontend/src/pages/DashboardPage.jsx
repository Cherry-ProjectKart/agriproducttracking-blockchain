import { useEffect, useState } from 'react';
import StatusCard from '../components/StatusCard.jsx';
import { fetchHealth } from '../services/healthService.js';

const PROJECT_NAME = 'Blockchain Product Tracking';
const PROJECT_DESCRIPTION =
  'A blockchain-enabled system for tracing agricultural products from farm to retail, ' +
  'recording every supply-chain event in a tamper-evident ledger.';

const CHECKING = { status: 'checking', application: null, database: null };

export default function DashboardPage() {
  const [health, setHealth] = useState(CHECKING);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth({ signal: controller.signal }).then(setHealth).catch(() => {});
    return () => controller.abort();
  }, []);

  const apiState = health.status === 'checking' ? 'checking' : health.status === 'ok' ? 'ok' : health.status === 'degraded' ? 'degraded' : 'unreachable';
  const dbStatus = health.database?.status ?? (health.status === 'checking' ? 'checking' : 'unreachable');
  const dbDetail =
    health.database?.schema_initialized === false
      ? 'Run "python scripts/init_db.py" in the backend folder to create the schema.'
      : null;

  return (
    <div className="dashboard">
      <section className="dashboard__intro">
        <h1 className="dashboard__heading">{PROJECT_NAME}</h1>
        <p className="dashboard__description">{PROJECT_DESCRIPTION}</p>
      </section>

      <section className="dashboard__status" aria-labelledby="system-status-heading">
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
