import { cloneDeepWith } from 'lodash';
import { Manifest } from './manifest';

export interface Translations {
  [key: string]: string;
}

const regex = /^%([\w\d.]+)%$/i;

function patcher(translations: Translations) {
  return (value: string) => {
    if (typeof value !== 'string') {
      return;
    }

    const match = regex.exec(value);

    if (!match) {
      return;
    }

    return translations[match[1]] || value;
  };
}

export function patchNLS(
  manifest: Manifest,
  translations: Translations
): Manifest {
  return cloneDeepWith(manifest, patcher(translations)) as Manifest;
}
