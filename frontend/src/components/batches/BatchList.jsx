import { formatQuantity, formatTimestamp } from './batchFormatters.js';

/** The farmer's registered batches, newest first. */
export default function BatchList({ batches }) {
  if (batches.length === 0) {
    return <p className="batch-list__empty">No batches registered yet.</p>;
  }

  return (
    <div className="table-wrapper">
      <table className="batch-table">
        <caption className="visually-hidden">Batches you have registered</caption>
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col">Quantity</th>
            <th scope="col">Origin</th>
            <th scope="col">Harvest date</th>
            <th scope="col">Status</th>
            <th scope="col">Registered</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id}>
              <td>{batch.product_name}</td>
              <td>{formatQuantity(batch.quantity, batch.unit)}</td>
              <td>{batch.origin}</td>
              <td>{batch.harvest_date}</td>
              <td>{batch.current_status}</td>
              <td>{formatTimestamp(batch.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
