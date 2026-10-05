export type GradeLevelKey = 'Kelas VII' | 'Kelas VIII' | 'Kelas IX';

export interface GradeLevelDefinition {
  key: GradeLevelKey;
  roman: 'VII' | 'VIII' | 'IX';
  number: '7' | '8' | '9';
  label: string;
  shortLabel: string;
  description: string;
  subClasses: string[];
}

export const SUB_CLASS_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

export const GRADE_HIERARCHY: GradeLevelDefinition[] = [
  {
    key: 'Kelas VII',
    roman: 'VII',
    number: '7',
    label: 'Tingkat VII (Kelas VII)',
    shortLabel: 'Tingkat VII',
    description: 'Sub-Kelas Standar 7A sampai 7J',
    subClasses: ['7A', '7B', '7C', '7D', '7E', '7F', '7G', '7H', '7I', '7J'],
  },
  {
    key: 'Kelas VIII',
    roman: 'VIII',
    number: '8',
    label: 'Tingkat VIII (Kelas VIII)',
    shortLabel: 'Tingkat VIII',
    description: 'Sub-Kelas Standar 8A sampai 8J',
    subClasses: ['8A', '8B', '8C', '8D', '8E', '8F', '8G', '8H', '8I', '8J'],
  },
  {
    key: 'Kelas IX',
    roman: 'IX',
    number: '9',
    label: 'Tingkat IX (Kelas IX)',
    shortLabel: 'Tingkat IX',
    description: 'Sub-Kelas Standar 9A sampai 9J',
    subClasses: ['9A', '9B', '9C', '9D', '9E', '9F', '9G', '9H', '9I', '9J'],
  },
];

export const DEFAULT_CLASSES: string[] = GRADE_HIERARCHY.flatMap(g => g.subClasses);

/**
 * Standar 30 Ruang Ujian: Ruang 01 sampai Ruang 30
 */
export const DEFAULT_ROOMS: string[] = Array.from(
  { length: 30 },
  (_, idx) => `Ruang ${String(idx + 1).padStart(2, '0')}`
);

/**
 * Normalizes a room name:
 * - '1' / '01' / 'Ruang 1' / 'ruang 01' / 'R.1' -> 'Ruang 01'
 * - '30' / 'Ruang 30' -> 'Ruang 30'
 */
export function normalizeRoomName(input: string): string {
  if (!input) return '';
  const cleaned = input.trim().replace(/\s+/g, ' ');
  const numMatch = cleaned.match(/^(?:ruang|r\.?|rm\.?)?\s*0*([1-9]\d*)$/i);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    if (num >= 1 && num <= 99) {
      return `Ruang ${String(num).padStart(2, '0')}`;
    }
    return `Ruang ${num}`;
  }
  return cleaned;
}

export function isStandardRoomName(input: string): boolean {
  const norm = normalizeRoomName(input);
  return DEFAULT_ROOMS.includes(norm);
}

export function compareRoomNames(a: string, b: string): number {
  const normA = normalizeRoomName(a || '');
  const normB = normalizeRoomName(b || '');
  const matchA = normA.match(/^Ruang\s+(\d+)$/i);
  const matchB = normB.match(/^Ruang\s+(\d+)$/i);
  if (matchA && matchB) {
    return parseInt(matchA[1], 10) - parseInt(matchB[1], 10);
  }
  if (matchA && !matchB) return -1;
  if (!matchA && matchB) return 1;
  return normA.localeCompare(normB, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Checks if a string is a bare grade-level name (e.g., "VII", "Kelas VII", "Kelas 7")
 * rather than a specific sub-class (e.g., "7A").
 */
export function isGradeLevelOnly(input: string): boolean {
  if (!input) return false;
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, ' ');
  return /^(KELAS\s+|TINGKAT\s+)?(VII|VIII|IX|7|8|9)$/.test(cleaned);
}

/**
 * Normalizes sub-class name:
 * - '7a' -> '7A'
 * - 'kelas 7b' -> '7B'
 * - 'vii-c' / 'vii c' -> '7C'
 * - 'viii a' -> '8A'
 * - 'ix j' -> '9J'
 * - 'A' (with fallbackGrade 'Kelas VII') -> '7A'
 */
export function normalizeClassName(input: string, fallbackGrade?: GradeLevelKey | string): string {
  if (!input) return '';
  let cleaned = input.trim().toUpperCase().replace(/\s+/g, ' ');
  cleaned = cleaned.replace(/^(KELAS|TINGKAT|SUB\s*KELAS)\s+/i, '').trim();

  // Convert Roman numeral prefix + letter (e.g. "VIII A", "VII-B", "IXC") to number + letter
  const romanSubMatch = cleaned.match(/^(VIII|VII|IX)[\s\-_]*([A-Z0-9]+)$/i);
  if (romanSubMatch) {
    const roman = romanSubMatch[1].toUpperCase();
    const suffix = romanSubMatch[2].toUpperCase();
    const num = roman === 'VII' ? '7' : roman === 'VIII' ? '8' : '9';
    return `${num}${suffix}`;
  }

  // Standard pattern like '7 a' or '7-a' -> '7A'
  const numMatch = cleaned.match(/^([789])[\s\-_]*([A-Za-z0-9]+)$/);
  if (numMatch) {
    return `${numMatch[1]}${numMatch[2].toUpperCase()}`;
  }

  // Single letter 'A' - 'Z' when a grade level is selected
  if (/^[A-Z]$/.test(cleaned) && fallbackGrade) {
    const num = fallbackGrade.includes('VIII') || fallbackGrade.includes('8')
      ? '8'
      : fallbackGrade.includes('IX') || fallbackGrade.includes('9')
      ? '9'
      : '7';
    return `${num}${cleaned}`;
  }

  return cleaned;
}

/**
 * Determines the parent Tingkatan ('Kelas VII' | 'Kelas VIII' | 'Kelas IX')
 * for a given sub-class name or explicit gradeLevel field.
 */
export function getGradeLevelFromClass(className?: string, explicitGrade?: string): GradeLevelKey {
  if (explicitGrade) {
    const eg = explicitGrade.trim().toUpperCase();
    if (eg === 'KELAS VIII' || eg === 'VIII' || eg === '8' || eg === 'TINGKAT VIII') return 'Kelas VIII';
    if (eg === 'KELAS IX' || eg === 'IX' || eg === '9' || eg === 'TINGKAT IX') return 'Kelas IX';
    if (eg === 'KELAS VII' || eg === 'VII' || eg === '7' || eg === 'TINGKAT VII') return 'Kelas VII';
  }

  const norm = normalizeClassName(className || '');
  if (norm.startsWith('8') || /^VIII\b/i.test(norm)) return 'Kelas VIII';
  if (norm.startsWith('9') || /^IX\b/i.test(norm)) return 'Kelas IX';
  return 'Kelas VII';
}

/**
 * Returns a deduplicated, sorted list of sub-classes combining standard A-J per grade and database records
 */
export function getMergedClassList(dbClasses: Array<{ name?: string; gradeLevel?: string } | string>): string[] {
  const set = new Set<string>();
  DEFAULT_CLASSES.forEach(c => set.add(c));

  dbClasses.forEach(item => {
    const raw = typeof item === 'string' ? item : item?.name;
    const explicitGrade = typeof item === 'object' ? item?.gradeLevel : undefined;
    if (raw && raw.trim() && raw !== '-' && !isGradeLevelOnly(raw)) {
      const normalized = normalizeClassName(raw, explicitGrade);
      if (normalized && !isGradeLevelOnly(normalized)) {
        set.add(normalized);
      }
    }
  });

  return Array.from(set).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );
}

/**
 * Returns sub-classes grouped by their parent Tingkatan (Kelas VII, Kelas VIII, Kelas IX)
 */
export function getGroupedClassList(
  dbClasses: Array<{ name?: string; gradeLevel?: string } | string>
): Record<GradeLevelKey, string[]> {
  const all = getMergedClassList(dbClasses);
  const grouped: Record<GradeLevelKey, string[]> = {
    'Kelas VII': [],
    'Kelas VIII': [],
    'Kelas IX': [],
  };

  all.forEach(c => {
    const grade = getGradeLevelFromClass(c);
    grouped[grade].push(c);
  });

  return grouped;
}
