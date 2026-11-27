/**
 * Summary figures for a workspace (BPT-103). Callers pass values computed from data the workspace
 * has already loaded from the API; nothing here is estimated or sample data.
 */
export default function WorkspaceSummary({ items, label = 'Summary' }) {
  return (
    <dl className="workspace-summary" aria-label={label}>
      {items.map((item) => (
        <div className="workspace-summary__item" key={item.label}>
          <dt className="workspace-summary__label">{item.label}</dt>
          <dd className="workspace-summary__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
