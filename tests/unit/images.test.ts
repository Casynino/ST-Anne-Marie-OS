import { describe, expect, it } from "vitest";
import { imageSize, isImageRef, slugify, sniffImage } from "@/lib/images";

const png = (w: number, h: number) => {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const jpeg = (w: number, h: number) => {
  const b = new Uint8Array(40);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0]); // SOI + APP0 (length 4)
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 8); // SOF0
  new DataView(b.buffer).setUint16(13, h);
  new DataView(b.buffer).setUint16(15, w);
  return b;
};
const webpX = (w: number, h: number) => {
  const b = new Uint8Array(40);
  b.set([..."RIFF"].map((c) => c.charCodeAt(0)));
  b.set([..."WEBP"].map((c) => c.charCodeAt(0)), 8);
  b.set([..."VP8X"].map((c) => c.charCodeAt(0)), 12);
  const wm = w - 1, hm = h - 1;
  b.set([wm & 255, (wm >> 8) & 255, (wm >> 16) & 255, hm & 255, (hm >> 8) & 255, (hm >> 16) & 255], 24);
  return b;
};

describe("image sniffing and sizes", () => {
  it("recognises formats from bytes and reads their dimensions", () => {
    expect(sniffImage(png(10, 10))).toBe("png");
    expect(imageSize(png(1280, 720), "png")).toEqual({ width: 1280, height: 720 });
    expect(sniffImage(jpeg(10, 10))).toBe("jpeg");
    expect(imageSize(jpeg(1600, 900), "jpeg")).toEqual({ width: 1600, height: 900 });
    expect(sniffImage(webpX(10, 10))).toBe("webp");
    expect(imageSize(webpX(800, 600), "webp")).toEqual({ width: 800, height: 600 });
  });
  it("rejects anything that is not a supported image, whatever its name claims", () => {
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)></svg>   padding padding padding"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("GIF89a" + "x".repeat(40)))).toBeNull();
    expect(sniffImage(new Uint8Array(5))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("#!/bin/sh\nrm -rf /\n" + " ".repeat(40)))).toBeNull();
  });
});

describe("image references and slugs", () => {
  it("accepts only bundled /site files and uploaded /media ids", () => {
    expect(isImageRef("/site/logo.png")).toBe(true);
    expect(isImageRef("/site/gallery/01-class.jpg")).toBe(true);
    expect(isImageRef("/media/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")).toBe(true);
    for (const bad of ["https://evil.example/x.png", "//evil.example/x.png", "/site/../secret.png", "/site/x.exe", "/media/not-a-uuid", "javascript:alert(1)", "/etc/passwd", ""]) expect(isImageRef(bad), bad).toBe(false);
  });
  it("makes readable, safe slugs", () => {
    expect(slugify("Pre-Form One: Registration Open!")).toBe("pre-form-one-registration-open");
    expect(slugify("  Habari za Shule — Mwaka 2026  ")).toBe("habari-za-shule-mwaka-2026");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("***")).toBe("");
  });
});
