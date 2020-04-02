import OSS, {
  DeleteMultiResult,
  GetObjectResult,
  ListObjectResult,
  ListObjectsQuery,
  PutObjectResult,
} from 'ali-oss';
import { ReadStream } from 'fs';
import { AbstractProvider } from './abstract';

export class OSSProvider extends AbstractProvider {
  private _client: OSS;

  constructor(options: OSS.Options) {
    super();
    this._client = new OSS(options);
  }

  async readObject(objPath: string): Promise<string> {
    const result: GetObjectResult = await this._client.get(objPath);
    return Promise.resolve(result.content.toString('utf8'));
  }

  async writeObject(objPath: string, content: string): Promise<boolean> {
    const putResult: PutObjectResult = await this._client.put(
      objPath,
      Buffer.from(content)
    );
    return Promise.resolve(putResult.res.status === 200);
  }

  async putObject(objPath: string, stream: ReadStream): Promise<boolean> {
    const putResult = await this._client.putStream(objPath, stream);
    return Promise.resolve(putResult.res.status === 200);
  }

  async removeObject(objPath: string): Promise<boolean> {
    let nextMarker: string | undefined;
    let listResult: ListObjectResult;
    do {
      const query: ListObjectsQuery = {
        prefix: objPath,
        marker: nextMarker,
        'max-keys': 1000,
      };
      listResult = await this._client.list(query, {});

      if (listResult.objects && listResult.objects.length > 0) {
        const keys: string[] = listResult.objects.map(meta => {
          return meta.name;
        });

        const removeResult: DeleteMultiResult = await this._client.deleteMulti(
          keys,
          { quite: true }
        );
        if (![200, 204].includes(removeResult.res.status)) {
          return Promise.resolve(false);
        }
        nextMarker = listResult.nextMarker;
      }
    } while (listResult.isTruncated);

    return Promise.resolve(true);
  }
}
