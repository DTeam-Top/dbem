import denodeify from 'denodeify';
import * as fs from 'fs';

const readFile = denodeify<string, any, string>(fs.readFile);

export type BackendsSupported =
  | 'oss'
  | 's3'
  | 'github'
  | 'gitlab'
  | 'google-drive'
  | 'dropbox'
  | 'npm';
export type IBackends = { [key in BackendsSupported]: any };
export interface Config {
  backends: IBackends;
}

export interface GetOptions {
  promptToOverwrite?: boolean;
  promptIfMissing?: boolean;
}

export async function load(path: string): Promise<Config> {
  return readFile(path, 'utf8')
    .catch<string>(err =>
      err.code !== 'ENOENT' ? Promise.reject(err) : Promise.resolve('{}')
    )
    .then<Config>((rawConfig: string) => {
      try {
        return Promise.resolve(JSON.parse(rawConfig));
      } catch (e) {
        return Promise.reject(`Error parsing store: ${path}`);
      }
    })
    .then(config => {
      if (!config.backends) {
        return Promise.reject('No backends found!');
      }

      if (
        Object.keys(config.backends).every(
          key =>
            [
              'oss',
              's3',
              'github',
              'gitlab',
              'google-drive',
              'dropbox',
              'npm',
              'mock',
            ].findIndex(backend => backend === key) !== -1
        )
      ) {
        return Promise.resolve(config);
      } else {
        return Promise.reject('Unsupported backend found!');
      }
    });
}
