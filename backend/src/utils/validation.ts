export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 31;
export const USERNAME_PATTERN = /^[a-z0-9_-]+$/;

export const isValidUsername = (value: string): boolean => value.length >= USERNAME_MIN_LENGTH && value.length <= USERNAME_MAX_LENGTH && USERNAME_PATTERN.test(value);

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/;

export const containsControlChars = (value: string): boolean => CONTROL_CHARS.test(value);

export const containsBidiControls = (value: string): boolean => BIDI_CONTROLS.test(value);
