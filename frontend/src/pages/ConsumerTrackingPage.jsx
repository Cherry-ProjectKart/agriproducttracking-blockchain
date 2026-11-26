import { useEffect, useState } from 'react';
import { ApiError } from '../services/apiClient.js';
import { fetchPublicTracking } from '../services/trackingService.js';
import { formatTimestamp } from '../components/batches/batchFormatters.js';

const KIND_LABELS = {
  PRODUCT_REGISTERED: 'Registration',
  SHIPMENT_UPDATED: 'Shipment',
  RECEIPT_CONFIRMED: 'Receipt',
};

const KIND_CLASSES = {
  PRODUCT_REGISTERED: 'tracking-kind--registration',
  SHIPMENT_UPDATED: 'tracking-kind--shipment',
  RECEIPT_CONFIRMED: 'tracking-kind--receipt',
};

/**
 * Public consumer page opened from a batch QR code. Standalone: it does not use the role session or the
 * workspace shell, and it offers no controls that change anything. Every value comes from the public
 * tracking endpoint, which exposes only the batch details and its recorded history.
 */
export default function ConsumerTrackingPage({ batchId }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading', data: null, error: null });
    fetchPublicTracking(batchId, { signal: controller.signal })
      .then((data) => setState({ status: 'ready', data, error: null }))
      .catch((error) => {
        if (error?.name === 'AbortError') return;
        if (error instanceof ApiError && error.status === 404) {
          setState({ status: 'not-found', data: null, error: null });
        } else if (error instanceof ApiError && error.status === 400) {
          setState({ status: 'invalid', data: null, error: null });
        } else {
          // Unreachable server, or any other failure: the page explains how to check the connection.
          setState({ status: 'network', data: null, error: null });
        }
      });
    return () => controller.abort();
  }, [batchId]);

  useEffect(() => {
    document.title = `Batch ${batchId} · Product tracking`;
  }, [batchId]);

  return (
    <div className="tracking-page">
      <header className="tracking-header">
        <span className="tracking-header__brand" aria-hidden="true">
          ⛓
        </span>
        <span className="tracking-header__title">Product tracking</span>
      </header>

      <main className="tracking-main" id="tracking-main">
        {state.status === 'loading' ? (
          <p className="tracking-status" role="status">
            Loading the batch record…
          </p>
        ) : null}

        {state.status === 'not-found' ? (
          <section className="tracking-message" role="alert" aria-labelledby="tracking-not-found-heading">
            <h1 id="tracking-not-found-heading">We could not find this batch</h1>
            <p>
              No batch has the ID <code className="batch-id">{batchId}</code>. Check the QR code or the batch ID on the
              product label.
            </p>
          </section>
        ) : null}

        {state.status === 'invalid' ? (
          <section className="tracking-message" role="alert" aria-labelledby="tracking-invalid-heading">
            <h1 id="tracking-invalid-heading">This is not a valid batch code</h1>
            <p>The code should look like PB-XXXX-XXXX. Scan the QR code again or check the label.</p>
          </section>
        ) : null}

        {state.status === 'network' ? (
          <section className="tracking-message" role="alert" aria-labelledby="tracking-network-heading">
            <h1 id="tracking-network-heading">The tracking record cannot be reached</h1>
            <p>
              Check that the application is running and that this device can reach it on the network, then reload the
              page.
            </p>
          </section>
        ) : null}

        {state.status === 'ready' && state.data ? <TrackingRecord data={state.data} /> : null}
      </main>

      <footer className="tracking-footer">
        <p>
          This is a read-only record. Anyone with this link can view it. It is part of a local demonstration: the
          history is kept in a local hash-linked ledger, not a public blockchain.
        </p>
      </footer>
    </div>
  );
}

function TrackingRecord({ data }) {
  const { batch, events } = data;

  return (
    <article className="tracking-record" aria-labelledby="tracking-product-heading">
      <p className="tracking-eyebrow">Batch ID</p>
      <p className="tracking-batch-id">{batch.batch_id}</p>
      <h1 id="tracking-product-heading" className="tracking-product">
        {batch.product_name}
      </h1>

      <dl className="tracking-facts">
        <div>
          <dt>Origin or farm location</dt>
          <dd>{batch.origin}</dd>
        </div>
        <div>
          <dt>Current status</dt>
          <dd>
            <span className="tracking-status-pill">{batch.current_status}</span>
          </dd>
        </div>
      </dl>

      <section className="tracking-journey" aria-labelledby="tracking-journey-heading">
        <h2 id="tracking-journey-heading">Journey</h2>
        {events.length === 0 ? (
          <p>No events have been recorded for this batch yet.</p>
        ) : (
          <ol className="tracking-timeline" aria-label={`Recorded journey of batch ${batch.batch_id}`}>
            {events.map((event, position) => (
              <li key={`${event.timestamp}-${position}`} className="tracking-step" data-event-type={event.event_type}>
                <div className="tracking-step__head">
                  <span className={`tracking-kind ${KIND_CLASSES[event.event_type] ?? ''}`}>
                    {KIND_LABELS[event.event_type] ?? event.label}
                  </span>
                  <time dateTime={event.timestamp} className="tracking-step__time">
                    {formatTimestamp(event.timestamp)}
                  </time>
                </div>
                <dl className="tracking-step__details">
                  <div>
                    <dt>Recorded by</dt>
                    <dd>{event.actor_role}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{event.status}</dd>
                  </div>
                  {event.note ? (
                    <div className="tracking-step__note">
                      <dt>Note</dt>
                      <dd>{event.note}</dd>
                    </div>
                  ) : null}
                  {event.ledger_block_index !== null && event.ledger_block_index !== undefined ? (
                    <div>
                      <dt>Ledger block</dt>
                      <dd>Block {event.ledger_block_index}</dd>
                    </div>
                  ) : null}
                </dl>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
