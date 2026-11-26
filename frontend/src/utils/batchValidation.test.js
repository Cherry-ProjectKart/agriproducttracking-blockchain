import { describe, expect, it } from 'vitest';
import { BATCH_LIMITS, EMPTY_BATCH_FORM, buildBatchPayload, validateBatchForm } from './batchValidation.js';

const VALID = {
  productName: 'Basmati Rice',
  description: 'Long-grain rice.',
  quantity: '250',
  unit: 'kg',
  origin: 'Green Valley Farm',
  harvestDate: '2026-10-15',
};

describe('validateBatchForm', () => {
  it('accepts a complete, valid entry', () => {
    expect(validateBatchForm(VALID)).toEqual({});
  });

  it('reports every required field when the form is empty', () => {
    const errors = validateBatchForm(EMPTY_BATCH_FORM);

    expect(Object.keys(errors).sort()).toEqual(
      ['harvestDate', 'origin', 'productName', 'quantity', 'unit'].sort(),
    );
    expect(errors.productName).toBe('Product name is required.');
    expect(errors.quantity).toBe('Quantity is required.');
  });

  it('treats whitespace-only text as missing', () => {
    const errors = validateBatchForm({ ...VALID, productName: '   ', origin: '\t' });

    expect(errors.productName).toBe('Product name is required.');
    expect(errors.origin).toBe('Origin or farm location is required.');
  });

  it('does not require a description', () => {
    expect(validateBatchForm({ ...VALID, description: '' })).toEqual({});
  });

  it.each(['0', '-1', '-2.5', '1e3', 'abc', '+5', '1,000', '.5', 'Infinity'])(
    'rejects quantity %j',
    (quantity) => {
      expect(validateBatchForm({ ...VALID, quantity }).quantity).toBeTruthy();
    },
  );

  it('accepts decimal quantities', () => {
    expect(validateBatchForm({ ...VALID, quantity: '12.5' })).toEqual({});
  });

  it.each(['2026-02-30', '15-10-2026', '2026/10/15', '2026-1-5', 'not a date'])(
    'rejects harvest date %j',
    (harvestDate) => {
      expect(validateBatchForm({ ...VALID, harvestDate }).harvestDate).toBeTruthy();
    },
  );

  it('accepts a leap day', () => {
    expect(validateBatchForm({ ...VALID, harvestDate: '2028-02-29' })).toEqual({});
  });

  it('enforces the length limits', () => {
    const errors = validateBatchForm({
      ...VALID,
      productName: 'x'.repeat(BATCH_LIMITS.productName + 1),
      description: 'x'.repeat(BATCH_LIMITS.description + 1),
      unit: 'x'.repeat(BATCH_LIMITS.unit + 1),
      origin: 'x'.repeat(BATCH_LIMITS.origin + 1),
    });

    expect(Object.keys(errors).sort()).toEqual(['description', 'origin', 'productName', 'unit']);
  });
});

describe('buildBatchPayload', () => {
  it('trims text, converts quantity to a number and omits an empty description as null', () => {
    const payload = buildBatchPayload({
      ...VALID,
      productName: '  Basmati Rice  ',
      description: '   ',
      quantity: ' 12.5 ',
    });

    expect(payload).toEqual({
      product_name: 'Basmati Rice',
      description: null,
      quantity: 12.5,
      unit: 'kg',
      origin: 'Green Valley Farm',
      harvest_date: '2026-10-15',
    });
  });
});
