import { useState } from 'react';
import { copyText } from '../../utils/clipboard.js';

const COPY_SUCCESS = 'Tracking link copied.';
const COPY_FAILURE = 'The link could not be copied. Select the link above and copy it by hand.';
const DOWNLOAD_FAILURE = 'The QR code could not be downloaded. Check that the backend is running, then try again.';

/** A file-name-safe form of a product name, for example "basmati-rice". Empty when nothing usable remains. */
export function productSlug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/** Download file name: the batch ID, then the product when it is known, for example PB-7K2M-9QXD-basmati-rice-qr.png. */
export function qrFileName(batch) {
  const slug = productSlug(batch.product_name);
  return slug ? `${batch.batch_id}-${slug}-qr.png` : `${batch.batch_id}-qr.png`;
}

/**
 * QR code for one batch, served by the backend as a PNG. The code encodes the batch's tracking URL.
 * The farmer can download the PNG or copy the tracking link; both report their result on screen.
 */
export default function BatchQrCode({ batch }) {
  const [imageState, setImageState] = useState('loading'); // loading | ready | error
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [status, setStatus] = useState(null); // { tone: 'success' | 'danger', text }

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
    setStatus(null);
    setImageState('loading');
    setAttempt((count) => count + 1);
  }

  async function copyLink() {
    setStatus(null);
    const copied = await copyText(batch.tracking_url);
    setStatus(copied ? { tone: 'success', text: COPY_SUCCESS } : { tone: 'danger', text: COPY_FAILURE });
  }

  async function download() {
    setStatus(null);
    setDownloading(true);
    let objectUrl = null;
    try {
      const response = await fetch(`${batch.qr_code_url}?download=1`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`QR download failed with status ${response.status}`);
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      const fileName = qrFileName(batch);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setStatus({ tone: 'success', text: `Download started: ${fileName}.` });
    } catch {
      setStatus({ tone: 'danger', text: DOWNLOAD_FAILURE });
    } finally {
      if (objectUrl) {
        // Give the browser time to start the download before the temporary address is released.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
      setDownloading(false);
    }
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

      <div className="batch-qr__actions">
        {imageState !== 'error' ? (
          <button type="button" className="btn btn--secondary" onClick={download} disabled={downloading}>
            {downloading ? 'Downloading…' : 'Download QR code (PNG)'}
          </button>
        ) : null}
        {batch.tracking_url ? (
          <button type="button" className="btn btn--secondary" onClick={copyLink}>
            Copy tracking link
          </button>
        ) : null}
      </div>

      {status ? (
        <p
          className={`batch-qr__status batch-qr__status--${status.tone}`}
          role={status.tone === 'danger' ? 'alert' : 'status'}
        >
          {status.text}
        </p>
      ) : null}
    </section>
  );
}
