/** Nomor WhatsApp terhubung → "+62 821-8501-1153". Selain 62 dikembalikan dengan awalan "+". */
export function formatWaNumber(value?: string | null): string | null {
  if (!value) return null;
  const clean = value.replace(/\D/g, '');
  if (!clean) return null;
  if (clean.startsWith('62') && clean.length >= 10) {
    const rest = clean.slice(2);
    if (rest.length <= 8) return `+62 ${rest.slice(0, 3)}-${rest.slice(3)}`;
    return `+62 ${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`;
  }
  return `+${clean}`;
}
