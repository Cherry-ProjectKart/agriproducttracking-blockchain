// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BatchQrCode, { productSlug, qrFileName } from './BatchQrCode.jsx';

const BATCH = {
  id: 7,
  batch_id: 'PB-7K2M-9QXD',
  product_name: 'Basmati Rice',
  tracking_url: 'http://localhost:5173/track/PB-7K2M-9QXD',
  qr_code_url: '/api/batches/7/qr.png',
};

const originalFetch = globalThis.fetch;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

function setClipboard(value) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

function setExecCommand(value) {
  Object.defineProperty(document, 'execCommand', { value, configurable: true, writable: true });
}

function restoreProperty(target, name, descriptor) {
  if (descriptor) {
    Object.defineProperty(target, name, descriptor);
  } else {
    delete target[name];
  }
}

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

  it('says so when the batch has no QR code yet, without an image or download', () => {
    render(<BatchQrCode batch={{ ...BATCH, qr_code_url: null, tracking_url: null }} />);

    expect(screen.getByText('The QR code is not available for this batch yet.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reports a QR generation failure with a retry action and hides the download', () => {
    render(<BatchQrCode batch={BATCH} />);

    fireEvent.error(screen.getByRole('img', { name: /QR code for batch/ }));

    expect(screen.getByRole('alert').textContent).toContain('The QR code could not be generated');
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download QR code (PNG)' })).toBeNull();
  });

  it('retries loading the QR image when the farmer chooses Try again', () => {
    render(<BatchQrCode batch={BATCH} />);
    fireEvent.error(screen.getByRole('img', { name: /QR code for batch/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    const image = screen.getByRole('img', { name: 'QR code for batch PB-7K2M-9QXD' });
    expect(image.getAttribute('src')).toBe('/api/batches/7/qr.png?retry=1');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Download QR code (PNG)' })).toBeTruthy();
  });
});

describe('BatchQrCode download', () => {
  let clicked;

  beforeEach(() => {
    clicked = [];
    URL.createObjectURL = vi.fn(() => 'blob:qr-test');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function recordClick() {
      clicked.push({ href: this.href, download: this.download });
    });
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
  });

  it('fetches the PNG with the download flag and saves it under a name with the batch ID and product', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob(['png']) });
    render(<BatchQrCode batch={BATCH} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download QR code (PNG)' }));

    expect(await screen.findByText('Download started: PB-7K2M-9QXD-basmati-rice-qr.png.')).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/batches/7/qr.png?download=1', expect.objectContaining({ cache: 'no-store' }));
    expect(clicked).toEqual([{ href: 'blob:qr-test', download: 'PB-7K2M-9QXD-basmati-rice-qr.png' }]);
  });

  it('reports a failed download and does not save anything', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, blob: async () => new Blob([]) });
    render(<BatchQrCode batch={BATCH} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download QR code (PNG)' }));

    expect((await screen.findByRole('alert')).textContent).toContain('The QR code could not be downloaded');
    expect(clicked).toEqual([]);
  });

  it('reports a download that cannot reach the server', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    render(<BatchQrCode batch={BATCH} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download QR code (PNG)' }));

    expect((await screen.findByRole('alert')).textContent).toContain('The QR code could not be downloaded');
  });

  it('a second click while a download is running is ignored', async () => {
    let finish;
    globalThis.fetch = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    render(<BatchQrCode batch={BATCH} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download QR code (PNG)' }));

    expect(screen.getByRole('button', { name: 'Downloading…' }).disabled).toBe(true);
    finish({ ok: true, status: 200, blob: async () => new Blob(['png']) });
    await screen.findByText(/Download started/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('BatchQrCode copy link', () => {
  afterEach(() => {
    cleanup();
    restoreProperty(navigator, 'clipboard', originalClipboard);
    restoreProperty(document, 'execCommand', originalExecCommand);
  });

  it('copies the tracking URL with the Clipboard API and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    render(<BatchQrCode batch={BATCH} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy tracking link' }));

    expect(await screen.findByText('Tracking link copied.')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith('http://localhost:5173/track/PB-7K2M-9QXD');
  });

  it('falls back to a selected text field when the Clipboard API is not available', async () => {
    setClipboard(undefined);
    const execCommand = vi.fn(() => true);
    setExecCommand(execCommand);
    render(<BatchQrCode batch={BATCH} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy tracking link' }));

    expect(await screen.findByText('Tracking link copied.')).toBeTruthy();
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('shows a clear message when the browser refuses the copy', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    setExecCommand(vi.fn(() => false));
    render(<BatchQrCode batch={BATCH} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy tracking link' }));

    expect((await screen.findByRole('alert')).textContent).toContain('could not be copied');
  });
});

describe('QR file names', () => {
  it('turns a product name into a short, file-safe slug', () => {
    expect(productSlug('Basmati Rice')).toBe('basmati-rice');
    expect(productSlug('  Organic   Tomatoes!  ')).toBe('organic-tomatoes');
    expect(productSlug('Rice / Wheat: 2026')).toBe('rice-wheat-2026');
    expect(productSlug('ÉCLAIR')).toBe('clair');
    expect(productSlug('名前')).toBe('');
    expect(productSlug('a'.repeat(60))).toHaveLength(40);
  });

  it('uses only the batch ID when no usable product name is available', () => {
    expect(qrFileName({ batch_id: 'PB-7K2M-9QXD', product_name: '!!!' })).toBe('PB-7K2M-9QXD-qr.png');
    expect(qrFileName({ batch_id: 'PB-7K2M-9QXD' })).toBe('PB-7K2M-9QXD-qr.png');
  });
});
