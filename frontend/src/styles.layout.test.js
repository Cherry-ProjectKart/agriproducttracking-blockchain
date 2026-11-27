import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Static guard for the BPT-103 layout rules. jsdom cannot measure layout, so these tests check that the
// rules that prevent page-level overflow are present. The real widths were verified in a browser at
// 375, 768, 1024 and 1440 px (see the PR description).
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of every rule whose selector list includes the given selector, joined together. */
function declarationsFor(selector) {
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const matching = blocks.filter(([, selectors]) =>
    selectors.split(',').map((part) => part.trim()).includes(selector),
  );
  if (matching.length === 0) return '';
  return matching.map(([, , body]) => body).join('\n');
}

describe('workspace layout rules (BPT-103)', () => {
  it('makes each table wrapper the scroll container for its table and its hidden header text', () => {
    const wrapper = declarationsFor('.table-wrapper');

    expect(wrapper).toMatch(/position:\s*relative/);
    expect(wrapper).toMatch(/overflow:\s*auto/);
    expect(wrapper).toMatch(/max-width:\s*100%/);
  });

  it('keeps table headers visible while the rows scroll', () => {
    const header = declarationsFor('.batch-table thead th') + declarationsFor('.ledger-table thead th');

    expect(header).toMatch(/position:\s*sticky/);
    expect(header).toMatch(/top:\s*0/);
  });

  it('keeps workspace cards and grids from forcing the page wider than the screen', () => {
    const cards = declarationsFor('.workspace') + declarationsFor('.workspace-card');

    expect(cards).toMatch(/min-width:\s*0/);
    expect(cards).toMatch(/max-width:\s*100%/);
  });

  it('tightens workspace spacing on narrow screens', () => {
    expect(css).toMatch(/@media \(max-width: 600px\)\s*\{[^@]*\.workspace\s*\{\s*padding:\s*1rem/);
  });

  it('marks the active navigation section visibly', () => {
    expect(declarationsFor('.role-nav__link--active')).toMatch(/background:/);
  });
});
