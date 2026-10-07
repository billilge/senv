import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  paginateListObjectsV2,
  S3Client,
} from '@aws-sdk/client-s3';
import type { Envelope } from '../crypto/envelope.js';
import { versionsUnder } from './in-memory-snapshot-store.js';
import {
  ownerPrefix,
  SnapshotNotFoundError,
  type SnapshotOwner,
  type SnapshotRef,
  SnapshotStore,
  snapshotObjectKey,
} from './snapshot-store.js';

export interface S3StoreOptions {
  /** 운영: `https://<account_id>.r2.cloudflarestorage.com`, 로컬: MinIO 주소 */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** R2(S3 호환 API)에 스냅샷 봉투를 JSON으로 저장한다 */
export class S3SnapshotStore extends SnapshotStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3StoreOptions) {
    super();
    this.bucket = options.bucket;
    this.client = new S3Client({
      // R2는 region으로 'auto'를 쓴다. path-style은 R2와 MinIO 모두 지원한다
      region: 'auto',
      endpoint: options.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async put(ref: SnapshotRef, envelope: Envelope): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: snapshotObjectKey(ref),
        Body: JSON.stringify(envelope),
        ContentType: 'application/json',
      }),
    );
  }

  async get(ref: SnapshotRef): Promise<Envelope> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: snapshotObjectKey(ref) }),
      );
      const body = await response.Body?.transformToString('utf-8');
      if (body === undefined) throw new SnapshotNotFoundError(ref);
      return JSON.parse(body) as Envelope;
    } catch (error) {
      if (error instanceof Error && error.name === 'NoSuchKey')
        throw new SnapshotNotFoundError(ref);
      throw error;
    }
  }

  async listVersions(owner: SnapshotOwner): Promise<number[]> {
    const prefix = ownerPrefix(owner);
    const keys: string[] = [];
    // ListObjectsV2는 한 번에 최대 1000개라 페이지를 끝까지 읽는다
    for await (const page of paginateListObjectsV2(
      { client: this.client },
      { Bucket: this.bucket, Prefix: `${prefix}/` },
    )) {
      for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
    }
    return versionsUnder(prefix, keys);
  }

  async delete(ref: SnapshotRef): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: snapshotObjectKey(ref) }),
    );
  }
}
