import { Dropbox, DropboxOptions, files } from 'dropbox';
import { ReadStream } from 'fs';
import { AbstractProvider } from './abstract';
import fetch = require('node-fetch');

export class DropboxProvider extends AbstractProvider {
  private dbx: Dropbox;

  constructor(options: DropboxOptions) {
    super();
    options.fetch = fetch.default;
    this.dbx = new Dropbox(options);
  }

  async readObject(objPath: string): Promise<string> {
    const requestResult: files.FileMetadata = await this.dbx.filesDownload({
      path: '/' + objPath,
    });
    return Promise.resolve((requestResult as any).fileBinary.toString('utf8'));
  }

  async writeObject(objPath: string, content: string): Promise<boolean> {
    return this.dbx
      .filesUpload({
        contents: content,
        path: '/' + objPath,
        mode: { '.tag': 'overwrite' },
      })
      .then(_result => {
        return Promise.resolve(true);
      })
      .catch(err => {
        return Promise.reject(err);
      });
  }

  async putObject(objPath: string, stream: ReadStream): Promise<boolean> {
    return this.dbx
      .filesUpload({
        contents: stream,
        path: '/' + objPath,
        mode: { '.tag': 'overwrite' },
      })
      .then(_result => {
        return Promise.resolve(true);
      })
      .catch(err => {
        return Promise.reject(err);
      });
  }

  async removeObject(objPath: string): Promise<boolean> {
    return this.dbx
      .filesDeleteV2({ path: '/' + objPath })
      .then(_result => {
        return Promise.resolve(true);
      })
      .catch(err => {
        // not found is valid
        return JSON.stringify(err).includes('not_found')
          ? Promise.resolve(true)
          : Promise.reject(err);
      });
  }
}
