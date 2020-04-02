import { Manifest } from './manifest';
import { DropboxProvider } from './providers/dropbox';
import { OSSProvider } from './providers/oss';
import { S3Provider } from './providers/s3';

export interface ExtensionShortDetails {
  name: string;
  latestVersion: string;
  lastUpdated: Date;
}

export interface ListRemoteResult {
  details: ExtensionShortDetails[];
}

export interface ExtensionDetails {
  name: string;
  version: string;
  description: string;
  readMe: string;
  changeLog: string;
  lastUpdated: Date;
}

export interface ExtensionHistory {
  name: string;
  versions: {
    [version: string]: Date;
  };
}

// test only !!!
const mockBackend = {
  listRemoteExtensions: async () => {
    return {
      details: [
        {
          name: 'ext1',
          latestVersion: '0.1',
          lastUpdated: new Date(1995, 11, 17),
        },
      ],
    };
  },
  showExtensionDetails: async (name: string, version: string) => {
    return {
      name,
      version,
      description: 'mock extension',
      readMe: 'this is readme',
      changeLog: 'this is changeLog',
      lastUpdated: new Date(1995, 11, 17),
    };
  },
  showExtensionHistory: async (name: string) => {
    return {
      name,
      versions: {
        '0.0.1': new Date(1995, 11, 17),
        '0.0.2': new Date(1995, 11, 18),
        '0.1': new Date(1995, 11, 19),
      },
    };
  },
  publishExtension: async (packagePath: string, manifest: Manifest) => {
    if (!packagePath || manifest.version === '1.0') {
      return false;
    }

    return true;
  },
  unpublishExtension: async (name: string, version?: string) => {
    if (name === 'ext2' || version === '1.0') {
      return false;
    } else {
      return true;
    }
  },
  checkExtension: async (name: string, version?: string) => {
    if (name === 'ext1' || version === '0.0.2') {
      return true;
    } else {
      return false;
    }
  },
};

export function getProvider(backend: string, backendOptions?: any): Provider {
  if (backend === 'mock') {
    return mockBackend;
  } else if (backend === 'oss') {
    return new OSSProvider(backendOptions);
  } else if (backend === 'dropbox') {
    return new DropboxProvider(backendOptions);
  } else if (backend === 's3') {
    return new S3Provider(backendOptions);
  }

  throw new Error(`Unknown provider: ${backend}`);
}

export interface Provider {
  /**
   * list remote extension brief information
   */
  listRemoteExtensions(): Promise<ListRemoteResult>;

  /**
   * show an extension details
   * @param extId extension extId
   * @param version version of extension, use latest version if missing
   */
  showExtensionDetails(
    extId: string,
    version?: string
  ): Promise<ExtensionDetails>;

  /**
   * show history of an extension
   * @param extId extension extId
   */
  showExtensionHistory(extId: string): Promise<ExtensionHistory>;

  /**
   * publish an extension to a remote host
   * @param packagePath extension package path
   * @param version version of extension
   */
  publishExtension(packagePath: string, manifest: Manifest): Promise<boolean>;

  /**
   * unpublish an extension from a remote host
   * @param extId extension extId
   * @param version version of extension, use latest version if missing
   */
  unpublishExtension(extId: string, version?: string): Promise<boolean>;

  /**
   * check existance of an extension on a remote host
   * @param extId extension name
   * @param version version of extension, use latest version if missing
   */
  checkExtension(extId: string, version?: string): Promise<boolean>;
}
