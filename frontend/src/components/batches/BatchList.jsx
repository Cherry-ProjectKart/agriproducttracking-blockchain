import { formatQuantity, formatTimestamp } from './batchFormatters.js';

/** The farmer's registered batches, newest first. Each row can be opened to show its QR code. */
export default function BatchList({ batches, selectedId = null, onSelect, onViewHistory = null }) {
  if (batches.length === 0) {
    return <p className="batch-list__empty">No batches registered yet.</p>;
  }

  return (
    <div className="table-wrapper">
      <table className="batch-table">
        <caption className="visually-hidden">Batches you have registered</caption>
        <thead>
          <tr>
            <th scope="col">Batch ID</th>
            <th scope="col">Product</th>
            <th scope="col">Quantity</th>
            <th scope="col">Origin</th>
            <th scope="col">Harvest date</th>
            <th scope="col">Status</th>
            <th scope="col">Registered</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id} className={batch.id === selectedId ? 'batch-table__row--selected' : undefined}>
              <td>
                <code className="batch-id">{batch.batch_id}</code>
              </td>
              <td>{batch.product_name}</td>
              <td>{formatQuantity(batch.quantity, batch.unit)}</td>
              <td>{batch.origin}</td>
              <td>{batch.harvest_date}</td>
              <td>{batch.current_status}</td>
              <td>{formatTimestamp(batch.created_at)}</td>
              <td>
                {onViewHistory ? (
                  <button
                    type="button"
                    className="btn btn--secondary btn--small"
                    aria-label={`View history for batch ${batch.batch_id}`}
                    onClick={() => onViewHistory(batch)}
                  >
                    History
                  </button>
                ) : null}
                {onSelect ? (
                  <button
                    type="button"
                    className="btn btn--secondary btn--small"
                    aria-label={`View batch ${batch.batch_id} and its QR code`}
                    aria-pressed={batch.id === selectedId}
                    onClick={() => onSelect(batch)}
                  >
                    View QR
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
