import * as assert from 'assert';
import * as path from 'path';
import { listRemote, publish, show, unpublish } from '../remote';

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
const cwd = fixture('remote');

describe('listRemote', async () => {
  it('should list extensions on a specific host.', async () => {
    assert.deepEqual(
      await listRemote({
        config: path.join(cwd, 'config.json'),
        backend: 'mock',
      }),
      {
        details: [
          {
            name: 'ext1',
            latestVersion: '0.1',
            lastUpdated: new Date(1995, 11, 17),
          },
        ],
      }
    );
  });

  it('should list extensions on a default host.', async () => {
    assert.deepEqual(
      await listRemote({
        config: path.join(cwd, 'config.json'),
      }),
      {
        details: [
          {
            name: 'ext1',
            latestVersion: '0.1',
            lastUpdated: new Date(1995, 11, 17),
          },
        ],
      }
    );
  });
});

describe('show', async () => {
  it('should show details of an extension by name and version.', async () => {
    assert.deepEqual(
      await show({
        name: 'ext1',
        version: '0.1',
        config: path.join(cwd, 'config.json'),
        backend: 'mock',
      }),
      {
        name: 'ext1',
        version: '0.1',
        description: 'mock extension',
        readMe: 'this is readme',
        changeLog: 'this is changeLog',
        lastUpdated: new Date(1995, 11, 17),
      }
    );
  });

  it('should show history of an extension by only name.', async () => {
    assert.deepEqual(
      await show({
        name: 'ext1',
        config: path.join(cwd, 'config.json'),
        backend: 'mock',
      }),
      {
        name: 'ext1',
        versions: {
          '0.0.1': new Date(1995, 11, 17),
          '0.0.2': new Date(1995, 11, 18),
          '0.1': new Date(1995, 11, 19),
        },
      }
    );
  });
});

describe('unpublish', async () => {
  it('should unpublish an extension.', async () => {
    assert.equal(
      await unpublish({
        name: 'ext1',
        version: '0.1',
        config: path.join(cwd, 'config.json'),
        backend: 'mock',
      }),
      true
    );
  });

  it('should not unpublish an extension.', async () => {
    assert.equal(
      await unpublish({
        name: 'ext2',
        version: '0.1',
        config: path.join(cwd, 'config.json'),
        backend: 'mock',
      }),
      false
    );
    assert.equal(
      await unpublish({
        name: 'ext1',
        version: '1.0',
        config: path.join(cwd, 'config.json'),
        backend: 'mock',
      }),
      false
    );
  });
});

// should use async function() { ... }
// otherwise you can not get correct this instance to set timeout.
describe('publish', async function() {
  this.timeout(60000);

  it('should publish a packaged extension.', async () => {
    assert.equal(
      await publish({
        packagePath: path.join(cwd, 'myext-0.0.1.vsix'),
        config: path.join(cwd, 'config.json'),
        backend: 'mock',
      }),
      true
    );
  });

  it('should publish an extension project.', async () => {
    assert.equal(
      await publish({
        cwd: path.join(cwd, 'myext'),
        config: path.join(cwd, 'config.json'),
        backend: 'mock',
      }),
      true
    );
  });

  it('should not publish an existing extension without force option.', async () => {
    await throws(() =>
      publish({
        packagePath: path.join(cwd, 'myext-0.0.2.vsix'),
        config: path.join(cwd, 'config.json'),
        backend: 'mock',
      })
    );
  });

  it('should publish an existing extension with force option.', async () => {
    assert.equal(
      await publish({
        packagePath: path.join(cwd, 'myext-0.0.2.vsix'),
        force: true,
        config: path.join(cwd, 'config.json'),
        backend: 'mock',
      }),
      true
    );
  });

  it('should not publish a packaged extension with version option.', async () => {
    await throws(() =>
      publish({
        packagePath: path.join(cwd, 'myext-0.0.1.vsix'),
        version: '0.1',
        config: path.join(cwd, 'config.json'),
        backend: 'mock',
      })
    );
  });
});
