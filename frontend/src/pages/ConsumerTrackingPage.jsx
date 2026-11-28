import { useEffect, useState } from 'react';
import { ApiError } from '../services/apiClient.js';
import { fetchPublicTracking } from '../services/trackingService.js';
import { formatQuantity, formatTimestamp } from '../components/batches/batchFormatters.js';
import {
  MILESTONE_STATES,
  buildMilestones,
  eventTitle,
  latestUpdate,
  receiptSummary,
} from '../utils/productJourney.js';

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

const STATE_LABELS = {
  completed: 'Completed',
  current: 'Current',
  pending: 'Not yet recorded',
};

const STATE_MARKS = {
  completed: '✓',
  current: '●',
  pending: '○',
};

function TrackingRecord({ data }) {
  const { batch, events } = data;
  const milestones = buildMilestones(batch.current_status, events);
  const latest = latestUpdate(events);
  const receipt = receiptSummary(events);
  const hasCurrentMilestone = milestones.some((milestone) => milestone.state === MILESTONE_STATES.CURRENT);

  return (
    <article className="tracking-record" aria-labelledby="tracking-product-heading">
      <section className="tracking-overview" aria-labelledby="tracking-overview-heading">
        <h2 id="tracking-overview-heading" className="visually-hidden">
          Product overview
        </h2>
        <p className="tracking-eyebrow">Batch ID</p>
        <p className="tracking-batch-id">{batch.batch_id}</p>
        <h1 id="tracking-product-heading" className="tracking-product">
          {batch.product_name}
        </h1>
        {batch.description ? <p className="tracking-description">{batch.description}</p> : null}

        <dl className="tracking-facts">
          <div>
            <dt>Current status</dt>
            <dd>
              <span className="tracking-status-pill">{batch.current_status}</span>
            </dd>
          </div>
          <div>
            <dt>Quantity</dt>
            <dd>{formatQuantity(batch.quantity, batch.unit)}</dd>
          </div>
          <div>
            <dt>Origin or farm location</dt>
            <dd>{batch.origin}</dd>
          </div>
          {batch.harvest_date ? (
            <div>
              <dt>Harvest date</dt>
              <dd>{batch.harvest_date}</dd>
            </div>
          ) : null}
          <div>
            <dt>Latest recorded update</dt>
            <dd>
              {latest ? <time dateTime={latest}>{formatTimestamp(latest)}</time> : 'No update recorded yet'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="tracking-progress-section" aria-labelledby="tracking-progress-heading">
        <h2 id="tracking-progress-heading">Where the product stands</h2>
        <ol className="tracking-progress" aria-label="Progress through the supply chain">
          {milestones.map((milestone) => (
            <li
              key={milestone.key}
              className={`tracking-milestone tracking-milestone--${milestone.state}`}
              data-milestone={milestone.key}
              data-state={milestone.state}
            >
              <span className="tracking-milestone__mark" aria-hidden="true">
                {STATE_MARKS[milestone.state]}
              </span>
              <span className="tracking-milestone__title">{milestone.title}</span>
              <span className="tracking-milestone__state">{STATE_LABELS[milestone.state]}</span>
              {milestone.firstTimestamp ? (
                <time dateTime={milestone.firstTimestamp} className="tracking-milestone__time">
                  {formatTimestamp(milestone.firstTimestamp)}
                </time>
              ) : null}
            </li>
          ))}
        </ol>
        {!hasCurrentMilestone ? (
          <p className="tracking-progress__note">
            The latest recorded status is <strong>{batch.current_status}</strong>, which is not one of the standard
            steps.
          </p>
        ) : null}
      </section>

      <section className="tracking-handover" aria-labelledby="tracking-handover-heading">
        <h2 id="tracking-handover-heading">Retailer receipt and handover</h2>
        {receipt ? (
          <dl className="tracking-facts">
            <div>
              <dt>Receipt confirmed</dt>
              <dd>
                <time dateTime={receipt.timestamp}>{formatTimestamp(receipt.timestamp)}</time>
              </dd>
            </div>
            <div>
              <dt>Confirmed by</dt>
              <dd>{receipt.confirmedBy}</dd>
            </div>
            <div>
              <dt>Final status</dt>
              <dd>{receipt.status}</dd>
            </div>
            {receipt.ledgerBlockIndex !== null ? (
              <div>
                <dt>Ledger block</dt>
                <dd>Block {receipt.ledgerBlockIndex}</dd>
              </div>
            ) : null}
          </dl>
        ) : batch.current_status === 'Delivered to Retailer' ? (
          <p className="tracking-handover__pending">
            Delivered to the retailer. Awaiting the retailer&apos;s confirmation of receipt.
          </p>
        ) : (
          <p className="tracking-handover__pending">
            Not yet delivered to a retailer. Receipt has not been confirmed.
          </p>
        )}
      </section>

      <section className="tracking-journey" aria-labelledby="tracking-journey-heading">
        <h2 id="tracking-journey-heading">Journey</h2>
        {events.length === 0 ? (
          <p>No events have been recorded for this batch yet.</p>
        ) : (
          <ol className="tracking-timeline" aria-label={`Recorded journey of batch ${batch.batch_id}`}>
            {events.map((event, position) => {
              const { title, role } = eventTitle(event);
              return (
                <li key={`${event.timestamp}-${position}`} className="tracking-step" data-event-type={event.event_type}>
                  <div className="tracking-step__head">
                    <span className={`tracking-kind ${KIND_CLASSES[event.event_type] ?? ''}`}>
                      {KIND_LABELS[event.event_type] ?? event.label}
                    </span>
                    <time dateTime={event.timestamp} className="tracking-step__time">
                      {formatTimestamp(event.timestamp)}
                    </time>
                  </div>
                  <p className="tracking-step__title">
                    {title} <span className="tracking-step__role">by {role}</span>
                  </p>
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
              );
            })}
          </ol>
        )}
      </section>
    </article>
  );
}
