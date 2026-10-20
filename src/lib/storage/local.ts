import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeKey, type FileStorage } from "./types";

/** Development adapter: files on local disk outside `public/`. Not for production (serverless disks are ephemeral). */
export class LocalDiskStorage implements FileStorage {
  readonly name = "local";
  private readonly root: string;
  constructor(root: string) {
    this.root = path.resolve(root);
  }
  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Unsafe storage key");
    return full;
  }
  async put(key: string, body: Buffer, _meta?: { contentType: string }): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body, { flag: "wx", mode: 0o600 }); // never overwrite an existing object
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }
  async delete(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
