import { useState } from 'react';

/**
 * QR code for one batch, served by the backend as a PNG. The code encodes the batch's tracking
 * URL. The download link uses ?download=1, so the browser saves the image as <batch ID>-qr.png.
 */
export default function BatchQrCode({ batch }) {
  const [imageState, setImageState] = useState('loading'); // loading | ready | error
  const [attempt, setAttempt] = useState(0);

  if (!batch.qr_code_url) {
    return (
      <section className="batch-qr" aria-labelledby={`qr-heading-${batch.id}`}>
        <h4 id={`qr-heading-${batch.id}`} className="batch-qr__title">
          QR code
        </h4>
        <p className="batch-qr__unavailable">The QR code is not available for this batch yet.</p>
      </section>
    );
  }

  function retry() {
    setImageState('loading');
    setAttempt((count) => count + 1);
  }

  return (
    <section className="batch-qr" aria-labelledby={`qr-heading-${batch.id}`}>
      <h4 id={`qr-heading-${batch.id}`} className="batch-qr__title">
        QR code
      </h4>

      {imageState === 'error' ? (
        <div className="alert alert--danger" role="alert">
          <p>The QR code could not be generated. Check that the backend is running, then try again.</p>
          <button type="button" className="btn btn--secondary" onClick={retry}>
            Try again
          </button>
        </div>
      ) : (
        <img
          key={attempt}
          className="batch-qr__image"
          src={`${batch.qr_code_url}${attempt ? `?retry=${attempt}` : ''}`}
          alt={`QR code for batch ${batch.batch_id}`}
          width="200"
          height="200"
          onLoad={() => setImageState('ready')}
          onError={() => setImageState('error')}
        />
      )}

      {batch.tracking_url ? (
        <p className="batch-qr__link">
          Scanning opens the tracking page: <code>{batch.tracking_url}</code>
        </p>
      ) : null}

      {imageState !== 'error' ? (
        <a
          className="btn btn--secondary"
          href={`${batch.qr_code_url}?download=1`}
          download={`${batch.batch_id}-qr.png`}
        >
          Download QR code (PNG)
        </a>
      ) : null}
    </section>
  );
}
