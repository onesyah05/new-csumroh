export const SCRIPT_VARIABLES = [
  'nama', 'cs_name', 'travel', 'ppiu', 'bank', 'rekening', 'nama_rekening', 'alamat', 'telepon',
  'paket', 'harga', 'dp', 'airline', 'hotel', 'hotel_makkah', 'hotel_madinah', 'durasi',
  'keberangkatan', 'highlights',
] as const;

export type ScriptVariables = Partial<Record<(typeof SCRIPT_VARIABLES)[number], string | number>>;

const narrativeReplacements: Array<[RegExp, string]> = [
  [/\{\{agent_name\}\}/gi, '{{cs_name}}'],
  [/mitra agen konsultan/gi, 'Customer Service resmi {{travel}}'],
  [/agen resmi(?:\s+\{\{travel\}\})?/gi, 'tim layanan jamaah {{travel}}'],
  [/referral link agen/gi, 'kanal resmi {{travel}}'],
  [/sebagai agen\b/gi, 'sebagai konsultan umroh resmi {{travel}}'],
];

export function normalizeScriptNarrative(input: string) {
  return narrativeReplacements.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), input);
}

export function interpolateScript(input: string, variables: ScriptVariables) {
  const normalized = normalizeScriptNarrative(input);
  return normalized.replace(/\{\{([a-z_]+)\}\}/gi, (match, key: string) => {
    const value = variables[key as keyof ScriptVariables];
    return value === undefined || value === null || value === '' ? match : String(value);
  });
}

export function transformScriptTree<T>(value: T, variables: ScriptVariables): T {
  if (typeof value === 'string') return interpolateScript(value, variables) as T;
  if (Array.isArray(value)) return value.map((item) => transformScriptTree(item, variables)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, transformScriptTree(child, variables)]),
    ) as T;
  }
  return value;
}
