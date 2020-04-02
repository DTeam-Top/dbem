import { ReadStream } from 'fs';
import { AbstractProvider } from './abstract';
import S3 = require('aws-sdk/clients/s3');

export class S3Provider extends AbstractProvider {
  private s3: S3;
  private bucket: string;

  // Avaliable configure: https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#constructor_details
  constructor(options: S3.Types.ClientConfiguration) {
    super();
    if (options.hasOwnProperty('bucket')) {
      if (!options.params) {
        options.params = {};
      }
      options.params.Bucket = (options as any)['bucket'];
    }
    this.bucket = options.params!.Bucket;
    this.s3 = new S3(options);
  }

  /**
   * Recursively remove objects in bucket under dir, returns a Promise that resolves to the count of deleted keys
   * @param dir
   */
  private async deleteRecursive(dir: string): Promise<number> {
    let count = 0;
    while (true) {
      // list objects
      const listedObjects = await this.s3
        .listObjectsV2({ Bucket: this.bucket, Prefix: dir })
        .promise();
      if (listedObjects.Contents && listedObjects.Contents.length) {
        // prepare delete request
        const deleteParams = {
          Bucket: this.bucket,
          Delete: {
            Objects: listedObjects.Contents.map(obj => ({
              Key: obj.Key as string,
            })),
          },
        };
        // listedObjects.Contents.forEach(({ Key }) => {
        //     deleteParams.Delete.Objects.push({ Key as string });
        // });
        const deleteOutput = await this.s3
          .deleteObjects(deleteParams)
          .promise();
        // count or list
        count += deleteOutput.Deleted!.length;
      }
      if (!listedObjects.IsTruncated) {
        return count;
      }
    }
  }

  async readObject(objPath: string): Promise<string> {
    const result = await this.s3
      .getObject({ Bucket: this.bucket, Key: objPath })
      .promise();
    return result.Body!.toString('utf8');
  }

  async writeObject(objPath: string, content: string): Promise<boolean> {
    const result = this.s3
      .putObject({ Bucket: this.bucket, Key: objPath, Body: content })
      .promise();
    return result
      .then(_result => {
        return Promise.resolve(true);
      })
      .catch(err => {
        return Promise.reject(err);
      });
  }

  async putObject(objPath: string, stream: ReadStream): Promise<boolean> {
    const result = this.s3
      .upload({ Bucket: this.bucket, Key: objPath, Body: stream })
      .promise();
    return result
      .then(_result => {
        return Promise.resolve(true);
      })
      .catch(err => {
        return Promise.reject(err);
      });
  }

  async removeObject(objPath: string): Promise<boolean> {
    return this.deleteRecursive(objPath)
      .then(result => {
        return Promise.resolve(result === 0);
      })
      .catch(err => {
        return Promise.reject(err);
      });
  }
}
