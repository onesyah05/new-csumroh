import { fileURLToPath } from 'node:url';
import sharp, { type OverlayOptions } from 'sharp';

/**
 * Itinerary sebagai gambar: template kosong buatan designer (1080×1350, rasio 4:5) + teks paket di area TETAP.
 * Angka area di bawah adalah kontrak dengan designer (panduan unduhan memakai angka yang sama): jangan diubah
 * tanpa memberi tahu designer, karena template lama akan tertimpa teks di tempat yang salah.
 */
export const ITINERARY_CANVAS = { width: 1080, height: 1350 } as const;

type Zone = { x: number; y: number; width: number; height: number };
export const ITINERARY_ZONES = {
  /** Bebas untuk designer: logo, nama brand, ornamen. Tidak diberi teks. */
  header: { x: 0, y: 0, width: 1080, height: 150 },
  /** Nama paket: maksimal 2 baris, huruf mengecil otomatis (64 → 40 px). */
  title: { x: 60, y: 165, width: 960, height: 170 },
  /** Tanggal berangkat & durasi: 1 baris. */
  date: { x: 60, y: 345, width: 960, height: 56 },
  /** Daftar agenda per hari: huruf mengecil otomatis (34 → 22 px); bila tetap tidak muat, dipotong. */
  body: { x: 60, y: 415, width: 960, height: 805 },
  /** Bebas untuk designer: kontak, alamat, ajakan bertanya. Tidak diberi teks. */
  footer: { x: 0, y: 1230, width: 1080, height: 120 },
} as const satisfies Record<string, Zone>;

/** Banner terang → teks gelap; banner gelap → teks terang. Dipilih designer per brand. */
export type ItineraryTone = 'light' | 'dark';
export const ITINERARY_TONES: ItineraryTone[] = ['light', 'dark'];
const PALETTE = {
  light: { text: '#1f2937', accent: '#0f766e' },
  dark: { text: '#f8fafc', accent: '#5eead4' },
} as const;

const FONTS = fileURLToPath(new URL('../../../assets/fonts/', import.meta.url));
const FONT_FAMILY = 'Plus Jakarta Sans';
const FONT_FILES = {
  regular: `${FONTS}PlusJakartaSans_400Regular.ttf`,
  semibold: `${FONTS}PlusJakartaSans_600SemiBold.ttf`,
  extrabold: `${FONTS}PlusJakartaSans_800ExtraBold.ttf`,
} as const;

const escapeMarkup = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Font bundel didaftarkan sekali per proses; setelah itu Pango memilih bobot lewat nama keluarga. */
let fontsReady: Promise<void> | null = null;
function registerFonts() {
  fontsReady ??= (async () => {
    for (const fontfile of Object.values(FONT_FILES)) {
      await sharp({ text: { text: 'a', font: FONT_FAMILY, fontfile, rgba: true } }).png().toBuffer();
    }
  })();
  return fontsReady;
}

type TextSpec = { markup: string; width: number; height?: number; size: number; align?: 'left' | 'centre'; spacing?: number };

async function renderText({ markup, width, height, size, align = 'left', spacing = 0 }: TextSpec) {
  const buffer = await sharp({
    text: { text: markup, font: `${FONT_FAMILY} ${size}`, width, height, rgba: true, align, spacing, wrap: 'word' },
  }).png().toBuffer({ resolveWithObject: true });
  return { input: buffer.data, width: buffer.info.width, height: buffer.info.height };
}

/** Ukuran huruf terbesar (max → min) yang membuat teks muat dalam tinggi area. */
async function fitText(build: (size: number) => TextSpec, max: number, min: number, maxHeight: number) {
  for (let size = max; size >= min; size -= 2) {
    const rendered = await renderText(build(size));
    if (rendered.height <= maxHeight) return { ...rendered, size, fits: true };
  }
  return { ...(await renderText(build(min))), size: min, fits: false };
}

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export function itineraryDateText(pkg: { departureDate?: Date | string | null; departureInfo?: string | null; duration?: string | null }) {
  const key = pkg.departureDate instanceof Date ? pkg.departureDate.toISOString().slice(0, 10) : typeof pkg.departureDate === 'string' ? pkg.departureDate.slice(0, 10) : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  const date = match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : pkg.departureInfo || '';
  return [date && `Berangkat ${date}`, pkg.duration].filter(Boolean).join(' · ');
}

/** "Hari 1: ..." → label diberi aksen, isi tetap biasa; baris tanpa label ditulis apa adanya. */
function itineraryMarkup(itinerary: string, tone: ItineraryTone) {
  return itinerary
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(hari\s*\d+[^:]{0,20}):\s*(.*)$/i.exec(line);
      return match
        ? `<span foreground="${PALETTE[tone].accent}" font_weight="800">${escapeMarkup(match[1]!)}:</span>  ${escapeMarkup(match[2]!)}`
        : escapeMarkup(line);
    })
    // Jarak antar hari berupa baris kecil (bukan baris kosong penuh) agar itinerary 9–12 hari tetap muat.
    .join('\n<span size="7168"> </span>\n');
}

/** Agenda: huruf terbesar (34 → 20 px) yang membuat seluruh teks muat di area agenda. */
const fitBody = (itinerary: string, tone: ItineraryTone = 'light') => fitText(
  (size) => ({ markup: `<span foreground="${PALETTE[tone].text}">${itineraryMarkup(itinerary, tone)}</span>`, width: ITINERARY_ZONES.body.width, size, spacing: 4 }),
  34, 20, ITINERARY_ZONES.body.height,
);

/** Batas ketik di form paket; batas pastinya tetap `itineraryFits` karena jumlah baris yang menentukan, bukan karakter. */
export const ITINERARY_MAX_CHARS = 1600;

/** Apakah itinerary muat utuh di gambar pada ukuran huruf terkecil (tanpa template; area teks tetap). */
export async function itineraryFits(itinerary: string) {
  await registerFonts();
  return (await fitBody(itinerary)).fits;
}

export type ItineraryInput = { name: string; dateText: string; itinerary: string };

export async function renderItineraryImage(templatePath: string | Buffer, input: ItineraryInput, tone: ItineraryTone = 'light') {
  await registerFonts();
  const { title, date, body } = ITINERARY_ZONES;
  const { text: color, accent } = PALETTE[tone];

  const titleText = await fitText(
    (size) => ({ markup: `<span foreground="${color}" font_weight="800">${escapeMarkup(input.name)}</span>`, width: title.width, size, spacing: -1 }),
    64, 40, title.height,
  );
  const dateLayer = input.dateText
    ? await fitText((size) => ({ markup: `<span foreground="${accent}" font_weight="600">${escapeMarkup(input.dateText)}</span>`, width: date.width, size }), 34, 24, date.height)
    : null;
  const bodyText = await fitBody(input.itinerary, tone);

  // Teks yang tetap tidak muat pada ukuran minimum dipotong di batas area, bukan menimpa footer.
  const bodyCrop = { left: 0, top: 0, width: bodyText.width, height: Math.min(bodyText.height, body.height) };
  const titleTop = title.y + Math.max(0, Math.round((title.height - Math.min(titleText.height, title.height)) / 2));
  const layers: OverlayOptions[] = [
    { input: await sharp(titleText.input).extract({ left: 0, top: 0, width: titleText.width, height: Math.min(titleText.height, title.height) }).toBuffer(), left: title.x, top: titleTop },
    ...(dateLayer ? [{ input: dateLayer.input, left: date.x, top: date.y }] : []),
    { input: await sharp(bodyText.input).extract(bodyCrop).toBuffer(), left: body.x, top: body.y },
  ];

  const image = await sharp(templatePath).resize(ITINERARY_CANVAS.width, ITINERARY_CANVAS.height, { fit: 'cover' }).composite(layers).png({ compressionLevel: 9 }).toBuffer();
  return { image, truncated: !bodyText.fits };
}

export const ITINERARY_SAMPLE = {
  name: 'Umroh Syawal Reguler Bintang 5 Direct',
  dateText: 'Berangkat 15 Oktober 2026 · 9 Hari',
  itinerary: [
    'Hari 1: Kumpul di Bandara Soekarno-Hatta, penerbangan menuju Madinah.',
    'Hari 2: Tiba di Madinah, check-in hotel, istirahat dan ibadah di Masjid Nabawi.',
    'Hari 3: Ziarah Raudhah dan Makam Rasulullah SAW, manasik persiapan umroh.',
    'Hari 4: Ziarah kota Madinah (Masjid Quba, Jabal Uhud, Kebun Kurma).',
    'Hari 5: Miqat di Bir Ali, menuju Makkah, check-in hotel dan umroh pertama.',
    'Hari 6: Ibadah mandiri dan memperbanyak thawaf sunnah di Masjidil Haram.',
    'Hari 7: Ziarah kota Makkah (Jabal Tsur, Arafah, Muzdalifah, Mina).',
    'Hari 8: Thawaf Wada dan persiapan menuju Bandara Jeddah.',
    'Hari 9: Penerbangan kepulangan dan tiba di Bandara Soekarno-Hatta.',
  ].join('\n'),
};

/** Pratinjau untuk designer: template brand + contoh paket 9 hari, dengan warna teks sesuai pilihan banner. */
export function renderItineraryPreview(templatePath: string, tone: ItineraryTone) {
  return renderItineraryImage(templatePath, ITINERARY_SAMPLE, tone).then((result) => result.image);
}

/**
 * Panduan untuk designer (PNG 1080×1350): latar abu-abu dengan setiap area berlabel dan contoh teks. Designer
 * membuat template di kanvas yang sama dan membiarkan area teks tetap terang dan polos.
 */
export async function renderItineraryGuide(tone: ItineraryTone = 'light') {
  const zoneFill = tone === 'dark' ? 'rgba(15,23,42,0.88)' : 'rgba(255,255,255,0.7)';
  const { width, height } = ITINERARY_CANVAS;
  const label = (zone: Zone, name: string, fill: string, stroke: string) =>
    `<rect x="${zone.x + 2}" y="${zone.y + 2}" width="${zone.width - 4}" height="${zone.height - 4}" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-dasharray="14 8"/>` +
    // Label di atas kotak (bukan di dalam) agar tidak tertimpa contoh teks; area header/footer berlabel di dalam.
    `<text x="${zone.x + 16}" y="${zone.y > 0 && zone.y < 1200 ? zone.y - 6 : zone.y + 30}" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="${stroke}">${name} · x${zone.x} y${zone.y} · ${zone.width}×${zone.height} px</text>`;
  const { header, title, date, body, footer } = ITINERARY_ZONES;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#f4f4f5"/>
    ${label(header, 'AREA DESIGNER (logo / ornamen)', 'rgba(37,99,235,0.08)', '#2563eb')}
    ${label(footer, 'AREA DESIGNER (kontak / ornamen)', 'rgba(37,99,235,0.08)', '#2563eb')}
    ${label(title, 'NAMA PAKET (maks. 2 baris)', zoneFill, '#dc2626')}
    ${label(date, 'TANGGAL BERANGKAT · DURASI (1 baris)', zoneFill, '#dc2626')}
    ${label(body, 'AGENDA PER HARI', zoneFill, '#dc2626')}
    <text x="16" y="${height - 36}" font-family="Arial, sans-serif" font-size="18" fill="#52525b">Kanvas 1080×1350 px. ${tone === 'dark' ? 'Banner GELAP: area merah harus polos dan gelap (teks terang).' : 'Banner TERANG: area merah harus polos dan terang (teks gelap).'}</text>
    <text x="16" y="${height - 14}" font-family="Arial, sans-serif" font-size="18" fill="#52525b">Beri jarak ±24 px di sekeliling area merah. Hanya acuan posisi; jangan diunggah sebagai template.</text>
  </svg>`;
  await registerFonts();
  const { name, dateText, itinerary } = ITINERARY_SAMPLE;
  const blank = await sharp(Buffer.from(svg)).png().toBuffer();
  const { image } = await renderItineraryImage(blank, { name, dateText, itinerary }, tone);
  return image;
}
