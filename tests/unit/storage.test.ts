import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalDiskStorage } from "@/lib/storage/local";
import { signV4 } from "@/lib/storage/s3";
import { safeFileName, sniffType } from "@/server/documents";

describe("local storage adapter", () => {
  it("round-trips, refuses overwrites and path traversal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sam-store-"));
    const s = new LocalDiskStorage(root);
    await s.put("a/b/file.pdf", Buffer.from("hello"), { contentType: "application/pdf" });
    expect((await s.get("a/b/file.pdf")).toString()).toBe("hello");
    await expect(s.put("a/b/file.pdf", Buffer.from("again"), { contentType: "x" })).rejects.toThrow();
    for (const bad of ["../escape", "a/../../escape", "/etc/passwd", "a//b", "..", ""]) await expect(s.get(bad)).rejects.toThrow();
    await s.delete("a/b/file.pdf");
    await s.delete("a/b/file.pdf"); // idempotent
    await expect(s.get("a/b/file.pdf")).rejects.toThrow();
  });
});

describe("file type sniffing", () => {
  it("identifies allowed types by content and rejects everything else", () => {
    expect(sniffType(Buffer.from("%PDF-1.7 ..."))?.mime).toBe("application/pdf");
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.mime).toBe("image/jpeg");
    expect(sniffType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))?.mime).toBe("image/webp");
    expect(sniffType(Buffer.from("MZ\x90\x00"))).toBeNull(); // Windows executable
    expect(sniffType(Buffer.from("<html><script>"))).toBeNull();
    expect(sniffType(Buffer.from("PK\x03\x04"))).toBeNull(); // zip/docx
    expect(sniffType(Buffer.alloc(0))).toBeNull();
  });
  it("cleans file names for display", () => {
    expect(safeFileName("C:\\Users\\me\\scan 1.pdf")).toBe("scan 1.pdf");
    expect(safeFileName('a"b<c>.pdf')).toBe("abc.pdf");
    expect(safeFileName("../..")).toBe("..");
    expect(safeFileName("")).toBe("document");
  });
});

describe("AWS Signature V4 (S3-compatible adapter)", () => {
  it("reproduces the AWS documentation example for GET Object", () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html (Example: GET Object)
    const out = signV4({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      region: "us-east-1",
      service: "s3",
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      headers: { range: "bytes=0-9" },
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(out.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });
});
