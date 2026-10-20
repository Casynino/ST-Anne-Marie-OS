import { LocalDiskStorage } from "./local";
import { S3CompatibleStorage } from "./s3";
import type { FileStorage } from "./types";

export type { FileStorage } from "./types";

let cached: FileStorage | null | undefined;

/**
 * STORAGE_DRIVER=local → files under STORAGE_LOCAL_DIR (default .data/uploads); development only.
 * STORAGE_DRIVER=s3    → S3-compatible bucket (S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).
 * Unset: local in development/test, NOT CONFIGURED in production — uploads then fail closed instead of
 * writing to a serverless disk that disappears.
 */
export function getStorage(): FileStorage | null {
  if (cached !== undefined) return cached;
  const driver = process.env.STORAGE_DRIVER ?? (process.env.NODE_ENV === "production" ? "" : "local");
  if (driver === "local") cached = new LocalDiskStorage(process.env.STORAGE_LOCAL_DIR ?? ".data/uploads");
  else if (driver === "s3") {
    const { S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
    cached = S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
      ? new S3CompatibleStorage({ endpoint: S3_ENDPOINT, bucket: S3_BUCKET, region: S3_REGION ?? "auto", accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY })
      : null;
  } else cached = null;
  return cached;
}

/** Test seam. */
export function setStorageForTests(storage: FileStorage | null | undefined) {
  cached = storage;
}
