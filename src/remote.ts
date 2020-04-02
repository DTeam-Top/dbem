import * as cp from 'child_process';
import denodeify from 'denodeify';
import * as semver from 'semver';
import * as tmp from 'tmp';
import * as config from './config';
import { Manifest } from './manifest';
import { pack, readManifest } from './package';
import * as provider from './provider';
import { log, readManifestFromPackage } from './util';

const exec = denodeify<
  string,
  { cwd?: string; env?: any },
  { stdout: string; stderr: string }
>(cp.exec as any, (err, stdout, stderr) => [err, { stdout, stderr }]);
const tmpName = denodeify<string>(tmp.tmpName);

export interface RemoteCommandOptions {
  name?: string;
  version?: string;
  config: string;
  backend?: string;
}

export interface ListRemoteOption extends RemoteCommandOptions {}

export interface ShowOption extends RemoteCommandOptions {}

export interface PublishOptions extends RemoteCommandOptions {
  cwd?: string;
  force?: boolean;
  packagePath?: string;
  message?: string;
  baseContentUrl?: string;
  baseImagesUrl?: string;
  yarn?: boolean;
  noVerify?: boolean;
  ignoreFile?: string;
}

export interface UnpublishOptions extends RemoteCommandOptions {
  cwd?: string;
}

async function getProvider(
  conf: string,
  backend?: string
): Promise<provider.Provider> {
  const content = await config.load(conf);
  if (!content) {
    return Promise.reject(`Load config from ${conf} failed.`);
  }

  const b = backend || Object.keys(content.backends)[0];
  const backendOpts = content.backends[b as config.BackendsSupported];
  const api = provider.getProvider(b, backendOpts);
  if (!api) {
    return Promise.reject(`Could not find a provider for backend: ${backend}`);
  } else {
    return Promise.resolve(api);
  }
}

export async function listRemote(options: ListRemoteOption): Promise<any> {
  const api = await getProvider(options.config, options.backend);
  const result = await api.listRemoteExtensions();
  console.log(JSON.stringify(result, undefined, '\t'));
  return result;
}

export async function show(options: ShowOption): Promise<any> {
  if (!options.name) {
    return Promise.reject('Extension name must be provided.');
  }

  const api = await getProvider(options.config, options.backend);
  let result: provider.ExtensionDetails | provider.ExtensionHistory;
  if (!options.version) {
    result = await api.showExtensionHistory(options.name);
  } else {
    result = await api.showExtensionDetails(options.name, options.version);
  }
  console.log(JSON.stringify(result, undefined, '\t'));
  return result;
}

async function versionBump(
  cwd: string = process.cwd(),
  version?: string,
  commitMessage?: string
): Promise<void> {
  if (!version) {
    return Promise.resolve();
  }

  switch (version) {
    case 'major':
    case 'minor':
    case 'patch':
      break;
    case 'premajor':
    case 'preminor':
    case 'prepatch':
    case 'prerelease':
    case 'from-git':
      return Promise.reject(`Not supported: ${version}`);
    default:
      if (!semver.valid(version)) {
        return Promise.reject(`Invalid version ${version}`);
      }
  }

  let command = `npm version ${version}`;

  if (commitMessage) {
    command = `${command} -m "${commitMessage}"`;
  }

  // call `npm version` to do our dirty work
  try {
    const { stdout, stderr } = await exec(command, { cwd });
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    return Promise.resolve();
  } catch (err) {
    return Promise.reject(err.message);
  }
}

async function _publish(
  api: provider.Provider,
  packagePath: string,
  manifest: Manifest,
  force = false
): Promise<boolean> {
  const extId = `${manifest.publisher}.${manifest.name}`;
  const fullName = `${extId}@${manifest.version}`;
  console.log(`Publishing ${fullName}...`);

  const exist = await api.checkExtension(extId, manifest.version);
  if (exist && !force) {
    return Promise.reject(
      `Extension ${fullName} exists, please try --force if you insist.`
    );
  }

  if (exist) {
    const unpublishExtension = await api.unpublishExtension(
      extId,
      manifest.version
    );
    if (!unpublishExtension) {
      return Promise.reject(
        `Could not unpublish Extension ${fullName} before publish.`
      );
    }
  }

  const result = await api.publishExtension(packagePath, manifest);
  if (result) {
    log.done(`Publish extension: ${fullName} succeeded!`);
  } else {
    log.error(`Publish extension: ${fullName} failed!`);
  }

  return result;
}

export async function publish(options: PublishOptions): Promise<any> {
  let manifest: Manifest;
  let packagePath: string;

  if (options.packagePath) {
    if (options.version) {
      return Promise.reject(`Not supported: packagePath and version.`);
    }

    manifest = await readManifestFromPackage(options.packagePath);
    packagePath = options.packagePath;
  } else {
    const cwd = options.cwd;
    const baseContentUrl = options.baseContentUrl;
    const baseImagesUrl = options.baseImagesUrl;
    const useYarn = options.yarn;
    const ignoreFile = options.ignoreFile;

    await versionBump(cwd, options.version, options.message);
    packagePath = await tmpName();
    manifest = (
      await pack({
        packagePath,
        cwd,
        baseContentUrl,
        baseImagesUrl,
        useYarn,
        ignoreFile,
      })
    ).manifest;
  }

  if (!options.noVerify && manifest.enableProposedApi) {
    return Promise.reject(
      "Extensions using proposed API (enableProposedApi: true) can't be published."
    );
  }

  const api = await getProvider(options.config, options.backend);
  return _publish(api, packagePath, manifest, options.force);
}

export async function unpublish(options: UnpublishOptions): Promise<any> {
  let extId: string = options.name!;
  if (!extId) {
    const cwd = options.cwd || process.cwd();
    const manifest: Manifest = await readManifest(cwd);
    extId = manifest.publisher + '.' + manifest.name;
  }

  const api = await getProvider(options.config, options.backend);
  const result = await api.unpublishExtension(extId, options.version);
  if (result) {
    log.done(`Unpublish extension: ${extId} succeeded!`);
  } else {
    log.error(`Unpublish extension: ${extId} failed!`);
  }
  return result;
}
