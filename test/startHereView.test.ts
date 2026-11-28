import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StartHereView } from '../src/components/StartHereView';
import { FaqView } from '../src/components/FaqView';

const noop = () => {};

test('simple start distinguishes fictional practice data and makes the next actions clear', () => {
  const html = renderToStaticMarkup(React.createElement(StartHereView, {
    isSampleData: true,
    transactionCount: 30,
    alertCount: 1,
    onOpenImport: noop,
    onNavigate: noop,
  }));
  assert.match(html, /practice numbers/);
  assert.match(html, /fictional/);
  assert.doesNotMatch(html, /spending alert/);
  assert.match(html, /Choose a statement/);
  assert.match(html, /Open Overview/);
  assert.match(html, /never cancels a bill or moves money/);
});

test('simple start does not call an empty ledger imported data', () => {
  const html = renderToStaticMarkup(React.createElement(StartHereView, {
    isSampleData: false,
    transactionCount: 0,
    alertCount: 1,
    onOpenImport: noop,
    onNavigate: noop,
  }));
  assert.match(html, /No statements have been added yet/);
  assert.doesNotMatch(html, /One spending alert needs a look/);
  assert.doesNotMatch(html, /Your imported statements are ready/);
});

test('simple start routes a real imported-ledger alert to Overview', () => {
  const html = renderToStaticMarkup(React.createElement(StartHereView, {
    isSampleData: false,
    transactionCount: 30,
    alertCount: 1,
    onOpenImport: noop,
    onNavigate: noop,
  }));
  assert.match(html, /One spending alert needs a look/);
});

test('help opens with plain-language topics rather than technical key configuration', () => {
  const html = renderToStaticMarkup(React.createElement(FaqView, { onNavigate: noop }));
  assert.match(html, /Help, in plain English/);
  assert.match(html, /What does Clearledger do/);
  assert.match(html, /New here/);
  assert.doesNotMatch(html, /AI Provider Secret Hygiene Reference/);
});
