import { describe, expect, it } from 'vitest';
import { trackingBatchIdFromPath } from './routes.js';

describe('trackingBatchIdFromPath', () => {
  it('extracts the batch ID from a QR tracking path', () => {
    expect(trackingBatchIdFromPath('/track/PB-7K2M-9QXD')).toBe('PB-7K2M-9QXD');
  });

  it('ignores a trailing slash', () => {
    expect(trackingBatchIdFromPath('/track/PB-7K2M-9QXD/')).toBe('PB-7K2M-9QXD');
  });

  it('decodes percent-encoded characters', () => {
    expect(trackingBatchIdFromPath('/track/PB%2D7K2M%2D9QXD')).toBe('PB-7K2M-9QXD');
  });

  it.each(['/', '/track', '/track/', '/tracking/PB-7K2M-9QXD', '/track/PB-7K2M-9QXD/extra', '/api/tracking/PB-7K2M-9QXD'])(
    'returns null for %s, which is not a tracking page',
    (path) => {
      expect(trackingBatchIdFromPath(path)).toBeNull();
    },
  );

  it('returns the raw segment when it is not valid percent-encoding', () => {
    expect(trackingBatchIdFromPath('/track/%E0%A4%A')).toBe('%E0%A4%A');
  });

  it('handles a missing path', () => {
    expect(trackingBatchIdFromPath(undefined)).toBeNull();
  });
});
