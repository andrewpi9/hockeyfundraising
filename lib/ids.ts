import { customAlphabet } from "nanoid";

// No look-alike characters: a share code gets read aloud and typed by hand.
const shortAlphabet = "23456789abcdefghijkmnpqrstuvwxyz";
export const shareCode = customAlphabet(shortAlphabet, 8);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Uppercase, no I/O/0/1: a join code gets read off a whiteboard. */
export const joinCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
