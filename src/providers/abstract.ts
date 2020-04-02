import { ReadStream } from 'fs';
import { Manifest } from '../manifest';
import {
  ExtensionShortDetails,
  ExtensionDetails,
  ExtensionHistory,
  ListRemoteResult,
  Provider,
} from '../provider';
import yauzl = require('yauzl');
import fs from 'fs';
import FileType = require('file-type');

// TODO: history version
interface ExtensionMetadata {
  extId: string;
  currentVersion: string;
  // base64 encode of an icon
  icon?: string;
  describe?: string;
  dateCreated: Date;
  lastUpdate: Date;
}

export abstract class AbstractProvider implements Provider {
  private metadataPath = 'metadatas';
  private metadataCache: ExtensionMetadata[] | undefined;
  private icon: string | undefined;
  private readme: string | undefined;
  private changeLog: string | undefined;

  /**
   * Read the object from provider by path
   * @param objPath
   * @returns the content of the object
   */
  abstract readObject(objPath: string): Promise<string>;

  /**
   * Write the object to provider by path with specified content
   * If objPath contains `/`, the related directores should be created.
   * @param objPath
   * @param content
   * @returns success?
   */
  abstract writeObject(objPath: string, content: string): Promise<boolean>;

  /**
   * Put the object to provider by path with file.
   * If objPath contains `/`, the related directores should be created.
   * @param objPath
   * @param stream
   * @returns success?
   */
  abstract putObject(objPath: string, stream: ReadStream): Promise<boolean>;

  /**
   * Remove the object from provider by path.
   * If objPath is a directory, the whole directory should be removed.
   * @param objPath object or directory path should be removed
   * @returns success? Should be true if objPath non-exists
   */
  abstract removeObject(objPath: string): Promise<boolean>;

  private extractNameFromExtId(extId: string): string {
    // extId = <Publisher>.<name>
    return extId.includes('.') ? extId.split('.')[1] : extId;
  }

  private async refreshMetadata(): Promise<ExtensionMetadata[]> {
    return this.readObject(this.metadataPath)
      .then(result => {
        const metadata: string = result;
        this.metadataCache = JSON.parse(metadata) as ExtensionMetadata[];
        return Promise.resolve(this.metadataCache);
      })
      .catch(() => {
        this.metadataCache = [];
        return Promise.resolve(this.metadataCache);
      });
  }

  private async getMetadata(): Promise<ExtensionMetadata[]> {
    if (this.metadataCache) {
      return Promise.resolve(this.metadataCache);
    } else {
      return this.refreshMetadata();
    }
  }

  private async saveMetadata(metadata: ExtensionMetadata[]): Promise<boolean> {
    const content: string = JSON.stringify(metadata);
    const saveSucceeded: boolean = await this.writeObject(
      this.metadataPath,
      content
    );
    if (saveSucceeded) {
      this.metadataCache = metadata;
    }

    return Promise.resolve(saveSucceeded);
  }

  private async addOrUpdateMetadata(
    matadata: ExtensionMetadata
  ): Promise<ExtensionMetadata[]> {
    const metadatas: ExtensionMetadata[] = await this.getMetadata();
    const index: number = metadatas.findIndex(m => m.extId === matadata.extId);

    if (index === -1) {
      // Not found, then add
      metadatas.push(matadata);
    } else {
      // Found, then modify
      matadata.dateCreated = metadatas[index].dateCreated;
      metadatas[index] = matadata;
    }

    this.metadataCache = metadatas;
    return Promise.resolve(metadatas);
  }

  private async removeFromMetadata(
    extId: string,
    _version?: string
  ): Promise<ExtensionMetadata[]> {
    // TODO: history version
    const oldMetadata: ExtensionMetadata[] = await this.getMetadata();
    const newMetadata: ExtensionMetadata[] = oldMetadata.filter(metadata => {
      return metadata.extId !== extId;
    });
    this.metadataCache = newMetadata;
    return Promise.resolve(newMetadata);
  }

  /**
   * Read icon base64, readme, changeLog from extension package
   * @param packagePath
   * @param manifest
   */
  private async resolveExtensionPackage(
    packagePath: string,
    manifest: Manifest
  ): Promise<void> {
    const iconPath: string | undefined = manifest.icon;
    this.readme = undefined;
    this.changeLog = undefined;
    this.icon = undefined;
    return new Promise<void>((resolve, reject) => {
      yauzl.open(packagePath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          return reject(err);
        }
        if (!zipfile) {
          return reject(zipfile);
        }
        zipfile.readEntry();
        zipfile.on('end', resolve);
        zipfile.on('close', resolve);
        zipfile.on('error', reject);
        zipfile.on('entry', entry => {
          if (/^extension\/README\.md$/i.test(entry.fileName)) {
            zipfile.openReadStream(entry, (err, stream) => {
              if (err) {
                return reject(err);
              }
              if (!stream) {
                return reject(stream);
              }
              const buffers: Buffer[] = [];
              stream.on('data', buffer => buffers.push(buffer as Buffer));
              stream.once('error', reject);
              stream.once('end', () => {
                this.readme = Buffer.concat(buffers).toString('utf8');
                zipfile.readEntry();
              });
            });
          } else if (/^extension\/CHANGELOG\.md$/i.test(entry.fileName)) {
            zipfile.openReadStream(entry, (err, stream) => {
              if (err) {
                return reject(err);
              }
              if (!stream) {
                return reject(stream);
              }
              const buffers: Buffer[] = [];
              stream.on('data', buffer => buffers.push(buffer as Buffer));
              stream.once('error', reject);
              stream.once('end', () => {
                this.changeLog = Buffer.concat(buffers).toString('utf8');
                zipfile.readEntry();
              });
            });
          } else if (iconPath && entry.fileName === `extension/${iconPath}`) {
            zipfile.openReadStream(entry, (err, stream) => {
              if (err) {
                return reject(err);
              }
              if (!stream) {
                return reject(stream);
              }
              const buffers: Buffer[] = [];
              stream.on('data', buffer => buffers.push(buffer as Buffer));
              stream.once('error', reject);
              stream.once('end', async () => {
                const fileBuffer: Buffer = Buffer.concat(buffers);
                const fileType:
                  | FileType.FileTypeResult
                  | undefined = await FileType.fromBuffer(fileBuffer);
                const mimeType: FileType.MimeType | undefined = fileType
                  ? fileType.mime
                  : undefined;
                const contentBase64: string = fileBuffer.toString('base64');
                this.icon = `data:${mimeType};base64,${contentBase64}`;
                zipfile.readEntry();
              });
            });
          } else {
            if (this.icon && this.readme && this.changeLog) {
              zipfile.close();
            } else {
              zipfile.readEntry();
            }
          }
        });
      });
    });
  }

  async listRemoteExtensions(): Promise<ListRemoteResult> {
    const metadatas: ExtensionMetadata[] = await this.getMetadata();
    const shortDetails: ExtensionShortDetails[] = [];

    for (const metadata of metadatas) {
      shortDetails.push({
        name: metadata.extId,
        latestVersion: metadata.currentVersion,
        lastUpdated: metadata.lastUpdate,
      });
    }

    return Promise.resolve({ details: shortDetails });
  }

  async showExtensionDetails(
    extId: string,
    version?: string
  ): Promise<ExtensionDetails> {
    const extensionMetadata: ExtensionMetadata = await this.findExtension(
      extId,
      version
    );

    const name: string = this.extractNameFromExtId(extId);
    let readMe = '';
    let changeLog = '';
    const getReadMePromise: Promise<void> = this.readObject(
      `${name}/${extensionMetadata.currentVersion!}/README.md`
    )
      .then(content => {
        readMe = content;
      })
      .catch(() => {
        readMe = '';
      });
    const getChangeLogPromise: Promise<void> = this.readObject(
      `${name}/${extensionMetadata.currentVersion!}/CHANGELOG.md`
    )
      .then(content => {
        changeLog = content;
      })
      .catch(() => {
        changeLog = '';
      });
    await Promise.all([getReadMePromise, getChangeLogPromise]);

    return Promise.resolve({
      name: extensionMetadata.extId,
      version: extensionMetadata.currentVersion,
      description: extensionMetadata.describe ? extensionMetadata.describe : '',
      readMe,
      changeLog,
      lastUpdated: extensionMetadata.lastUpdate,
    });
  }

  async showExtensionHistory(extId: string): Promise<ExtensionHistory> {
    const extensionMetadata = await this.findExtension(extId);
    const versions: { [version: string]: Date } = {};
    // TODO: history version
    versions[extensionMetadata.currentVersion] = extensionMetadata.lastUpdate;
    return Promise.resolve({
      name: extensionMetadata.extId,
      versions,
    });
  }

  async publishExtension(
    packagePath: string,
    manifest: Manifest
  ): Promise<boolean> {
    await this.resolveExtensionPackage(packagePath, manifest);
    const name: string = manifest.name;
    const extId = `${manifest.publisher}.${name}`;
    const version: string = manifest.version;
    const describe: string = manifest.description ? manifest.description : '';
    const extensionMetadata: ExtensionMetadata = {
      extId,
      currentVersion: version,
      icon: this.icon,
      describe,
      dateCreated: new Date(),
      lastUpdate: new Date(),
    };
    const metadatas: ExtensionMetadata[] = await this.addOrUpdateMetadata(
      extensionMetadata
    );
    const uploadPath = `${name}/${version}/${name}-${version}.vsix`;

    const uploadTasks: Array<Promise<boolean>> = [];
    uploadTasks.push(
      this.putObject(uploadPath, fs.createReadStream(packagePath))
    );
    if (this.readme) {
      const readmePath = `${name}/${version}/README.md`;
      uploadTasks.push(this.writeObject(readmePath, this.readme));
    }
    if (this.changeLog) {
      const changeLogPath = `${name}/${version}/CHANGELOG.md`;
      uploadTasks.push(this.writeObject(changeLogPath, this.changeLog));
    }

    return Promise.all(uploadTasks).then(async result => {
      if (result.includes(false)) {
        return Promise.resolve(false);
      } else {
        const updateMetadatasSucceeded: boolean = await this.saveMetadata(
          metadatas
        );
        if (updateMetadatasSucceeded) {
          return Promise.resolve(true);
        } else {
          return Promise.resolve(false);
        }
      }
    });
  }

  async unpublishExtension(extId: string, version?: string): Promise<boolean> {
    const extensionMetadata: ExtensionMetadata = await this.findExtension(
      extId,
      version
    );
    const objectPath = `${this.extractNameFromExtId(extId)}/${
      extensionMetadata.currentVersion
    }`;
    const removeSucceeded = await this.removeObject(objectPath);

    if (removeSucceeded) {
      const newMetadata: ExtensionMetadata[] = await this.removeFromMetadata(
        extensionMetadata.extId,
        version
      );
      return this.saveMetadata(newMetadata);
    } else {
      return Promise.resolve(false);
    }
  }

  async checkExtension(extId: string, version?: string): Promise<boolean> {
    const metadatas: ExtensionMetadata[] = await this.getMetadata();
    const extensionMetadata = metadatas.find(
      element => element.extId === extId
    );

    if (extensionMetadata) {
      if (!version) {
        return Promise.resolve(true);
      }
      // TODO: history version check
      if (extensionMetadata.currentVersion === version) {
        return Promise.resolve(true);
      } else {
        return Promise.resolve(false);
      }
    } else {
      return Promise.resolve(false);
    }
  }

  async findExtension(
    extId: string,
    version?: string
  ): Promise<ExtensionMetadata> {
    const metadatas: ExtensionMetadata[] = await this.getMetadata();
    const extensionMetadata = metadatas.find(
      element => element.extId === extId
    );

    if (extensionMetadata) {
      if (!version) {
        version = extensionMetadata.currentVersion;
      }
      // TODO: history version check
      if (extensionMetadata.currentVersion === version) {
        return Promise.resolve(extensionMetadata);
      } else {
        return Promise.reject(
          `Not found extension ${extId} with version ${version}`
        );
      }
    } else {
      return Promise.reject(`Not found extension ${extId}`);
    }
  }
}
