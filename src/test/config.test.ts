import { load } from '../config';
import * as path from 'path';
import * as assert from 'assert';

// don't warn in tests
console.warn = () => null;

async function throws(fn: () => Promise<any>): Promise<void> {
  let didThrow = false;

  try {
    await fn();
  } catch (err) {
    didThrow = true;
  }

  if (!didThrow) {
    throw new Error('Assertion failed');
  }
}

const fixture = (name: string) =>
  path.join(
    path.dirname(path.dirname(__dirname)),
    'src',
    'test',
    'fixtures',
    name
  );
const cwd = fixture('config');

describe('load', async () => {
  it('should load a well-formed config file.', async () => {
    const configWithTwoBackends = await load(path.join(cwd, 'config.json'));
    assert.deepEqual(configWithTwoBackends.backends, {
      oss: {
        'oss-key': 'value',
      },
      'google-drive': {
        'gd-key': 1,
      },
    });
  });

  it('should not load a bad-formed config file.', async () => {
    await throws(() => load(path.join(cwd, 'empty.json')));
    await throws(() => load(path.join(cwd, 'withoutBackends.json')));
    await throws(() => load(path.join(cwd, 'badBackend.json')));
  });
});
