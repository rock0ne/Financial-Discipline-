import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePickedStatement } from '../src/utils/nativeStatementFolder';

test('native statement bytes become a local File with a folder-relative path', async () => {
  const picked = decodePickedStatement(
    { id: 0, name: 'statement.csv', displayPath: 'Four months/statement.csv', size: 16 },
    btoa('Date,Amount\n1,2\n')
  );
  assert.equal(picked.displayPath, 'Four months/statement.csv');
  assert.equal(picked.file.name, 'statement.csv');
  assert.equal(await picked.file.text(), 'Date,Amount\n1,2\n');
});

test('native statement decoder rejects invalid or oversized bridge payloads', () => {
  assert.throws(() => decodePickedStatement(
    { id: 0, name: 'x.pdf', displayPath: 'x.pdf', size: 1 },
    'data:application/pdf;base64,QQ=='
  ));
  assert.throws(() => decodePickedStatement(
    { id: -1, name: 'x.pdf', displayPath: 'x.pdf', size: 1 },
    'QQ=='
  ));
});
