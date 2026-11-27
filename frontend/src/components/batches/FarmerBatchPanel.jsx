import { useCallback, useEffect, useState } from 'react';
import { fetchBatches } from '../../services/batchService.js';
import BatchDetails from './BatchDetails.jsx';
import BatchList from './BatchList.jsx';
import BatchRegistrationForm from './BatchRegistrationForm.jsx';
import WorkspaceSummary from '../WorkspaceSummary.jsx';
import { formatTimestamp } from './batchFormatters.js';

const LIST_ERROR = 'Could not load your batches. Make sure the backend is running.';

/**
 * Farmer-only batch area: the registration form, the confirmation with the new batch ID and
 * QR code, and the list of the farmer's batches. Rendered only for the farmer role.
 */
export default function FarmerBatchPanel() {
  const [registered, setRegistered] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
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

  const selected = list.batches.find((batch) => batch.id === selectedId) ?? null;

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
            <strong id="registered-confirmation-heading">Batch registered.</strong> Batch ID{' '}
            <code className="batch-id">{registered.batch_id}</code>. It is saved and listed below.
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
        {list.status === 'ready' ? (
          <WorkspaceSummary
            label="Batch summary"
            items={[
              { label: 'Registered batches', value: list.batches.length },
              {
                label: 'Latest registration',
                value: list.batches.length > 0 ? formatTimestamp(list.batches[0].created_at) : 'None yet',
              },
            ]}
          />
        ) : null}
        {list.status === 'ready' ? (
          <BatchList
            batches={list.batches}
            selectedId={selectedId}
            onSelect={(batch) => setSelectedId(batch.id === selectedId ? null : batch.id)}
          />
        ) : null}

        {selected ? (
          <div className="batch-selected">
            <BatchDetails batch={selected} headingId="selected-batch-heading" />
            <button type="button" className="btn btn--secondary" onClick={() => setSelectedId(null)}>
              Close details
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
