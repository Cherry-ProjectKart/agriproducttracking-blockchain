const STATE_LABELS = {
  ok: 'Operational',
  connected: 'Connected',
  degraded: 'Degraded',
  disconnected: 'Disconnected',
  unreachable: 'Unreachable',
  checking: 'Checking…',
};

export default function StatusCard({ title, state, detail }) {
  const label = STATE_LABELS[state] ?? state;
  const tone = state === 'ok' || state === 'connected' ? 'success' : state === 'checking' ? 'neutral' : 'danger';

  return (
    <section className="status-card" aria-labelledby={`status-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <h3 className="status-card__title" id={`status-${title.replace(/\s+/g, '-').toLowerCase()}`}>
        {title}
      </h3>
      <p className={`status-card__state status-card__state--${tone}`}>
        <span className="status-card__dot" aria-hidden="true" />
        {label}
      </p>
      {detail ? <p className="status-card__detail">{detail}</p> : null}
    </section>
  );
}
