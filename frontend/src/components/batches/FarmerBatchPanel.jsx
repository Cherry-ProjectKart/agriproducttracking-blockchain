import { useCallback, useEffect, useState } from 'react';
import { fetchBatches } from '../../services/batchService.js';
import BatchDetails from './BatchDetails.jsx';
import BatchList from './BatchList.jsx';
import BatchRegistrationForm from './BatchRegistrationForm.jsx';

const LIST_ERROR = 'Could not load your batches. Make sure the backend is running.';

/**
 * Farmer-only batch area: the registration form, the confirmation after a successful
 * registration, and the list of the farmer's batches. Rendered only for the farmer role.
 */
export default function FarmerBatchPanel() {
  const [registered, setRegistered] = useState(null);
  const [list, setList] = useState({ status: 'loading', batches: [] });

  const loadBatches = useCallback(async (signal) => {
    setList((current) => ({ ...current, status: 'loading' }));
    try {
      const batches = await fetchBatches({ signal });
      setList({ status: 'ready', batches });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setList({ status: 'error', batches: [] });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadBatches(controller.signal);
    return () => controller.abort();
  }, [loadBatches]);

  function handleRegistered(batch) {
    setRegistered(batch);
    loadBatches();
  }

  return (
    <div className="farmer-batches">
      <section className="workspace-card" aria-labelledby="register-batch-heading">
        <h2 id="register-batch-heading" className="dashboard__section-heading">
          Register a product batch
        </h2>
        <BatchRegistrationForm onRegistered={handleRegistered} />
      </section>

      {registered ? (
        <section className="workspace-card" aria-labelledby="registered-confirmation-heading">
          <div className="alert alert--success" role="status">
            <strong id="registered-confirmation-heading">Batch registered.</strong> It is saved and listed below.
          </div>
          <BatchDetails batch={registered} headingId="registered-batch-heading" />
        </section>
      ) : null}

      <section className="workspace-card" aria-labelledby="batch-list-heading">
        <h2 id="batch-list-heading" className="dashboard__section-heading">
          Your registered batches
        </h2>
        {list.status === 'loading' ? <p role="status">Loading batches…</p> : null}
        {list.status === 'error' ? (
          <div className="alert alert--danger" role="alert">
            {LIST_ERROR}
          </div>
        ) : null}
        {list.status === 'ready' ? <BatchList batches={list.batches} /> : null}
      </section>
    </div>
  );
}
