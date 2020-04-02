import * as cp from 'child_process';
import * as fs from 'fs';
import _ from 'lodash';
import * as path from 'path';
import { CancellationToken } from './util';
const parseSemver = require('parse-semver');

interface Options {
  cwd?: string;
  stdio?: any;
  customFds?: any;
  env?: any;
  timeout?: number;
  maxBuffer?: number;
  killSignal?: string;
}

function parseStdout({ stdout }: { stdout: string }): string {
  return stdout.split(/[\r\n]/).filter(line => !!line)[0];
}

function exec(
  command: string,
  options: Options = {},
  cancellationToken?: CancellationToken
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((c, e) => {
    let disposeCancellationListener: Function | null = null;

    const child = cp.exec(
      command,
      { ...options, encoding: 'utf8' } as any,
      (err, stdout: string, stderr: string) => {
        if (disposeCancellationListener) {
          disposeCancellationListener();
          disposeCancellationListener = null;
        }

        if (err) {
          return e(err);
        }
        c({ stdout, stderr });
      }
    );

    if (cancellationToken) {
      disposeCancellationListener = cancellationToken.subscribe((err: any) => {
        child.kill();
        e(err);
      });
    }
  });
}

async function checkNPM(cancellationToken?: CancellationToken): Promise<void> {
  return exec('npm -v', {}, cancellationToken).then(({ stdout }) => {
    const version = stdout.trim();

    if (/^3\.7\.[0123]$/.test(version)) {
      return Promise.reject(
        `npm@${version} doesn't work with vsce. Please update npm: npm install -g npm`
      );
    } else {
      return;
    }
  });
}

async function getNpmDependencies(cwd: string): Promise<string[]> {
  return checkNPM()
    .then(() =>
      exec('npm list --production --parseable --depth=99999 --loglevel=error', {
        cwd,
        maxBuffer: 5000 * 1024,
      })
    )
    .then(({ stdout }) =>
      stdout.split(/[\r\n]/).filter(dir => path.isAbsolute(dir))
    );
}

interface YarnTreeNode {
  name: string;
  children: YarnTreeNode[];
}

export interface YarnDependency {
  name: string;
  path: string;
  children: YarnDependency[];
}

function asYarnDependency(
  prefix: string,
  tree: YarnTreeNode,
  prune: boolean
): YarnDependency | null {
  if (prune && /@[\^~]/.test(tree.name)) {
    return null;
  }

  let name: string;

  try {
    const parseResult = parseSemver(tree.name);
    name = parseResult.name;
  } catch (err) {
    name = tree.name.replace(/^([^@+])@.*$/, '$1');
  }

  const dependencyPath = path.join(prefix, name);
  const children: YarnDependency[] = [];

  for (const child of tree.children || []) {
    const dep = asYarnDependency(
      path.join(prefix, name, 'node_modules'),
      child,
      prune
    );

    if (dep) {
      children.push(dep);
    }
  }

  return { name, path: dependencyPath, children };
}

function selectYarnDependencies(
  deps: YarnDependency[],
  packagedDependencies: string[] | undefined
): YarnDependency[] {
  const index = new (class {
    private data: { [name: string]: YarnDependency } = Object.create(null);
    constructor() {
      for (const dep of deps) {
        if (this.data[dep.name]) {
          throw Error(`Dependency seen more than once: ${dep.name}`);
        }
        this.data[dep.name] = dep;
      }
    }
    find(name: string): YarnDependency {
      const result = this.data[name];
      if (!result) {
        throw new Error(`Could not find dependency: ${name}`);
      }
      return result;
    }
  })();

  const reached = new (class {
    values: YarnDependency[] = [];
    add(dep: YarnDependency): boolean {
      if (this.values.indexOf(dep) < 0) {
        this.values.push(dep);
        return true;
      }
      return false;
    }
  })();

  const visit = (name: string) => {
    const dep = index.find(name);
    if (!reached.add(dep)) {
      // already seen -> done
      return;
    }
    for (const child of dep.children) {
      visit(child.name);
    }
  };
  if (packagedDependencies) {
    packagedDependencies.forEach(visit);
  }
  return reached.values;
}

async function getYarnProductionDependencies(
  cwd: string,
  packagedDependencies?: string[]
): Promise<YarnDependency[]> {
  const raw = await new Promise<string>((c, e) =>
    cp.exec(
      'yarn list --prod --json',
      {
        cwd,
        encoding: 'utf8',
        env: { ...process.env },
        maxBuffer: 5000 * 1024,
      },
      (err, stdout) => (err ? e(err) : c(stdout))
    )
  );
  const match = /^{"type":"tree".*$/m.exec(raw);

  if (!match || match.length !== 1) {
    throw new Error('Could not parse result of `yarn list --json`');
  }

  const usingPackagedDependencies = Array.isArray(packagedDependencies);
  const trees = JSON.parse(match[0]).data.trees as YarnTreeNode[];

  let result: YarnDependency[] = trees
    .map(tree =>
      asYarnDependency(
        path.join(cwd, 'node_modules'),
        tree,
        !usingPackagedDependencies
      )
    )
    .filter(dep => !!dep) as YarnDependency[];

  if (usingPackagedDependencies) {
    result = selectYarnDependencies(result, packagedDependencies);
  }

  return result;
}

async function getYarnDependencies(
  cwd: string,
  packagedDependencies?: string[]
): Promise<string[]> {
  const result: string[] = [cwd];

  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
    const deps = await getYarnProductionDependencies(cwd, packagedDependencies);
    const flatten = (dep: YarnDependency) => {
      result.push(dep.path);
      dep.children.forEach(flatten);
    };
    deps.forEach(flatten);
  }

  return _.uniq(result);
}

export function getDependencies(
  cwd: string,
  useYarn = false,
  packagedDependencies?: string[]
): Promise<string[]> {
  return useYarn
    ? getYarnDependencies(cwd, packagedDependencies)
    : getNpmDependencies(cwd);
}

export function getLatestVersion(
  name: string,
  cancellationToken?: CancellationToken
): Promise<string> {
  return checkNPM(cancellationToken)
    .then(() => exec(`npm show ${name} version`, {}, cancellationToken))
    .then(parseStdout);
}
