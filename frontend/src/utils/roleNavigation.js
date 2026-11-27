/**
 * Navigation for each role's workspace (BPT-102). Each entry links to a section that the workspace
 * renders for that role only. Links use in-page anchors, so a role never gets a link to another
 * role's section. Sections not listed here for a role are never offered to that role.
 */
export const ROLE_NAVIGATION = Object.freeze({
  farmer: Object.freeze([
    { label: 'Dashboard', href: '#workspace-top' },
    { label: 'Product batches and registration', href: '#role-panel' },
    { label: 'Batch history', href: '#batch-history' },
    { label: 'Ledger', href: '#ledger' },
  ]),
  distributor: Object.freeze([
    { label: 'Dashboard', href: '#workspace-top' },
    { label: 'Eligible batches and shipment updates', href: '#role-panel' },
    { label: 'Batch history', href: '#batch-history' },
    { label: 'Ledger', href: '#ledger' },
  ]),
  retailer: Object.freeze([
    { label: 'Dashboard', href: '#workspace-top' },
    { label: 'Awaiting receipts and confirmation', href: '#role-panel' },
    { label: 'Batch history', href: '#batch-history' },
    { label: 'Ledger', href: '#ledger' },
  ]),
});

/** Navigation entries for a role, or an empty list for a role that has no workspace. */
export function navigationForRole(role) {
  return Object.hasOwn(ROLE_NAVIGATION, role) ? ROLE_NAVIGATION[role] : [];
}
