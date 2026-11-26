// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import BatchQrCode from './BatchQrCode.jsx';

const BATCH = {
  id: 7,
  batch_id: 'PB-7K2M-9QXD',
  tracking_url: 'http://localhost:5173/track/PB-7K2M-9QXD',
  qr_code_url: '/api/batches/7/qr.png',
};

describe('BatchQrCode', () => {
  afterEach(() => {
    cleanup();
  });

  it('displays the QR image for the batch with a descriptive alt text', () => {
    render(<BatchQrCode batch={BATCH} />);

    const image = screen.getByRole('img', { name: 'QR code for batch PB-7K2M-9QXD' });
    expect(image.getAttribute('src')).toBe('/api/batches/7/qr.png');
  });

  it('shows the tracking URL that the QR code opens', () => {
    render(<BatchQrCode batch={BATCH} />);

    expect(screen.getByText('http://localhost:5173/track/PB-7K2M-9QXD')).toBeTruthy();
  });

  it('offers a download link that saves the PNG with the batch ID as the file name', () => {
    render(<BatchQrCode batch={BATCH} />);

    const link = screen.getByRole('link', { name: 'Download QR code (PNG)' });
    expect(link.getAttribute('href')).toBe('/api/batches/7/qr.png?download=1');
    expect(link.getAttribute('download')).toBe('PB-7K2M-9QXD-qr.png');
  });

  it('says so when the batch has no QR code yet, without an image or download', () => {
    render(<BatchQrCode batch={{ ...BATCH, qr_code_url: null, tracking_url: null }} />);

    expect(screen.getByText('The QR code is not available for this batch yet.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('reports a QR generation failure with a retry action and hides the broken download', () => {
    render(<BatchQrCode batch={BATCH} />);

    fireEvent.error(screen.getByRole('img', { name: /QR code for batch/ }));

    expect(screen.getByRole('alert').textContent).toContain('The QR code could not be generated');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Download QR code (PNG)' })).toBeNull();
  });

  it('retries loading the QR image when the farmer chooses Try again', () => {
    render(<BatchQrCode batch={BATCH} />);
    fireEvent.error(screen.getByRole('img', { name: /QR code for batch/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    const image = screen.getByRole('img', { name: 'QR code for batch PB-7K2M-9QXD' });
    expect(image.getAttribute('src')).toBe('/api/batches/7/qr.png?retry=1');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: 'Download QR code (PNG)' })).toBeTruthy();
  });
});
