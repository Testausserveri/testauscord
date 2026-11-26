import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { decodeImageDataUrl, MAX_ANIMATED_BYTES, MAX_ANIMATED_DIMENSION, MAX_ANIMATED_FRAMES, MAX_AVATAR_BYTES, MAX_AVATAR_DIMENSION, readImageInfo } from './images';

const ascii = (value: string) => [...value].map((char) => char.charCodeAt(0));

const solid = (width: number, height: number, background = { r: 255, g: 0, b: 0, alpha: 1 }) => sharp({ create: { width, height, channels: 4, background } });

const staticGif = (width: number, height: number) => solid(width, height).gif().toBuffer();
const staticWebp = (width: number, height: number) => solid(width, height).webp().toBuffer();
const staticJpeg = (width: number, height: number) => solid(width, height).jpeg().toBuffer();
const staticPng = (width: number, height: number) => solid(width, height).png().toBuffer();

const animatedGif = async (width: number, height: number, frames: number) => {
  const images = await Promise.all(
    Array.from({ length: frames }, (_, index) =>
      solid(width, height, index % 2 === 0 ? { r: 255, g: 0, b: 0, alpha: 1 } : { r: 0, g: 0, b: 255, alpha: 1 })
        .png()
        .toBuffer(),
    ),
  );

  return sharp(images, { join: { animated: true } })
    .gif()
    .toBuffer();
};

const gif = (width: number, height: number, frames: number, options: { frameWidth?: number; frameHeight?: number; left?: number; top?: number } = {}) => {
  const frameWidth = options.frameWidth ?? width;
  const frameHeight = options.frameHeight ?? height;
  const left = options.left ?? 0;
  const top = options.top ?? 0;

  const bytes = [...ascii('GIF89a'), width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff, 0, 0, 0];

  for (let index = 0; index < frames; index += 1) {
    bytes.push(0x2c, left & 0xff, (left >> 8) & 0xff, top & 0xff, (top >> 8) & 0xff, frameWidth & 0xff, (frameWidth >> 8) & 0xff, frameHeight & 0xff, (frameHeight >> 8) & 0xff, 0, 2, 1, 0, 0);
  }

  bytes.push(0x3b);
  return new Uint8Array(bytes);
};

const be32 = (value: number) => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

const pngChunk = (type: string, payload: number[]) => [...be32(payload.length), ...ascii(type), ...payload, 0, 0, 0, 0];

const fctl = (sequence: number, width: number, height: number, x: number, y: number) =>
  pngChunk('fcTL', [...be32(sequence), ...be32(width), ...be32(height), ...be32(x), ...be32(y), 0, 1, 0, 10, 0, 0]);

const png = (width: number, height: number, options: { frames?: number; frameWidth?: number; frameHeight?: number; x?: number; y?: number } = {}) => {
  const frames = options.frames ?? 0;
  const frameWidth = options.frameWidth ?? width;
  const frameHeight = options.frameHeight ?? height;
  const x = options.x ?? 0;
  const y = options.y ?? 0;

  const ihdr = pngChunk('IHDR', [...be32(width), ...be32(height), 8, 6, 0, 0, 0]);
  const actl = pngChunk('acTL', [...be32(frames), 0, 0, 0, 0]);
  const idat = pngChunk('IDAT', []);
  const iend = pngChunk('IEND', []);
  const frameChunks = Array.from({ length: frames }, (_, index) => fctl(index, frameWidth, frameHeight, x, y));

  return new Uint8Array([0x89, ...ascii('PNG\r\n\x1a\n'), ...ihdr, ...actl, ...idat, ...frameChunks.flat(), ...iend]);
};

const dataUrl = (type: string, data: Uint8Array) => `data:image/${type};base64,${Buffer.from(data).toString('base64')}`;

test('reads static WebP and JPEG dimensions', async () => {
  expect(await readImageInfo(await staticWebp(512, 256))).toEqual({ width: 512, height: 256, contentType: 'webp', animated: false, frames: 1 });
  expect(await readImageInfo(await staticJpeg(256, 512))).toEqual({ width: 256, height: 512, contentType: 'jpeg', animated: false, frames: 1 });
});

test('reads GIF dimensions and frame count', async () => {
  expect(await readImageInfo(await staticGif(64, 64))).toEqual({ width: 64, height: 64, contentType: 'gif', animated: false, frames: 1 });
  expect(await readImageInfo(await animatedGif(128, 96, 3))).toEqual({ width: 128, height: 96, contentType: 'gif', animated: true, frames: 3 });
});

test('reads APNG frame count', async () => {
  expect(await readImageInfo(png(256, 256, { frames: 30 }))).toEqual({ width: 256, height: 256, contentType: 'png', animated: true, frames: 30 });
});

test('rejects static PNGs', async () => {
  expect(await readImageInfo(await staticPng(64, 64))).toBeNull();
});

test('rejects APNG frames outside the canvas', async () => {
  expect(await readImageInfo(png(64, 64, { frames: 2, frameWidth: 32, x: 40 }))).toBeNull();
  expect(await readImageInfo(png(64, 64, { frames: 2, frameWidth: 0 }))).toBeNull();
});

test('rejects animated WebP', async () => {
  const animated = await sharp(await animatedGif(16, 16, 2), { animated: true })
    .webp()
    .toBuffer();
  expect(await readImageInfo(animated)).toBeNull();
});

test('rejects unknown formats and garbage', async () => {
  expect(await readImageInfo(new Uint8Array())).toBeNull();
  expect(await readImageInfo(new Uint8Array(32))).toBeNull();
  expect(await readImageInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  expect(await readImageInfo(Buffer.from('<svg/>'))).toBeNull();
});

test('rejects oversized GIF frames', async () => {
  expect(await decodeImageDataUrl(dataUrl('gif', gif(1, 1, 1, { frameWidth: 4000, frameHeight: 4000 })))).toBeNull();
  expect(await decodeImageDataUrl(dataUrl('gif', gif(64, 64, 1, { frameWidth: 32, frameHeight: 32, left: 2000 })))).toBeNull();
});

test('rejects truncated GIFs', async () => {
  expect(await decodeImageDataUrl(dataUrl('gif', gif(64, 64, 1).slice(0, -2)))).toBeNull();
});

test('decodes a WebP data URL', async () => {
  const result = await decodeImageDataUrl(dataUrl('webp', await staticWebp(512, 256)));

  expect(result?.contentType).toBe('webp');
  expect(result?.animated).toBe(false);
});

test('derives the content type from magic bytes, not the declared type', async () => {
  expect((await decodeImageDataUrl(dataUrl('jpeg', await staticWebp(64, 64))))?.contentType).toBe('webp');
  expect((await decodeImageDataUrl(dataUrl('webp', await staticJpeg(64, 64))))?.contentType).toBe('jpeg');
  expect((await decodeImageDataUrl(dataUrl('webp', await staticGif(64, 64))))?.contentType).toBe('gif');
  expect((await decodeImageDataUrl(dataUrl('jpeg', png(64, 64, { frames: 2 }))))?.contentType).toBe('png');
});

test('accepts animated GIF and APNG within the caps', async () => {
  const animated = await decodeImageDataUrl(dataUrl('gif', await animatedGif(128, 128, 3)));
  expect(animated?.animated).toBe(true);
  expect(animated?.frames).toBe(3);

  const apng = await decodeImageDataUrl(dataUrl('png', png(128, 128, { frames: 30 })));
  expect(apng?.animated).toBe(true);
  expect(apng?.frames).toBe(30);
});

test('rejects animated images over the caps', async () => {
  const padded = new Uint8Array(MAX_ANIMATED_BYTES + 1);
  padded.set(png(64, 64, { frames: 2 }));
  expect(await decodeImageDataUrl(dataUrl('png', padded))).toBeNull();

  expect(await decodeImageDataUrl(dataUrl('gif', gif(MAX_ANIMATED_DIMENSION + 1, 64, 2)))).toBeNull();
  expect(await decodeImageDataUrl(dataUrl('gif', gif(64, 64, MAX_ANIMATED_FRAMES + 1)))).toBeNull();
  expect(await decodeImageDataUrl(dataUrl('gif', gif(512, 512, MAX_ANIMATED_FRAMES)))).toBeNull();
  expect(await decodeImageDataUrl(dataUrl('png', png(MAX_ANIMATED_DIMENSION + 1, 64, { frames: 2 })))).toBeNull();
  expect(await decodeImageDataUrl(dataUrl('png', png(64, 64, { frames: MAX_ANIMATED_FRAMES + 1 })))).toBeNull();
});

test('rejects static images over the caps', async () => {
  const padded = new Uint8Array(MAX_AVATAR_BYTES + 1);
  padded.set(await staticJpeg(64, 64));
  expect(await decodeImageDataUrl(dataUrl('jpeg', padded))).toBeNull();

  expect(await decodeImageDataUrl(dataUrl('jpeg', await staticJpeg(MAX_AVATAR_DIMENSION + 1, 64)))).toBeNull();
});

test('rejects data URLs that are not WebP, JPEG, GIF or PNG', async () => {
  expect(await decodeImageDataUrl(dataUrl('png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])))).toBeNull();
  expect(await decodeImageDataUrl(dataUrl('gif', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])))).toBeNull();
  expect(await decodeImageDataUrl(`data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`)).toBeNull();
});

test('rejects malformed data URLs', async () => {
  expect(await decodeImageDataUrl('not a data url')).toBeNull();
  expect(await decodeImageDataUrl('data:image/webp,abcdef')).toBeNull();
  expect(await decodeImageDataUrl('data:image/webp;base64,***')).toBeNull();
});
