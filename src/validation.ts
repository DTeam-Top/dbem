const parseSemver = require('parse-semver');
import semver from 'semver';

const nameRegex = /^[a-z0-9][a-z0-9\-]*$/i;

export function validatePublisher(publisher: string): void {
  if (!publisher) {
    throw new Error(
      `Missing publisher name. Learn more: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publishing-extensions`
    );
  }

  if (!nameRegex.test(publisher)) {
    throw new Error(
      `Invalid publisher name '${publisher}'. Expected the identifier of a publisher, not its human-friendly name.  Learn more: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publishing-extensions`
    );
  }
}

export function validateExtensionName(name: string | null = null): void {
  if (!name) {
    throw new Error(`Missing extension name`);
  }

  if (!nameRegex.test(name)) {
    throw new Error(`Invalid extension name '${name}'`);
  }
}

export function validateVersion(version: any): void {
  if (!version) {
    throw new Error(`Missing extension version`);
  }

  if (!semver.valid(version)) {
    throw new Error(`Invalid extension version '${version}'`);
  }
}

export function validateEngineCompatibility(version: any): void {
  if (!version) {
    throw new Error(`Missing vscode engine compatibility version`);
  }

  if (!/^\*$|^(\^|>=)?((\d+)|x)\.((\d+)|x)\.((\d+)|x)(\-.*)?$/.test(version)) {
    throw new Error(`Invalid vscode engine compatibility version '${version}'`);
  }
}

/**
 * User shouldn't use a newer version of @types/vscode than the one specified in engines.vscode
 */
export function validateVSCodeTypesCompatibility(
  engineVersion: string,
  typeVersion: string
): void {
  if (engineVersion === '*') {
    return;
  }

  if (!typeVersion) {
    throw new Error(`Missing @types/vscode version`);
  }

  let plainEngineVersion: string, plainTypeVersion: string;

  try {
    const engineSemver = parseSemver(`vscode@${engineVersion}`);
    plainEngineVersion = engineSemver.version;
  } catch (err) {
    throw new Error('Failed to parse semver of engines.vscode');
  }

  try {
    const typeSemver = parseSemver(`@types/vscode@${typeVersion}`);
    plainTypeVersion = typeSemver.version;
  } catch (err) {
    throw new Error('Failed to parse semver of @types/vscode');
  }

  // For all `x`, use smallest version for comparison
  plainEngineVersion = plainEngineVersion.replace(/x/g, '0');

  const [typeMajor, typeMinor, typePatch] = plainTypeVersion
    .split('.')
    .map(x => {
      try {
        return +x;
      } catch (err) {
        return 0;
      }
    });
  const [engineMajor, engineMinor, enginePatch] = plainEngineVersion
    .split('.')
    .map(x => {
      try {
        return +x;
      } catch (err) {
        return 0;
      }
    });

  const error = new Error(
    `@types/vscode ${typeVersion} greater than engines.vscode ${engineVersion}. Consider upgrade engines.vscode or use an older @types/vscode version`
  );

  if (
    typeof typeMajor === 'number' &&
    typeof engineMajor === 'number' &&
    typeMajor > engineMajor
  ) {
    throw error;
  }
  if (
    typeof typeMinor === 'number' &&
    typeof engineMinor === 'number' &&
    typeMinor > engineMinor
  ) {
    throw error;
  }
  if (
    typeof typePatch === 'number' &&
    typeof enginePatch === 'number' &&
    typePatch > enginePatch
  ) {
    throw error;
  }
}
