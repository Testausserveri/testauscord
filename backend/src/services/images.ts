import { imageSize } from 'image-size';

export type ImageType = 'webp' | 'jpeg';

export type ImageInfo = { width: number; height: number; contentType: ImageType };

export const MAX_AVATAR_BYTES = 128 * 1024;
export const MAX_AVATAR_DIMENSION = 1024;

export const readImageInfo = (data: Uint8Array): ImageInfo | null => {
  let size: ReturnType<typeof imageSize>;

  try {
    size = imageSize(data);
  } catch {
    return null;
  }

  const contentType = size.type === 'webp' ? 'webp' : size.type === 'jpg' ? 'jpeg' : null;

  if (!contentType || !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) return null;

  return { width: size.width, height: size.height, contentType };
};

export const decodeImageDataUrl = (value: string): { data: Uint8Array; contentType: ImageType } | null => {
  const match = /^data:image\/(webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return null;

  const data = Buffer.from(match[2]!, 'base64');
  const info = readImageInfo(data);

  return info ? { data, contentType: info.contentType } : null;
};
