import { formatQuantity, formatTimestamp } from './batchFormatters.js';

/** Read-only summary of one registered batch. */
export default function BatchDetails({ batch, headingId = 'batch-details-heading' }) {
  return (
    <section className="batch-details" aria-labelledby={headingId}>
      <h3 id={headingId} className="batch-details__title">
        {batch.product_name}
      </h3>
      <dl className="batch-details__list">
        <div>
          <dt>Description</dt>
          <dd>{batch.description || 'Not provided'}</dd>
        </div>
        <div>
          <dt>Quantity</dt>
          <dd>{formatQuantity(batch.quantity, batch.unit)}</dd>
        </div>
        <div>
          <dt>Origin or farm location</dt>
          <dd>{batch.origin}</dd>
        </div>
        <div>
          <dt>Harvest or registration date</dt>
          <dd>{batch.harvest_date}</dd>
        </div>
        <div>
          <dt>Current status</dt>
          <dd>{batch.current_status}</dd>
        </div>
        <div>
          <dt>Registered on</dt>
          <dd>{formatTimestamp(batch.created_at)}</dd>
        </div>
      </dl>
    </section>
  );
}
