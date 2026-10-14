import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Self bubbles must stay readable with MarkdownText (which forces label-primary on descendants). */
test('self message bubble does not use label-primary as fill (black-on-black with MarkdownText)', async () => {
  const css = await readFile(new URL('../src/client/rooms.css', import.meta.url), 'utf8');
  const block = css.match(/\.rm-msg-self\s+\.rm-msg-body\s*\{[^}]+\}/);
  assert.ok(block, 'expected .rm-msg-self .rm-msg-body rule');
  const rule = block[0];
  assert.equal(
    /background:\s*var\(\s*--dsw-alias-label-primary\s*\)/.test(rule),
    false,
    'label-primary is near-black text; using it as bubble fill hides MarkdownText',
  );
  assert.match(rule, /--dsw-specific-bubble|--dsw-alias-button-primary-fill|--rm-accent/);
  assert.match(rule, /color:\s*var\(\s*--rm-label\s*\)|color:\s*var\(\s*--dsw-alias-label-primary\s*\)|color:\s*var\(\s*--dsw-alias-label-primary-foreground\s*\)/);
});

test('bundled client embeds the soft self-bubble background token', async () => {
  const client = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8');
  assert.match(client, /rm-msg-self/);
  assert.match(client, /dsw-specific-bubble/);
  assert.equal(
    /rm-msg-self[^"]*background:\\?s*var\(--dsw-alias-label-primary\)/.test(client) ||
      /\.rm-msg-self \.rm-msg-body\{[^}]*background:var\(--dsw-alias-label-primary\)/.test(client),
    false,
    'dist client must not ship label-primary self-bubble fill',
  );
});
