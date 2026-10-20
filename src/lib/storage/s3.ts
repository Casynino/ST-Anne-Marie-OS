import { createHash, createHmac } from "node:crypto";
import { assertSafeKey, type FileStorage } from "./types";

/*
 * S3-compatible adapter (Cloudflare R2, AWS S3, MinIO, …) using AWS Signature V4 over fetch — no SDK.
 * Path-style URLs: {endpoint}/{bucket}/{key}. Verified against the AWS SigV4 documentation test vector
 * (tests/unit/storage.test.ts); NOT yet exercised against a live bucket — do that with real credentials
 * before launch.
 */

const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const uriEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export type SigV4Input = {
  method: string;
  url: URL;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  payloadHash: string;
  /** Extra headers to sign (lower-case names). `host`, `x-amz-date`, `x-amz-content-sha256` are added automatically. */
  headers?: Record<string, string>;
  now?: Date;
};

export function signV4(i: SigV4Input): Record<string, string> {
  const now = i.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20130524T000000Z
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...(i.headers ?? {}), host: i.url.host, "x-amz-content-sha256": i.payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalUri = i.url.pathname.split("/").map((seg) => uriEncode(decodeURIComponent(seg))).join("/") || "/";
  const canonicalQuery = [...i.url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join("&");
  const canonicalRequest = [i.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, i.payloadHash].join("\n");
  const scope = `${date}/${i.region}/${i.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, date), i.region), i.service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

export type S3Config = { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string };

export class S3CompatibleStorage implements FileStorage {
  readonly name = "s3";
  constructor(private readonly cfg: S3Config) {}

  private async request(method: "PUT" | "GET" | "DELETE", key: string, body?: Buffer, contentType?: string): Promise<Response> {
    assertSafeKey(key);
    const url = new URL(`${this.cfg.endpoint.replace(/\/$/, "")}/${this.cfg.bucket}/${key.split("/").map(uriEncode).join("/")}`);
    const payload = body ?? Buffer.alloc(0);
    const headers = signV4({ method, url, region: this.cfg.region, service: "s3", accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey, payloadHash: sha256Hex(payload), headers: contentType ? { "content-type": contentType } : undefined });
    delete headers.host; // set by fetch
    return fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined });
  }

  async put(key: string, body: Buffer, meta: { contentType: string }) {
    const res = await this.request("PUT", key, body, meta.contentType);
    if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
  }
  async get(key: string) {
    const res = await this.request("GET", key);
    if (!res.ok) throw new Error(`Storage download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  async delete(key: string) {
    const res = await this.request("DELETE", key);
    if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status})`);
  }
}
