import App from './App.jsx';
import ConsumerTrackingPage from './pages/ConsumerTrackingPage.jsx';
import { trackingBatchIdFromPath } from './utils/routes.js';

/**
 * Chooses the page for the current address. A QR tracking path (/track/<batch ID>) shows the public
 * consumer page, which has no session, login or workspace shell. Every other address is the application.
 */
export default function Root() {
  const batchId = trackingBatchIdFromPath(window.location.pathname);
  return batchId ? <ConsumerTrackingPage batchId={batchId} /> : <App />;
}
