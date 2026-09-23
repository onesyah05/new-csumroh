import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  Clock,
  Smile,
  Hand,
  Plane,
  Heart,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '../../lib/cn';

interface EmojiPickerProps {
  onSelectEmoji: (emoji: string) => void;
  onClose?: () => void;
}

type EmojiCategory = {
  id: string;
  name: string;
  icon: typeof Smile;
  emojis: { char: string; keywords: string }[];
};

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'umroh',
    name: 'Ibadah & Umroh',
    icon: Plane,
    emojis: [
      { char: '🕋', keywords: 'kaabah kabah kaaba mekkah mecca masjidil haram' },
      { char: '🕌', keywords: 'masjid mesjid mosque nabawi' },
      { char: '✈️', keywords: 'pesawat terbang flight travel perjalanan' },
      { char: '🤲', keywords: 'doa berdua tangan memohon amin salam' },
      { char: '🙏', keywords: 'terima kasih salam sungkem mohon maaf' },
      { char: '📿', keywords: 'tasbih dzikir zikir doa ibadah' },
      { char: '📖', keywords: 'quran alquran buku bacaan juz' },
      { char: '📜', keywords: 'manifes manifest paspor dokumen' },
      { char: '🌙', keywords: 'bulan sabit ramadhan syawal islam' },
      { char: '⭐', keywords: 'bintang star berkah' },
      { char: '🏨', keywords: 'hotel penginapan makkah madinah bintang' },
      { char: '💳', keywords: 'kartu dp transfer rekening bank pembayaran' },
      { char: '💰', keywords: 'uang rezeki rupiah biaya paket hemat' },
      { char: '🏷️', keywords: 'promo diskon harga voucher kupon' },
      { char: '🌴', keywords: 'kurma pohon palem arab saudi madinah' },
      { char: '🐪', keywords: 'unta camel padang pasir jabal' },
    ],
  },
  {
    id: 'smileys',
    name: 'Wajah & Emosi',
    icon: Smile,
    emojis: [
      { char: '😀', keywords: 'senyum bahagia smile grin' },
      { char: '😃', keywords: 'senang gembira happy smile' },
      { char: '😄', keywords: 'senyum lebar laugh mata' },
      { char: '😁', keywords: 'gigi nyengir grin' },
      { char: '😆', keywords: 'tertawa ngakak tertutup' },
      { char: '😅', keywords: 'keringat lega sweat smile' },
      { char: '😂', keywords: 'lucu ngakak tertawa menangis joy laugh' },
      { char: '🤣', keywords: 'guling tertawa ngakak rofl' },
      { char: '😊', keywords: 'senyum ramah malu blush' },
      { char: '😇', keywords: 'malaikat baik suci halo' },
      { char: '🙂', keywords: 'senyum santai slight smile' },
      { char: '😉', keywords: 'kedip wink sepakat' },
      { char: '😌', keywords: 'lega tenang damai relieved' },
      { char: '😍', keywords: 'cinta suka kagum love eyes' },
      { char: '🥰', keywords: 'penuh cinta sayang hearts' },
      { char: '😘', keywords: 'ciuman kiss love' },
      { char: '😗', keywords: 'cium kiss' },
      { char: '😚', keywords: 'cium mata tertutup' },
      { char: '😋', keywords: 'lezat enak lidah yum' },
      { char: '😛', keywords: 'melet lidah tongue' },
      { char: '😜', keywords: 'kedip melet bercanda' },
      { char: '🤪', keywords: 'gila kocak zany' },
      { char: '🤨', keywords: 'curiga heran alis' },
      { char: '🧐', keywords: 'kacamata cek teliti periksa' },
      { char: '🤓', keywords: 'pintar nerd kacamata' },
      { char: '😎', keywords: 'keren mantap sunglasses' },
      { char: '🤩', keywords: 'bintang kagum wow starry' },
      { char: '🥳', keywords: 'pesta perayaan selamat party' },
      { char: '😏', keywords: 'senyum sinis smirk' },
      { char: '😒', keywords: 'bosan unamused' },
      { char: '😞', keywords: 'kecewa sedih disappointed' },
      { char: '😔', keywords: 'sedih termenung pensive' },
      { char: '😟', keywords: 'khawatir worried' },
      { char: '😕', keywords: 'bingung confused' },
      { char: '🙁', keywords: 'cemberut slight frown' },
      { char: '🥺', keywords: 'memohon harap pleading' },
      { char: '😢', keywords: 'menangis tetes air mata cry' },
      { char: '😭', keywords: 'menangis kencang sedih loud cry' },
      { char: '😤', keywords: 'bangga hembus napas triumph' },
      { char: '😠', keywords: 'marah kesal angry' },
      { char: '😡', keywords: 'marah merah rage' },
      { char: '🤯', keywords: 'kaget pecah kepala mind blown' },
      { char: '😳', keywords: 'terkejut kaget flushed' },
      { char: '🥵', keywords: 'panas terik hot' },
      { char: '🥶', keywords: 'dingin beku cold' },
      { char: '😱', keywords: 'teriak takut kaget scream' },
      { char: '😨', keywords: 'takut cemas fearful' },
      { char: '😰', keywords: 'panik cemas keringat' },
      { char: '😥', keywords: 'kecewa lega sad relieved' },
      { char: '😓', keywords: 'lelah keringat dingin' },
      { char: '🤗', keywords: 'peluk hangat hug' },
      { char: '🤔', keywords: 'berpikir mikir ragu thinking' },
      { char: '🤭', keywords: 'tutup mulut tertawa oops' },
      { char: '🤫', keywords: 'rahasia diam quiet hush' },
      { char: '🤥', keywords: 'bohong pinokio lie' },
      { char: '😶', keywords: 'tanpa ekspresi diam' },
      { char: '😐', keywords: 'netral datar neutral' },
      { char: '😑', keywords: 'tanpa kata expressionless' },
      { char: '😬', keywords: 'meringis grimace' },
      { char: '🙄', keywords: 'memutar mata roll eyes' },
      { char: '😯', keywords: 'terkejut ooh' },
      { char: '🥱', keywords: 'menguap ngantuk yawn' },
      { char: '😴', keywords: 'tidur lelap sleeping' },
    ],
  },
  {
    id: 'gestures',
    name: 'Tangan & Gestur',
    icon: Hand,
    emojis: [
      { char: '👍', keywords: 'jempol oke bagus setuju like thumbs up' },
      { char: '👎', keywords: 'tidak suka dislike' },
      { char: '👌', keywords: 'oke sip mantap sempurna ok' },
      { char: '🤌', keywords: 'apa ini maksud pinched fingers' },
      { char: '✌️', keywords: 'damai dua peace victory' },
      { char: '🤞', keywords: 'berharap semoga crossed fingers' },
      { char: '🫰', keywords: 'saranghae cinta uang mini heart' },
      { char: '🤟', keywords: 'cinta rock love you' },
      { char: '🤙', keywords: 'telepon call me santai' },
      { char: '👈', keywords: 'tunjuk kiri point left' },
      { char: '👉', keywords: 'tunjuk kanan point right' },
      { char: '👆', keywords: 'tunjuk atas point up' },
      { char: '👇', keywords: 'tunjuk bawah point down' },
      { char: '☝️', keywords: 'satu tauhid point up' },
      { char: '👋', keywords: 'halo dadah lambaian wave' },
      { char: '✋', keywords: 'stop tangan stop hand' },
      { char: '👏', keywords: 'tepuk tangan salut applause' },
      { char: '🙌', keywords: 'angkat tangan takbir perayaan celebrating' },
      { char: '👐', keywords: 'tangan terbuka open hands' },
      { char: '🤲', keywords: 'doa telapak tangan doa islam' },
      { char: '🤝', keywords: 'salaman jabat tangan deal sepakat handshake' },
      { char: '🙏', keywords: 'terima kasih tolong salam maaf pray' },
      { char: '✍️', keywords: 'menulis catat write' },
      { char: '💪', keywords: 'semangat kuat otot bicep' },
    ],
  },
  {
    id: 'symbols',
    name: 'Simbol & Hati',
    icon: Heart,
    emojis: [
      { char: '❤️', keywords: 'hati merah cinta love red heart' },
      { char: '💚', keywords: 'hati hijau green heart islam' },
      { char: '💙', keywords: 'hati biru blue heart' },
      { char: '💛', keywords: 'hati kuning yellow heart' },
      { char: '🧡', keywords: 'hati oranye orange heart' },
      { char: '💜', keywords: 'hati ungu purple heart' },
      { char: '🤍', keywords: 'hati putih suci white heart' },
      { char: '🤎', keywords: 'hati cokelat brown heart' },
      { char: '🖤', keywords: 'hati hitam black heart' },
      { char: '💔', keywords: 'patah hati broken heart' },
      { char: '💖', keywords: 'hati berkilau sparkle heart' },
      { char: '✨', keywords: 'berkilau istimewa bintang sparks' },
      { char: '🔥', keywords: 'api laris panas fire' },
      { char: '💯', keywords: 'seratus persen mantap sempurna' },
      { char: '✅', keywords: 'centang hijau sukses checklist' },
      { char: '✔️', keywords: 'centang check' },
      { char: '☑️', keywords: 'kotak centang checked' },
      { char: '❌', keywords: 'silang batal salah cross' },
      { char: '⚠️', keywords: 'peringatan perhatian warning' },
      { char: '📍', keywords: 'lokasi pin tempat makkah madinah' },
      { char: '📌', keywords: 'sematan pin penting' },
      { char: '⏰', keywords: 'jam alarm waktu jadwal' },
      { char: '📅', keywords: 'kalender tanggal jadwal keberangkatan' },
      { char: '📞', keywords: 'telepon hubungi kontak' },
      { char: '✉️', keywords: 'surat pesan email' },
      { char: '💬', keywords: 'chat pesan obrolan balon' },
    ],
  },
];

const RECENT_EMOJIS_KEY = 'csumroh_recent_emojis';

export function EmojiPicker({ onSelectEmoji, onClose }: EmojiPickerProps) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('umroh');
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(RECENT_EMOJIS_KEY);
      return saved ? JSON.parse(saved) : ['👍', '❤️', '😂', '🙏', '🕋', '🕌', '✈️', '🤲', '✅', '✨'];
    } catch {
      return ['👍', '❤️', '😂', '🙏', '🕋', '🕌', '✈️', '🤲', '✅', '✨'];
    }
  });

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  function handlePick(emoji: string) {
    onSelectEmoji(emoji);

    // Simpan ke riwayat emoji terbaru
    const updated = [emoji, ...recentEmojis.filter((e) => e !== emoji)].slice(0, 16);
    setRecentEmojis(updated);
    try {
      localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(updated));
    } catch {}
  }

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;

    const all = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
    const seen = new Set<string>();
    const matches: string[] = [];

    for (const item of all) {
      if (seen.has(item.char)) continue;
      if (item.keywords.toLowerCase().includes(q) || item.char === q) {
        seen.add(item.char);
        matches.push(item.char);
      }
    }

    return matches;
  }, [search]);

  return (
    <div className="flex flex-col h-[340px] w-[330px] sm:w-[360px] rounded-2xl bg-white shadow-2xl border border-zinc-200 overflow-hidden text-zinc-900 select-none animate-in fade-in slide-in-from-bottom-2 duration-150">
      {/* Header & Search */}
      <div className="p-2.5 border-b border-zinc-100 flex items-center gap-2 bg-zinc-50/70">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari emoji (kabah, doa, salam, senyum)..."
            className="w-full h-8 pl-8 pr-7 text-xs rounded-xl bg-white border border-zinc-200 focus:outline-none focus:border-[#00a884] focus:ring-1 focus:ring-[#00a884] transition"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-xl flex items-center justify-center text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-700 transition cursor-pointer"
            title="Tutup"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Category Tab Bar */}
      {!searchResults && (
        <div className="flex items-center px-2 py-1.5 border-b border-zinc-100 gap-1 bg-white overflow-x-auto thin-scrollbar">
          <button
            type="button"
            onClick={() => setActiveCategory('recent')}
            className={cn(
              'h-7 px-2.5 rounded-lg flex items-center gap-1 text-xs font-semibold transition shrink-0 cursor-pointer',
              activeCategory === 'recent'
                ? 'bg-[#00a884]/10 text-[#00a884]'
                : 'text-zinc-500 hover:bg-zinc-100'
            )}
            title="Terakhir Digunakan"
          >
            <Clock size={13} />
            <span className="text-[11px]">Terakhir</span>
          </button>
          {EMOJI_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  'h-7 px-2.5 rounded-lg flex items-center gap-1 text-xs font-semibold transition shrink-0 cursor-pointer',
                  isActive
                    ? 'bg-[#00a884]/10 text-[#00a884]'
                    : 'text-zinc-500 hover:bg-zinc-100'
                )}
                title={cat.name}
              >
                <Icon size={13} />
                <span className="text-[11px]">{cat.name.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Emoji Grid Content */}
      <div className="flex-1 overflow-y-auto thin-scrollbar p-2.5 space-y-3">
        {searchResults ? (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 px-1 mb-1.5">
              Hasil Pencarian ({searchResults.length})
            </p>
            {searchResults.length ? (
              <div className="grid grid-cols-7 sm:grid-cols-8 gap-1">
                {searchResults.map((emoji, idx) => (
                  <button
                    key={`search-${emoji}-${idx}`}
                    type="button"
                    onClick={() => handlePick(emoji)}
                    className="h-10 w-10 text-xl rounded-xl flex items-center justify-center hover:bg-zinc-100 hover:scale-115 active:scale-95 transition cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-zinc-400">
                Tidak ada emoji yang cocok dengan "{search}"
              </div>
            )}
          </div>
        ) : activeCategory === 'recent' ? (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 px-1 mb-1.5 flex items-center gap-1">
              <Sparkles size={11} className="text-amber-500" />
              Sering Digunakan
            </p>
            <div className="grid grid-cols-7 sm:grid-cols-8 gap-1">
              {recentEmojis.map((emoji, idx) => (
                <button
                  key={`rec-${emoji}-${idx}`}
                  type="button"
                  onClick={() => handlePick(emoji)}
                  className="h-10 w-10 text-xl rounded-xl flex items-center justify-center hover:bg-zinc-100 hover:scale-115 active:scale-95 transition cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ) : (
          (() => {
            const currentCat = EMOJI_CATEGORIES.find((c) => c.id === activeCategory) ?? EMOJI_CATEGORIES[0];
            if (!currentCat) return null;
            return (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 px-1 mb-1.5">
                  {currentCat.name}
                </p>
                <div className="grid grid-cols-7 sm:grid-cols-8 gap-1">
                  {currentCat.emojis.map((item, idx) => (
                    <button
                      key={`cat-${item.char}-${idx}`}
                      type="button"
                      onClick={() => handlePick(item.char)}
                      className="h-10 w-10 text-xl rounded-xl flex items-center justify-center hover:bg-zinc-100 hover:scale-115 active:scale-95 transition cursor-pointer"
                    >
                      {item.char}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-zinc-100 bg-zinc-50 text-[10px] text-zinc-400 flex items-center justify-between">
        <span>Klik untuk menyisipkan ke pesan</span>
        <span className="font-semibold text-zinc-500">WhatsApp Web Style</span>
      </div>
    </div>
  );
}
