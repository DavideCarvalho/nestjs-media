// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NuqsHashAdapter } from '../aviary-kit/url-state/nuqs-hash-adapter';
import { DataTable, sortParam } from './DataTable.js';

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const HEADER = ['name', 'status', 'amount'];
const BODY = [
  ['alice', 'paid', '30'],
  ['bob', 'open', '10'],
  ['carol', 'paid', '20'],
];

/** Point the test environment at `url` without a navigation. */
function goTo(url: string) {
  window.history.replaceState(null, '', url);
}

function renderGrid() {
  return render(
    <NuqsHashAdapter>
      <DataTable header={HEADER} body={BODY} />
    </NuqsHashAdapter>,
  );
}

/** The first cell of every rendered body row, top to bottom. */
function names(): string[] {
  return [...document.querySelectorAll('tbody tr')]
    .map((row) => row.querySelector('td')?.textContent ?? '')
    .filter((name) => name !== '');
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
});

afterEach(async () => {
  cleanup();
  // nuqs flushes URL writes on a short throttle; let a queued one land before the next test.
  await new Promise((resolve) => setTimeout(resolve, 80));
  vi.unstubAllGlobals();
});

describe('DataTable: filter and sort in the URL', () => {
  it('opens filtered and sorted from a shared link to the preview', () => {
    goTo('/media#/disks/primary?preview=bills.csv&q=paid&sort=2.desc');
    renderGrid();
    expect(names()).toEqual(['alice', 'carol']);
    expect((screen.getByPlaceholderText('filter all columns…') as HTMLInputElement).value).toBe(
      'paid',
    );
  });

  it('typing rewrites the history entry; a sort click adds one, and Back undoes it', async () => {
    goTo('/media?tenant=acme#/disks/primary?preview=bills.csv');
    renderGrid();
    const start = window.history.length;

    fireEvent.change(screen.getByPlaceholderText('filter all columns…'), {
      target: { value: 'paid' },
    });
    await waitFor(() =>
      expect(window.location.hash).toBe('#/disks/primary?preview=bills.csv&q=paid'),
    );
    expect(window.history.length).toBe(start);
    expect(window.location.search).toBe('?tenant=acme');

    fireEvent.click(screen.getByRole('button', { name: /amount/i }));
    await waitFor(() =>
      expect(window.location.hash).toBe('#/disks/primary?preview=bills.csv&q=paid&sort=2.asc'),
    );
    expect(window.history.length).toBe(start + 1);
    expect(names()).toEqual(['carol', 'alice']);

    act(() => window.history.back());
    await waitFor(() => expect(names()).toEqual(['alice', 'carol']));
  });

  it('reset takes the filter and the sort out of the URL', async () => {
    goTo('/media#/disks/primary?preview=bills.csv&q=paid&sort=0.desc');
    renderGrid();
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    await waitFor(() => expect(window.location.hash).toBe('#/disks/primary?preview=bills.csv'));
    expect(names()).toEqual(['alice', 'bob', 'carol']);
  });
});

describe('DataTable: a sort on a column the file lacks', () => {
  it('is ignored: file order, and no reset offered', () => {
    goTo('/media#/disks/primary?preview=bills.csv&sort=9.desc');
    renderGrid();
    expect(names()).toEqual(['alice', 'bob', 'carol']);
    expect(screen.queryByRole('button', { name: 'reset' })).toBeNull();
  });
});

describe('sortParam', () => {
  it('round-trips `<column>.<dir>` and rejects anything else', () => {
    expect(sortParam.serialize({ index: 2, dir: 'desc' })).toBe('2.desc');
    expect(sortParam.parse('2.desc')).toEqual({ index: 2, dir: 'desc' });
    expect(sortParam.parse('x.asc')).toBeNull();
    expect(sortParam.parse('1.up')).toBeNull();
  });
});
