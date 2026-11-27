// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RegisterForm from './RegisterForm.jsx';
import { ApiError } from '../../services/apiClient.js';

afterEach(cleanup);

function renderForm(onRegister = vi.fn().mockResolvedValue({})) {
  const onNavigate = vi.fn();
  render(<RegisterForm onRegister={onRegister} onNavigate={onNavigate} />);
  return { onRegister, onNavigate };
}

function fill({ name = 'Asha Farmer', username = 'asha.farmer', password = 'Sunrise2026', confirm = 'Sunrise2026' } = {}) {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } });
}

describe('RegisterForm', () => {
  it('renders every field, the three role choices with descriptions, and the sign-in link', () => {
    renderForm();

    expect(screen.getByLabelText('Full name')).toBeTruthy();
    expect(screen.getByLabelText('Username')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByLabelText('Confirm password')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Farmer/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Distributor/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^Retailer/ })).toBeTruthy();
    expect(screen.getByText('Register and track agricultural product batches.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign In' })).toBeTruthy();
  });

  it('does not offer Consumer as a role', () => {
    renderForm();

    expect(screen.queryByRole('radio', { name: /Consumer/i })).toBeNull();
  });

  it('shows required-field messages and sends nothing when empty', () => {
    const { onRegister } = renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByText('Enter your full name.')).toBeTruthy();
    expect(screen.getByText('Enter a username.')).toBeTruthy();
    expect(screen.getByText('Enter a password.')).toBeTruthy();
    expect(screen.getByText('Choose a role: Farmer, Distributor or Retailer.')).toBeTruthy();
    expect(onRegister).not.toHaveBeenCalled();
  });

  it('checks the password confirmation', () => {
    const { onRegister } = renderForm();

    fill({ confirm: 'Different2026' });
    fireEvent.click(screen.getByLabelText(/^Retailer/));
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByText('The passwords do not match.')).toBeTruthy();
    expect(onRegister).not.toHaveBeenCalled();
  });

  it('checks password strength', () => {
    renderForm();

    fill({ password: 'onlyletters', confirm: 'onlyletters' });
    fireEvent.click(screen.getByLabelText(/^Farmer/));
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(screen.getByText('Password must include at least one letter and one number.')).toBeTruthy();
  });

  it('selecting a role marks that option as selected', () => {
    renderForm();

    fireEvent.click(screen.getByLabelText(/^Distributor/));

    expect(screen.getByRole('radio', { name: /^Distributor/ }).checked).toBe(true);
    expect(screen.getByRole('radio', { name: /^Farmer/ }).checked).toBe(false);
  });

  it('sends the cleaned registration values with the chosen role', async () => {
    const { onRegister } = renderForm();

    fill({ name: '  Ravi Retail ', username: '  Ravi.Retail ' });
    fireEvent.click(screen.getByLabelText(/^Retailer/));
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() =>
      expect(onRegister).toHaveBeenCalledWith({
        fullName: 'Ravi Retail',
        username: 'Ravi.Retail',
        password: 'Sunrise2026',
        confirmPassword: 'Sunrise2026',
        role: 'retailer',
      }),
    );
  });

  it('shows the server field error on the username and keeps the other values', async () => {
    const error = new ApiError('failed', {
      status: 409,
      body: {
        error: {
          message: 'That username is already taken.',
          details: { username: 'This username is already taken. Choose another.' },
        },
      },
    });
    renderForm(vi.fn().mockRejectedValue(error));

    fill();
    fireEvent.click(screen.getByLabelText(/^Farmer/));
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect(await screen.findByText('This username is already taken. Choose another.')).toBeTruthy();
    expect(screen.getByLabelText('Full name').value).toBe('Asha Farmer');
    expect(screen.getByLabelText('Username').value).toBe('asha.farmer');
    expect(screen.getByLabelText('Password').value).toBe('');
    expect(screen.getByRole('radio', { name: /^Farmer/ }).checked).toBe(true);
  });

  it('shows a general message when the server rejects without field details', async () => {
    renderForm(
      vi.fn().mockRejectedValue(
        new ApiError('failed', { status: 500, body: { error: { message: 'An unexpected error occurred.' } } }),
      ),
    );

    fill();
    fireEvent.click(screen.getByLabelText(/^Farmer/));
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    expect((await screen.findByRole('alert')).textContent).toBe('An unexpected error occurred.');
  });

  it('sends one registration for a double click and disables the form while it is in progress', async () => {
    let finish;
    const onRegister = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderForm(onRegister);

    fill();
    fireEvent.click(screen.getByLabelText(/^Farmer/));
    const button = screen.getByRole('button', { name: 'Create Account' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onRegister).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Creating account…' }).disabled).toBe(true);
    finish({});
  });
});
