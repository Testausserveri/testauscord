import { expect, test } from 'bun:test';
import { decodeImageDataUrl, readImageInfo } from './images';

const ascii = (value: string) => [...value].map((char) => char.charCodeAt(0));

const webp = (chunk: 'VP8X' | 'VP8 ' | 'VP8L', payload: number[]) => new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), 0, 0, 0, 0, ...payload]);

const vp8x = (width: number, height: number) => {
  const w = width - 1;
  const h = height - 1;
  return webp('VP8X', [0, 0, 0, 0, w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff]);
};

const vp8l = (width: number, height: number) => {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return webp('VP8L', [0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff]);
};

const vp8 = (width: number, height: number) => webp('VP8 ', [0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, width & 0xff, (width >> 8) & 0x3f, height & 0xff, (height >> 8) & 0x3f]);

const jpeg = (width: number, height: number) =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);

const dataUrl = (type: string, data: Uint8Array) => `data:image/${type};base64,${Buffer.from(data).toString('base64')}`;

test('reads WebP VP8X dimensions', () => {
  expect(readImageInfo(vp8x(512, 256))).toEqual({ width: 512, height: 256, contentType: 'webp' });
});

test('reads WebP VP8L dimensions', () => {
  expect(readImageInfo(vp8l(300, 400))).toEqual({ width: 300, height: 400, contentType: 'webp' });
});

test('reads WebP lossy dimensions', () => {
  expect(readImageInfo(vp8(640, 480))).toEqual({ width: 640, height: 480, contentType: 'webp' });
});

test('reads JPEG dimensions past other segments', () => {
  expect(readImageInfo(jpeg(256, 512))).toEqual({ width: 256, height: 512, contentType: 'jpeg' });
});

test('rejects empty and garbage input', () => {
  expect(readImageInfo(new Uint8Array())).toBeNull();
  expect(readImageInfo(new Uint8Array(32))).toBeNull();
  expect(readImageInfo(jpeg(256, 512).slice(0, 12))).toBeNull();
});

test('rejects other formats', () => {
  expect(readImageInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  expect(readImageInfo(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
  expect(readImageInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
});

test('decodes a WebP data URL', () => {
  const result = decodeImageDataUrl(dataUrl('webp', vp8x(512, 256)));

  expect(result?.contentType).toBe('webp');
  expect(readImageInfo(result!.data)).toEqual({ width: 512, height: 256, contentType: 'webp' });
});

test('derives the content type from magic bytes, not the declared type', () => {
  expect(decodeImageDataUrl(dataUrl('jpeg', vp8x(512, 256)))?.contentType).toBe('webp');
  expect(decodeImageDataUrl(dataUrl('webp', jpeg(256, 512)))?.contentType).toBe('jpeg');
});

test('rejects data URLs that are not WebP or JPEG', () => {
  expect(decodeImageDataUrl(dataUrl('png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])))).toBeNull();
  expect(decodeImageDataUrl(dataUrl('gif', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])))).toBeNull();
  expect(decodeImageDataUrl(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`)).toBeNull();
});

test('rejects malformed data URLs', () => {
  expect(decodeImageDataUrl('not a data url')).toBeNull();
  expect(decodeImageDataUrl('data:image/webp,abcdef')).toBeNull();
  expect(decodeImageDataUrl('data:image/webp;base64,***')).toBeNull();
});
