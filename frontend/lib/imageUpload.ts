const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_AVATAR_BYTES = 128 * 1024;
const MAX_ANIMATED_BYTES = 512 * 1024;
const MAX_ANIMATED_DIMENSION = 256;
const AVATAR_SIZE = 256;

const ANIMATED_ERROR = 'Animated avatars must be 256x256 or smaller and under 512 KB. Use a smaller file or upload a still image.';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38];

export type AvatarUpload = { avatar: string; poster?: string };

const hasMagic = (bytes: Uint8Array, magic: number[]) => bytes.length >= magic.length && magic.every((byte, index) => bytes[index] === byte);

const hasApngChunk = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);

    if (type === 'acTL') return true;
    if (type === 'IDAT' || type === 'IEND') return false;

    offset += 12 + length;
  }

  return false;
};

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
};

const dataUrlBytes = (value: string) => Math.floor(((value.length - value.indexOf(',') - 1) * 3) / 4);

const encodeCanvas = (canvas: HTMLCanvasElement) => {
  for (const [type, quality] of [
    ['image/webp', 0.85],
    ['image/webp', 0.7],
    ['image/webp', 0.5],
    ['image/jpeg', 0.85],
  ] as const) {
    const dataUrl = canvas.toDataURL(type, quality);
    if (!dataUrl.startsWith(`data:${type}`)) continue;
    if (dataUrlBytes(dataUrl) <= MAX_AVATAR_BYTES) return dataUrl;
  }

  throw new Error('Could not shrink that image below 128 KB');
};

const drawSquare = (bitmap: ImageBitmap) => {
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const context = canvas.getContext('2d');

  if (!context) throw new Error('Could not process that image');

  const side = Math.min(bitmap.width, bitmap.height);
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  return canvas;
};

const encodeStatic = async (file: File): Promise<string> => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That file is not a supported image');
  }

  try {
    return encodeCanvas(drawSquare(bitmap));
  } finally {
    bitmap.close();
  }
};

const encodeAnimated = async (file: File, bytes: Uint8Array, type: 'gif' | 'png'): Promise<AvatarUpload> => {
  if (bytes.length > MAX_ANIMATED_BYTES) throw new Error(ANIMATED_ERROR);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(ANIMATED_ERROR);
  }

  try {
    if (bitmap.width > MAX_ANIMATED_DIMENSION || bitmap.height > MAX_ANIMATED_DIMENSION) throw new Error(ANIMATED_ERROR);

    let poster: string;
    try {
      poster = encodeCanvas(drawSquare(bitmap));
    } catch {
      throw new Error(ANIMATED_ERROR);
    }

    return { avatar: `data:image/${type};base64,${toBase64(bytes)}`, poster };
  } finally {
    bitmap.close();
  }
};

export const encodeAvatar = async (file: File): Promise<AvatarUpload> => {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());

  if (hasMagic(header, GIF_SIGNATURE) || file.type === 'image/gif') {
    if (file.size > MAX_ANIMATED_BYTES) throw new Error(ANIMATED_ERROR);
    return encodeAnimated(file, new Uint8Array(await file.arrayBuffer()), 'gif');
  }

  if (file.size > MAX_SOURCE_BYTES) throw new Error('Images must be 5 MB or smaller');
  if (!hasMagic(header, PNG_SIGNATURE)) return { avatar: await encodeStatic(file) };

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === 'image/apng' || hasApngChunk(bytes)) return encodeAnimated(file, bytes, 'png');

  return { avatar: await encodeStatic(file) };
};
