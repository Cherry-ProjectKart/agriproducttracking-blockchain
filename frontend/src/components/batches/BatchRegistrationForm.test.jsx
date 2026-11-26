// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../../services/apiClient.js';
import BatchRegistrationForm from './BatchRegistrationForm.jsx';

const BATCH = {
  id: 1,
  product_name: 'Basmati Rice',
  description: null,
  quantity: 250,
  unit: 'kg',
  origin: 'Green Valley Farm',
  harvest_date: '2026-10-15',
  current_status: 'Registered',
  created_at: '2026-11-26T10:00:00.000Z',
};

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/Product name/), { target: { value: 'Basmati Rice' } });
  fireEvent.change(screen.getByLabelText(/Origin or farm location/), { target: { value: 'Green Valley Farm' } });
  fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '250' } });
  fireEvent.change(screen.getByLabelText(/^Unit/), { target: { value: 'kg' } });
  fireEvent.change(screen.getByLabelText(/Harvest or registration date/), { target: { value: '2026-10-15' } });
}

describe('BatchRegistrationForm', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders labelled inputs for every batch field with required indicators', () => {
    render(<BatchRegistrationForm createBatch={vi.fn()} />);

    expect(screen.getByLabelText(/Product name/)).toBeTruthy();
    expect(screen.getByLabelText(/Origin or farm location/)).toBeTruthy();
    expect(screen.getByLabelText(/Quantity/).getAttribute('type')).toBe('number');
    expect(screen.getByLabelText(/^Unit/)).toBeTruthy();
    expect(screen.getByLabelText(/Harvest or registration date/).getAttribute('type')).toBe('date');
    expect(screen.getByLabelText('Description')).toBeTruthy();
    // Five required-field markers on the labels, plus one in the form hint. Description has none.
    expect(screen.getAllByText('*').length).toBe(6);
    expect(screen.getByRole('button', { name: 'Register batch' })).toBeTruthy();
  });

  it('shows validation messages and does not call the API when required fields are empty', async () => {
    const createBatch = vi.fn();
    render(<BatchRegistrationForm createBatch={createBatch} />);

    fireEvent.click(screen.getByRole('button', { name: 'Register batch' }));

    expect(await screen.findByText('Product name is required.')).toBeTruthy();
    expect(screen.getByText('Quantity is required.')).toBeTruthy();
    expect(screen.getByText('Harvest or registration date is required.')).toBeTruthy();
    expect(screen.getByLabelText(/Product name/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/Product name/).getAttribute('aria-describedby')).toBe('batch-productName-error');
    expect(createBatch).not.toHaveBeenCalled();
  });

  it('rejects a non-positive quantity inline', async () => {
    const createBatch = vi.fn();
    render(<BatchRegistrationForm createBatch={createBatch} />);
    fillValidForm();
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '0' } });

    fireEvent.click(screen.getByRole('button', { name: 'Register batch' }));

    expect(await screen.findByText('Quantity must be greater than zero.')).toBeTruthy();
    expect(createBatch).not.toHaveBeenCalled();
  });

  it('submits a valid entry with a submission key and reports the saved batch', async () => {
    const createBatch = vi.fn().mockResolvedValue(BATCH);
    const onRegistered = vi.fn();
    render(<BatchRegistrationForm createBatch={createBatch} onRegistered={onRegistered} />);
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Register batch' }));

    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(BATCH));
    const [payload, key] = createBatch.mock.calls[0];
    expect(payload).toEqual({
      product_name: 'Basmati Rice',
      description: null,
      quantity: 250,
      unit: 'kg',
      origin: 'Green Valley Farm',
      harvest_date: '2026-10-15',
    });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    // The form is cleared after a successful save.
    expect(screen.getByLabelText(/Product name/).value).toBe('');
  });

  it('shows a loading state while the request is in flight and blocks a second submit', async () => {
    let resolveRequest;
    const createBatch = vi.fn(() => new Promise((resolve) => (resolveRequest = resolve)));
    render(<BatchRegistrationForm createBatch={createBatch} />);
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Register batch' }));

    const busyButton = await screen.findByRole('button', { name: 'Registering…' });
    expect(busyButton.disabled).toBe(true);
    expect(screen.getByText('Saving batch…')).toBeTruthy();

    fireEvent.click(busyButton);
    expect(createBatch).toHaveBeenCalledTimes(1);

    resolveRequest(BATCH);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Register batch' })).toBeTruthy());
  });

  it('displays server field errors from the API response', async () => {
    const createBatch = vi.fn().mockRejectedValue(
      new ApiError('Request failed with status 400.', {
        status: 400,
        body: {
          error: {
            code: 400,
            name: 'Bad Request',
            message: 'Please correct the highlighted fields.',
            details: { origin: 'Origin or farm location is required.' },
          },
        },
      }),
    );
    render(<BatchRegistrationForm createBatch={createBatch} />);
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Register batch' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Please correct the highlighted fields.');
    expect(screen.getByText('Origin or farm location is required.')).toBeTruthy();
  });

  it('shows a network-specific message when the server cannot be reached', async () => {
    const createBatch = vi.fn().mockRejectedValue(new ApiError('Network error while contacting the API.'));
    render(<BatchRegistrationForm createBatch={createBatch} />);
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Register batch' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Could not reach the server');
  });

  it('keeps the entered values after a failure and retries with the same submission key', async () => {
    const createBatch = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('Request failed with status 500.', { status: 500 }))
      .mockResolvedValueOnce(BATCH);
    render(<BatchRegistrationForm createBatch={createBatch} />);
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Register batch' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByLabelText(/Product name/).value).toBe('Basmati Rice');

    fireEvent.click(screen.getByRole('button', { name: 'Register batch' }));
    await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(2));

    const firstKey = createBatch.mock.calls[0][1];
    const retryKey = createBatch.mock.calls[1][1];
    expect(retryKey).toBe(firstKey);
  });

  it('uses a new submission key after the entry is changed', async () => {
    const createBatch = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('Request failed with status 500.', { status: 500 }))
      .mockResolvedValueOnce(BATCH);
    render(<BatchRegistrationForm createBatch={createBatch} />);
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Register batch' }));
    await screen.findByRole('alert');

    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register batch' }));
    await waitFor(() => expect(createBatch).toHaveBeenCalledTimes(2));

    expect(createBatch.mock.calls[1][1]).not.toBe(createBatch.mock.calls[0][1]);
  });
});
