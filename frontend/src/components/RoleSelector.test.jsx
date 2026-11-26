// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import RoleSelector from './RoleSelector.jsx';

const ROLES = [
  { key: 'farmer', label: 'Farmer', description: 'Register product batches.' },
  { key: 'distributor', label: 'Distributor', description: 'Record shipments.' },
  { key: 'retailer', label: 'Retailer', description: 'Confirm receipt.' },
];

describe('RoleSelector', () => {
  afterEach(() => {
    cleanup();
  });

  it('displays all three role options with their descriptions', () => {
    render(<RoleSelector roles={ROLES} onSelect={() => {}} />);

    expect(screen.getByRole('button', { name: /^Farmer/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Distributor/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Retailer/ })).toBeTruthy();
    expect(screen.getByText('Register product batches.')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('calls onSelect with the role key of the chosen option', () => {
    const onSelect = vi.fn();
    render(<RoleSelector roles={ROLES} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /^Distributor/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('distributor');
  });

  it('disables every option while a request is in progress', () => {
    const onSelect = vi.fn();
    render(<RoleSelector roles={ROLES} onSelect={onSelect} disabled />);

    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => expect(button.disabled).toBe(true));

    fireEvent.click(buttons[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
