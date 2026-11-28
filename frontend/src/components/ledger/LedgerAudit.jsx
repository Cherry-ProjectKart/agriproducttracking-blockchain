import { useState } from 'react';
import LedgerOverview from './LedgerOverview.jsx';
import LedgerView from './LedgerView.jsx';
import LedgerVerificationPanel from '../history/LedgerVerificationPanel.jsx';

/**
 * The ledger audit view for every signed-in demonstration role: the overview, the integrity check and the block
 * history with block details. Each part reads the ledger through the existing read-only API.
 * The latest verification result is shared with the overview so the two never disagree.
 */
export default function LedgerAudit() {
  const [verification, setVerification] = useState(null);

  return (
    <div className="ledger-audit">
      <LedgerOverview verification={verification} />
      <LedgerVerificationPanel onResult={setVerification} />
      <LedgerView />
    </div>
  );
}
