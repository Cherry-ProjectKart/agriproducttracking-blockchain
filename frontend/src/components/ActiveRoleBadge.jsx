export default function ActiveRoleBadge({ label }) {
  return (
    <p className="role-badge" data-testid="active-role">
      Active role: <strong>{label}</strong>
    </p>
  );
}
