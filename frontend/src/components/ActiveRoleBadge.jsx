export default function ActiveRoleBadge({ label, name = null }) {
  return (
    <p className="role-badge" data-testid="active-role">
      {name ? (
        <>
          Signed in as <strong>{name}</strong> ·{' '}
        </>
      ) : null}
      Role: <strong>{label}</strong>
    </p>
  );
}
