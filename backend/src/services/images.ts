import parseAPNG from 'apng-js';
import sharp, { type Metadata } from 'sharp';

export type ImageType = 'webp' | 'jpeg' | 'gif' | 'png';

export type ImageInfo = { width: number; height: number; contentType: ImageType; animated: boolean; frames: number };

export const MAX_AVATAR_BYTES = 128 * 1024;
export const MAX_AVATAR_DIMENSION = 1024;
export const MAX_ANIMATED_BYTES = 512 * 1024;
export const MAX_ANIMATED_DIMENSION = 256;
export const MAX_ANIMATED_FRAMES = 60;
export const MAX_ANIMATED_PIXELS = 4_000_000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

const hasMagic = (data: Uint8Array, magic: number[]) => data.length >= magic.length && magic.every((byte, index) => data[index] === byte);

const ascii = (data: Uint8Array, offset: number, length: number) => String.fromCharCode(...data.subarray(offset, offset + length));

const isWebp = (data: Uint8Array) => data.length >= 12 && ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WEBP';

const readApngInfo = (data: Uint8Array): ImageInfo | null => {
  let parsed: ReturnType<typeof parseAPNG>;

  try {
    parsed = parseAPNG(new Uint8Array(data).buffer);
  } catch {
    return null;
  }

  if (parsed instanceof Error) return null;

  const frames = parsed.frames.length;
  if (frames < 1 || parsed.width < 1 || parsed.height < 1) return null;

  for (const frame of parsed.frames) {
    if (frame.width < 1 || frame.height < 1) return null;
    if (frame.left + frame.width > parsed.width || frame.top + frame.height > parsed.height) return null;
  }

  return { width: parsed.width, height: parsed.height, contentType: 'png', animated: frames > 1, frames };
};

const readSharpInfo = async (data: Uint8Array): Promise<ImageInfo | null> => {
  let metadata: Metadata;

  try {
    metadata = await sharp(data, { animated: true }).metadata();
  } catch {
    return null;
  }

  const { width, height, format } = metadata;
  const pages = metadata.pages ?? 1;

  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;

  if (format === 'gif') {
    const frameHeight = pages > 1 ? (metadata.pageHeight ?? Math.floor(height / pages)) : height;
    return { width, height: frameHeight, contentType: 'gif', animated: pages > 1, frames: pages };
  }

  if (format === 'webp') {
    if (pages > 1) return null;
    return { width, height, contentType: 'webp', animated: false, frames: 1 };
  }

  if (format === 'jpeg') {
    return { width, height, contentType: 'jpeg', animated: false, frames: 1 };
  }

  return null;
};

export const readImageInfo = async (data: Uint8Array): Promise<ImageInfo | null> => {
  if (hasMagic(data, PNG_SIGNATURE)) return readApngInfo(data);
  if (hasMagic(data, GIF87A) || hasMagic(data, GIF89A) || hasMagic(data, JPEG_SIGNATURE) || isWebp(data)) return readSharpInfo(data);
  return null;
};

export const decodeImageDataUrl = async (value: string): Promise<{ data: Uint8Array; contentType: ImageType; width: number; height: number; animated: boolean; frames: number } | null> => {
  const match = /^data:image\/(webp|jpeg|gif|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return null;

  const data = Buffer.from(match[2]!, 'base64');
  if (data.length > MAX_ANIMATED_BYTES) return null;

  const info = await readImageInfo(data);
  if (!info) return null;

  if (info.animated) {
    if (data.length > MAX_ANIMATED_BYTES) return null;
    if (info.width > MAX_ANIMATED_DIMENSION || info.height > MAX_ANIMATED_DIMENSION) return null;
    if (info.frames > MAX_ANIMATED_FRAMES) return null;
    if (info.width * info.height * info.frames > MAX_ANIMATED_PIXELS) return null;
  } else {
    if (data.length > MAX_AVATAR_BYTES) return null;
    if (info.width > MAX_AVATAR_DIMENSION || info.height > MAX_AVATAR_DIMENSION) return null;
  }

  return { data, ...info };
};

export type ParsedImage = { data: Uint8Array<ArrayBuffer>; contentType: string; width: number; height: number; animated: boolean; frames: number };

export type ParsedPoster = { data: Uint8Array<ArrayBuffer>; contentType: string };

export const parseImage = async (value: string): Promise<ParsedImage | null> => {
  const decoded = await decodeImageDataUrl(value);
  if (!decoded) return null;

  return {
    data: new Uint8Array(decoded.data),
    contentType: `image/${decoded.contentType}`,
    width: decoded.width,
    height: decoded.height,
    animated: decoded.animated,
    frames: decoded.frames,
  };
};

export const parsePoster = async (value: string): Promise<ParsedPoster | null> => {
  const decoded = await decodeImageDataUrl(value);
  if (!decoded || decoded.animated) return null;
  if (decoded.contentType !== 'webp' && decoded.contentType !== 'jpeg') return null;
  if (decoded.width > MAX_ANIMATED_DIMENSION || decoded.height > MAX_ANIMATED_DIMENSION) return null;

  return { data: new Uint8Array(decoded.data), contentType: `image/${decoded.contentType}` };
};

export const nextImageVersion = () => Math.floor(Math.random() * 1_000_000_000) + 1;

export type ImagePatch = { clear: true } | (ParsedImage & { version: number });

export type ImageUpdate = { image?: ImagePatch; poster?: ParsedPoster };

export type ImageUpdateResult = { ok: true; update: ImageUpdate } | { ok: false; error: 'image' | 'poster' };

export const parseImageUpdate = async (image: string | null | undefined, poster: string | undefined): Promise<ImageUpdateResult> => {
  if (image === undefined) {
    return poster === undefined ? { ok: true, update: {} } : { ok: false, error: 'poster' };
  }

  if (image === null) {
    return poster === undefined ? { ok: true, update: { image: { clear: true } } } : { ok: false, error: 'poster' };
  }

  const parsed = await parseImage(image);
  if (!parsed) return { ok: false, error: 'image' };

  const imagePatch: ImagePatch = { ...parsed, version: nextImageVersion() };

  if (poster === undefined) {
    return imagePatch.animated ? { ok: false, error: 'poster' } : { ok: true, update: { image: imagePatch } };
  }

  if (!imagePatch.animated) return { ok: true, update: { image: imagePatch } };

  const parsedPoster = await parsePoster(poster);
  if (!parsedPoster) return { ok: false, error: 'poster' };

  return { ok: true, update: { image: imagePatch, poster: parsedPoster } };
};

export type StoredImage = { data: Uint8Array<ArrayBuffer>; contentType: string; posterData?: Uint8Array<ArrayBuffer> | null; posterContentType?: string | null };

export const imageColumns = (image: ParsedImage, poster: ParsedPoster | undefined) => ({
  data: image.data,
  contentType: image.contentType,
  posterData: poster?.data ?? null,
  posterContentType: poster?.contentType ?? null,
});

export const imageResponse = (image: StoredImage, version: number, wantsStatic: boolean) => {
  const poster = wantsStatic && image.posterData && image.posterContentType ? { data: image.posterData, contentType: image.posterContentType } : null;
  const variant = poster ?? image;
  const etag = `"v${version}${wantsStatic ? '-static' : ''}"`;

  return {
    data: variant.data,
    etag,
    headers: {
      'Content-Type': variant.contentType,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'same-site',
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
    },
  };
};
