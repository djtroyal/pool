export function normalizeUsername(input: string): string | null {
  const normalized = input.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!normalized || /\p{Cc}/u.test(normalized)) return null;
  const count = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(normalized)].length
    : Array.from(normalized).length;
  return count >= 1 && count <= 20 ? normalized : null;
}

const SEVERE_BLOCKS = [
  'nigger', 'nigga', 'kike', 'spic', 'chink', 'faggot', 'retard',
  'hitler', 'nazi', 'rape', 'rapist', 'pedo', 'pedophile'
];
const WORD_BLOCKS = [
  'fuck', 'fucker', 'fucking', 'shit', 'bitch', 'cunt', 'dick', 'cock',
  'pussy', 'whore', 'slut', 'asshole', 'motherfucker'
];
const RESERVED = ['admin', 'administrator', 'moderator', 'system', 'server', 'breakroom', 'cpu'];

function usernameSkeleton(value: string): string {
  return value.normalize('NFKD').toLocaleLowerCase('en-US')
    .replace(/\p{M}/gu, '')
    .replace(/[013457@$!|]/gu, (character) => ({
      '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '|': 'i'
    })[character] ?? character)
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function inappropriateUsername(input: string): boolean {
  const normalized = normalizeUsername(input);
  if (!normalized) return false;
  const skeleton = usernameSkeleton(normalized);
  if (RESERVED.includes(skeleton)) return true;
  if (SEVERE_BLOCKS.some((blocked) => skeleton.includes(blocked))) return true;
  const words = normalized.normalize('NFKD').toLocaleLowerCase('en-US').replace(/\p{M}/gu, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.some((word) => WORD_BLOCKS.includes(usernameSkeleton(word)));
}
