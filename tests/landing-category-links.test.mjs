import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');

for (const [label, category] of [
  ['Roses', 'roses'],
  ['Other Flowers', 'other-flowers'],
  ['Greenery', 'foliage'],
  ['Supplies', 'supplies'],
]) {
  test(`${label} card opens its filtered catalog category`, () => {
    const card = indexHtml
      .split('<a class="room fx-pop"')
      .find((entry) => entry.includes(`<h3>${label}</h3>`));

    assert.ok(card, `${label} card is present`);
    assert.match(card, new RegExp(`^ href="/catalog\\?category=${category}"`));
  });
}
