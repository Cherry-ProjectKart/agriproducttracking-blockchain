// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AccountSettingsPage from './AccountSettingsPage.jsx';
import * as settings from '../services/accountSettingsService.js';
import { ApiError } from '../services/apiClient.js';

vi.mock('../services/accountSettingsService.js', () => ({
  fetchAccount: vi.fn(),
  updateProfile: vi.fn(),
  updatePreferences: vi.fn(),
  changePassword: vi.fn(),
}));

const ACCOUNT = {
  username: 'demo.farmer',
  full_name: 'Demo Farmer',
  role: 'farmer',
  role_label: 'Farmer',
  created_at: '2026-11-27T10:00:00.000Z',
  updated_at: null,
  grid_density: 'comfortable',
};

function apiError(status, message, details) {
  return new ApiError(`failed ${status}`, { status, body: { error: { code: status, message, ...(details ? { details } : {}) } } });
}

function renderPage(onChanged = vi.fn()) {
  render(<AccountSettingsPage onChanged={onChanged} />);
  return { onChanged };
}

async function ready() {
  return screen.findByRole('heading', { name: 'Account settings' });
}

describe('AccountSettingsPage', () => {
  beforeEach(() => {
    settings.fetchAccount.mockResolvedValue(ACCOUNT);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a loading state, then the profile, preference and password sections', async () => {
    renderPage();

    expect(screen.getByText('Loading your account…')).toBeTruthy();
    await ready();
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeTruthy();
  });

  it('loads the account behind the session and shows its real details', async () => {
    renderPage();
    await ready();

    expect(settings.fetchAccount).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Full name').value).toBe('Demo Farmer');
    expect(screen.getByLabelText('Username').value).toBe('demo.farmer');
    expect(screen.getByText('Farmer', { selector: 'dd' })).toBeTruthy();
  });

  it('shows the role as read-only text, with no control to change it', async () => {
    renderPage();
    await ready();

    expect(screen.queryByLabelText(/role/i, { selector: 'select, input' })).toBeNull();
    expect(screen.getByText('Your role is set when the account is created and cannot be changed here.')).toBeTruthy();
  });

  it('shows an error and a retry when the account cannot be loaded', async () => {
    settings.fetchAccount.mockRejectedValueOnce(new ApiError('Network error'));
    renderPage();

    expect(await screen.findByText('Could not load your account. Make sure the backend is running.')).toBeTruthy();
    settings.fetchAccount.mockResolvedValueOnce(ACCOUNT);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByLabelText('Full name')).toBeTruthy();
  });

  it('saves a changed name, shows success and refreshes the session', async () => {
    settings.updateProfile.mockResolvedValue({ ...ACCOUNT, full_name: 'Asha Grower' });
    const { onChanged } = renderPage();
    await ready();

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '  Asha Grower ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('Profile saved.')).toBeTruthy();
    expect(settings.updateProfile).toHaveBeenCalledWith({ fullName: 'Asha Grower', username: 'demo.farmer' });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('validates the profile before sending anything', async () => {
    renderPage();
    await ready();

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('Enter your full name.')).toBeTruthy();
    expect(settings.updateProfile).not.toHaveBeenCalled();
  });

  it('shows a duplicate username from the server beside the username field', async () => {
    settings.updateProfile.mockRejectedValue(
      apiError(409, 'That username is already taken.', { username: 'This username is already taken. Choose another.' }),
    );
    renderPage();
    await ready();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'taken.name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('This username is already taken. Choose another.')).toBeTruthy();
    expect(screen.getByLabelText('Username').value).toBe('taken.name');
  });

  it('Cancel restores the saved profile values without sending anything', async () => {
    renderPage();
    await ready();

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Something Else' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);

    expect(screen.getByLabelText('Full name').value).toBe('Demo Farmer');
    expect(settings.updateProfile).not.toHaveBeenCalled();
  });

  it('saves the density preference and reports it', async () => {
    settings.updatePreferences.mockResolvedValue({ ...ACCOUNT, grid_density: 'compact' });
    const { onChanged } = renderPage();
    await ready();

    fireEvent.click(screen.getByRole('radio', { name: /Compact/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(await screen.findByText('Table density saved.')).toBeTruthy();
    expect(settings.updatePreferences).toHaveBeenCalledWith('compact');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('Cancel on preferences returns to the saved density', async () => {
    renderPage();
    await ready();

    fireEvent.click(screen.getByRole('radio', { name: /Compact/ }));
    fireEvent.click(within(screen.getByRole('heading', { name: 'Preferences' }).parentElement).getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('radio', { name: /Comfortable/ }).checked).toBe(true);
    expect(settings.updatePreferences).not.toHaveBeenCalled();
  });

  it('validates the password form before sending anything', async () => {
    renderPage();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Enter your current password.')).toBeTruthy();
    expect(settings.changePassword).not.toHaveBeenCalled();
  });

  it('changes the password, reports success and clears every password field', async () => {
    settings.changePassword.mockResolvedValue('Your password has been changed.');
    renderPage();
    await ready();

    const current = screen.getByLabelText('Current password');
    fireEvent.change(current, { target: { value: 'FarmerDemo2026' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'BrandNew2027' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'BrandNew2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Your password has been changed.')).toBeTruthy();
    expect(settings.changePassword).toHaveBeenCalledWith({
      currentPassword: 'FarmerDemo2026',
      newPassword: 'BrandNew2027',
      confirmPassword: 'BrandNew2027',
    });
    expect(screen.getByLabelText('Current password').value).toBe('');
    expect(screen.getByLabelText('New password').value).toBe('');
    expect(screen.getByLabelText('Confirm new password').value).toBe('');
  });

  it('a wrong current password is reported and no password stays in the fields', async () => {
    settings.changePassword.mockRejectedValue(
      apiError(400, 'Please correct the highlighted fields.', { current_password: 'Your current password is incorrect.' }),
    );
    renderPage();
    await ready();

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'NotIt1234' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'BrandNew2027' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'BrandNew2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Your current password is incorrect.')).toBeTruthy();
    expect(screen.getByLabelText('Current password').value).toBe('');
    expect(screen.getByLabelText('New password').value).toBe('');
  });

  it('the password fields can be shown and hidden', async () => {
    renderPage();
    await ready();

    const input = screen.getByLabelText('Current password');
    expect(input.getAttribute('type')).toBe('password');
    fireEvent.click(screen.getAllByRole('button', { name: 'Show current password' })[0]);
    expect(input.getAttribute('type')).toBe('text');
  });
});
