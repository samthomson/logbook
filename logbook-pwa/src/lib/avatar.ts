/** Deterministic avatar colour + initials so contributors are easy to tell apart. */

const PALETTE = [
  { bg: '#dbeafe', fg: '#1e40af' },
  { bg: '#dcfce7', fg: '#166534' },
  { bg: '#fce7f3', fg: '#9d174d' },
  { bg: '#ffedd5', fg: '#9a3412' },
  { bg: '#ede9fe', fg: '#5b21b6' },
  { bg: '#ccfbf1', fg: '#115e59' },
  { bg: '#fef9c3', fg: '#854d0e' },
  { bg: '#fee2e2', fg: '#991b1b' },
] as const

export function avatarInitials(name: string | null | undefined, pubkey: string): string {
  const trimmed = name?.trim()
  if (trimmed) {
    const words = trimmed.split(/\s+/).filter((word) => word.length > 0 && word !== '-')
    if (words.length >= 2) {
      return (words[0][0] + words[words.length - 1][0]).toUpperCase()
    }
    if (words[0].length >= 2) return words[0].slice(0, 2).toUpperCase()
    return words[0][0].toUpperCase()
  }
  return pubkey.slice(0, 2).toUpperCase()
}

export function avatarStyle(pubkey: string): { backgroundColor: string; color: string } {
  let hash = 5381
  for (let i = 0; i < pubkey.length; i += 1) {
    hash = ((hash << 5) + hash) ^ pubkey.charCodeAt(i)
  }
  const index = Math.abs(hash) % PALETTE.length
  const { bg, fg } = PALETTE[index]
  return { backgroundColor: bg, color: fg }
}
