// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SignInForm from './SignInForm.jsx';
import { ApiError } from '../../services/apiClient.js';

afterEach(cleanup);

function renderForm(onSignIn = vi.fn().mockResolvedValue({})) {
  const onNavigate = vi.fn();
  render(<SignInForm onSignIn={onSignIn} onNavigate={onNavigate} />);
  return { onSignIn, onNavigate };
}

function type(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('SignInForm', () => {
  it('renders username, password, show/hide control, Sign In button and create-account link', () => {
    renderForm();

    expect(screen.getByLabelText('Username')).toBeTruthy();
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeTruthy();
  });

  it('reveals and hides the password', () => {
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password');
  });

  it('requires a username and a password before sending anything', () => {
    const { onSignIn } = renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(screen.getByText('Enter your username.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it('sends only the credentials, trimming the username', async () => {
    const { onSignIn } = renderForm();

    type('Username', '  demo.farmer ');
    type('Password', 'FarmerDemo2026');
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() =>
      expect(onSignIn).toHaveBeenCalledWith({ username: 'demo.farmer', password: 'FarmerDemo2026' }),
    );
  });

  it('shows the generic invalid-credentials message, keeps the username and clears the password', async () => {
    const error = new ApiError('failed', {
      status: 401,
      body: { error: { message: 'Username or password is incorrect.' } },
    });
    renderForm(vi.fn().mockRejectedValue(error));

    type('Username', 'demo.farmer');
    type('Password', 'WrongPassword1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Username or password is incorrect.');
    expect(screen.getByLabelText('Username').value).toBe('demo.farmer');
    expect(screen.getByLabelText('Password').value).toBe('');
  });

  it('shows a network message when the server cannot be reached', async () => {
    renderForm(vi.fn().mockRejectedValue(new ApiError('Network error while contacting the API.')));

    type('Username', 'demo.farmer');
    type('Password', 'FarmerDemo2026');
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server');
  });

  it('disables the form while signing in and sends one request for a double click', async () => {
    let finish;
    const onSignIn = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderForm(onSignIn);

    type('Username', 'demo.farmer');
    type('Password', 'FarmerDemo2026');
    const button = screen.getByRole('button', { name: 'Sign In' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Signing in…' }).disabled).toBe(true);
    expect(screen.getByLabelText('Username').disabled).toBe(true);
    finish({});
  });

  it('navigates to registration from the create-account link', () => {
    const { onNavigate } = renderForm();

    fireEvent.click(screen.getByRole('link', { name: 'Create an account' }));

    expect(onNavigate).toHaveBeenCalledWith('/register');
  });
});
