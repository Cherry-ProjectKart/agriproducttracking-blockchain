import { describe, expect, it } from 'vitest';
import {
  NOTE_MAX_LENGTH,
  SHIPMENT_STATUSES,
  buildShipmentPayload,
  validateShipmentForm,
} from './shipmentValidation.js';

const VALID = { batchId: 'PB-7K2M-9QXD', status: 'Shipped', note: 'Left the farm' };

describe('shipment statuses', () => {
  it('offers exactly the three supported distributor statuses', () => {
    expect([...SHIPMENT_STATUSES]).toEqual(['Shipped', 'In Transit', 'Delivered to Retailer']);
  });

  it('does not include Received by Retailer, which belongs to US-06', () => {
    expect(SHIPMENT_STATUSES).not.toContain('Received by Retailer');
  });
});

describe('validateShipmentForm', () => {
  it('accepts a complete entry', () => {
    expect(validateShipmentForm(VALID)).toEqual({});
  });

  it('accepts an entry without a note', () => {
    expect(validateShipmentForm({ ...VALID, note: '' })).toEqual({});
  });

  it('requires a selected batch', () => {
    expect(validateShipmentForm({ ...VALID, batchId: '' }).batchId).toBe('Select a batch to update.');
  });

  it('rejects a malformed batch ID', () => {
    expect(validateShipmentForm({ ...VALID, batchId: 'not-a-batch' }).batchId).toBe('Batch ID must look like PB-XXXX-XXXX.');
  });

  it('requires a status', () => {
    expect(validateShipmentForm({ ...VALID, status: '' }).status).toBe('Choose a shipment status.');
  });

  it.each(['Received by Retailer', 'shipped', 'Delivered'])('rejects the unsupported status %j', (status) => {
    expect(validateShipmentForm({ ...VALID, status }).status).toMatch(/^Choose one of: Shipped, In Transit/);
  });

  it('accepts a note of exactly the limit and rejects one character more', () => {
    expect(validateShipmentForm({ ...VALID, note: 'x'.repeat(NOTE_MAX_LENGTH) })).toEqual({});
    expect(validateShipmentForm({ ...VALID, note: 'x'.repeat(NOTE_MAX_LENGTH + 1) }).note).toBe(
      `Note must be ${NOTE_MAX_LENGTH} characters or fewer.`,
    );
  });

  it.each(['line one\nline two', 'tab\there', 'bell\u0007'])('rejects control characters in %j', (note) => {
    expect(validateShipmentForm({ ...VALID, note }).note).toBe('Note must be a single line of plain text.');
  });
});

describe('buildShipmentPayload', () => {
  it('trims the note and sends null when it is empty', () => {
    expect(buildShipmentPayload({ ...VALID, note: '  Cold chain  ' })).toEqual({
      batch_id: 'PB-7K2M-9QXD',
      status: 'Shipped',
      note: 'Cold chain',
    });
    expect(buildShipmentPayload({ ...VALID, note: '   ' }).note).toBeNull();
  });
});
