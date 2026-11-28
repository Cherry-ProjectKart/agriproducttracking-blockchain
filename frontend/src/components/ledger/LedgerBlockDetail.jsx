import { useState } from 'react';
import { copyText } from '../../utils/clipboard.js';
import { EVENT_DATA_LABELS, EVENT_LABELS, linkStatement } from '../../utils/ledgerDisplay.js';
import { formatTimestamp } from '../batches/batchFormatters.js';
import { roleLabel } from '../../utils/productJourney.js';

/** One full hash with its copy button and feedback. The full value is always shown, never only the short form. */
function FullHash({ label, value }) {
  const [message, setMessage] = useState(null);

  async function copy() {
    const copied = await copyText(value);
    setMessage(copied ? 'Copied' : 'Copy failed');
  }

  return (
    <div className="hash-cell">
      <code className="hash" title={value}>
        {value}
      </code>
      <div className="hash-cell__actions">
        <button type="button" className="btn btn--small btn--secondary" onClick={copy} aria-label={`Copy ${label}`}>
          Copy
        </button>
        {message ? <span role="status" className="hash-cell__message">{message}</span> : null}
      </div>
    </div>
  );
}

/**
 * Detail of one ledger block: what it records, when, for which batch, by which role, its two hashes and how it
 * links to the chain. Everything shown comes from the block as the ledger stores it.
 */
export default function LedgerBlockDetail({ block, previousBlock, nextBlock, onSelect }) {
  const eventType = block.event_type ?? block.event_data?.event_type ?? 'UNKNOWN';
  const eventLabel = EVENT_LABELS[eventType] ?? eventType;
  const data = block.event_data ?? {};
  // The recorder is already shown in the facts above, so it is not repeated in the recorded fields.
  const fields = Object.entries(EVENT_DATA_LABELS).filter(
    ([key]) => key !== 'actor_role' && data[key] !== undefined && data[key] !== null,
  );

  return (
    <section className="workspace-card ledger-detail" aria-labelledby={`ledger-block-${block.index}-heading`}>
      <h3 id={`ledger-block-${block.index}-heading`} className="dashboard__section-heading">
        Block {block.index} details
      </h3>
      <p className="ledger-detail__summary">
        <strong>{eventLabel}</strong>
        {block.batch_id ? (
          <>
            {' '}for batch <code className="batch-id">{block.batch_id}</code>
          </>
        ) : null}
        {' '}recorded {formatTimestamp(block.timestamp)}.
      </p>

      <dl className="ledger-detail__facts">
        <div>
          <dt>Block index</dt>
          <dd>{block.index}</dd>
        </div>
        <div>
          <dt>Event type</dt>
          <dd>{eventType}</dd>
        </div>
        <div>
          <dt>Event reference</dt>
          <dd>{block.event_id ?? 'None (genesis block)'}</dd>
        </div>
        <div>
          <dt>Recorded at</dt>
          <dd>
            <time dateTime={block.timestamp}>{formatTimestamp(block.timestamp)}</time>
          </dd>
        </div>
        {data.actor_role ? (
          <div>
            <dt>Recorded by</dt>
            <dd>{roleLabel(data.actor_role)}</dd>
          </div>
        ) : null}
      </dl>

      {fields.length > 0 ? (
        <>
          <h4 className="verification-subheading">What was recorded</h4>
          <dl className="ledger-detail__facts">
            {fields.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{String(data[key])}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      <h4 className="verification-subheading">Hashes and links</h4>
      <p className="ledger-detail__link">{linkStatement(block, previousBlock)}</p>
      <dl className="ledger-detail__hashes">
        <div>
          <dt>Previous hash</dt>
          <dd>
            <FullHash label={`details: previous hash of block ${block.index}`} value={block.previous_hash} />
          </dd>
        </div>
        <div>
          <dt>Block hash (this block)</dt>
          <dd>
            <FullHash label={`details: block hash of block ${block.index}`} value={block.block_hash} />
          </dd>
        </div>
      </dl>

      <div className="ledger-detail__nav">
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={() => onSelect(previousBlock.index)}
          disabled={!previousBlock}
          aria-label={previousBlock ? `Show block ${previousBlock.index}` : 'No earlier block'}
        >
          Previous block
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={() => onSelect(nextBlock.index)}
          disabled={!nextBlock}
          aria-label={nextBlock ? `Show block ${nextBlock.index}` : 'No later block'}
        >
          Next block
        </button>
      </div>
    </section>
  );
}
