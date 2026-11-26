import { useEffect, useState } from 'react';
import FarmerBatchPanel from '../components/batches/FarmerBatchPanel.jsx';
import { fetchRoleActions } from '../services/accessService.js';

const LOAD_ERROR = 'Could not load the actions for this role. Make sure the backend is running.';

/**
 * Role-specific landing view. The action list comes from the backend, which checks the
 * active session role before returning anything. Batch registration is shown only to the
 * farmer role; Distributor and Retailer sessions never render the form.
 */
export default function RoleWorkspacePage({ role, roleLabel, roleDescription }) {
  const [state, setState] = useState({ status: 'loading', actions: [], error: null });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', actions: [], error: null });

    fetchRoleActions({ signal: controller.signal })
      .then((body) => {
        setState({ status: 'ready', actions: body.actions, error: null });
      })
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        setState({ status: 'error', actions: [], error: LOAD_ERROR });
      });

    return () => controller.abort();
  }, [roleLabel]);

  return (
    <section className="workspace" aria-labelledby="workspace-heading">
      <h1 id="workspace-heading" className="dashboard__heading">
        {roleLabel} workspace
      </h1>
      {roleDescription ? <p className="dashboard__description">{roleDescription}</p> : null}

      {role === 'farmer' ? <FarmerBatchPanel /> : null}

      <h2 className="dashboard__section-heading">Available actions</h2>
      {state.status === 'loading' ? <p role="status">Loading actions…</p> : null}
      {state.status === 'error' ? (
        <div className="alert alert--danger" role="alert">
          {state.error}
        </div>
      ) : null}
      {state.status === 'ready' && state.actions.length === 0 ? (
        <p>No actions are assigned to this role.</p>
      ) : null}
      {state.status === 'ready' && state.actions.length > 0 ? (
        <ul className="action-list">
          {state.actions.map((action) => (
            <li key={action.key} className="action-list__item">
              <span className="action-list__label">{action.label}</span>
              <span className="action-list__status">
                {action.available ? 'Available' : 'Not available yet'}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
