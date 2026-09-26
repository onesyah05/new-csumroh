import { useState } from 'react';

export const profileTextFields = ['name', 'phone', 'city', 'targetMonth', 'budgetRange', 'roomPreference', 'decisionMaker', 'specialNeeds', 'passportStatus', 'vaccineStatus', 'notes', 'nextFollowupDate', 'packageId'] as const;
export const paxFields = ['paxQuad', 'paxTriple', 'paxDouble', 'paxInfant'] as const;
export type ProfileForm = Record<typeof profileTextFields[number], string> & Record<typeof paxFields[number], number>;
export function profileForm(source: any): ProfileForm {
  const form: any = {};
  for (const key of profileTextFields) form[key] = String(source?.[key] ?? '');
  form.nextFollowupDate = form.nextFollowupDate.slice(0, 10);
  for (const key of paxFields) form[key] = Number(source?.[key] ?? 0);
  return form;
}
const prefix = 'azhan.profile-draft.';
type Draft = { form: ProfileForm; baseUpdatedAt?: string };
function read(key: string): Draft | null {
  try { const data = JSON.parse(sessionStorage.getItem(key) || 'null'); return data?.form ? { ...data, form: profileForm(data.form) } : null; } catch { return null; }
}
export function clearProfileDrafts() {
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix) || key.startsWith('azhan.chat-draft.') || key.startsWith('azhan.inbox.')) sessionStorage.removeItem(key); } catch { /* Logout must remain available without browser storage. */ }
}
// Mount this hook in a component keyed by staff + brand + prospect.
export function useProfileDraft(identity: string, source: any) {
  const key = prefix + identity;
  const [draft, setDraft] = useState<Draft | null>(() => read(key));
  const serverForm = profileForm(source);
  // Paket dipilih langsung tersimpan (bukan bagian draft); draft lama yang membawa paket tidak boleh menimpanya.
  const form = draft ? { ...draft.form, packageId: serverForm.packageId } : serverForm;
  // Draft yang isinya sama dengan data server bukan perubahan: jangan tampilkan "Belum disimpan".
  const dirty = Boolean(draft) && JSON.stringify(form) !== JSON.stringify(serverForm);
  function update(patch: Partial<ProfileForm>) {
    setDraft(previous => {
      const next = { form: { ...(previous?.form ?? profileForm(source)), ...patch }, baseUpdatedAt: previous?.baseUpdatedAt ?? source?.updatedAt };
      try { sessionStorage.setItem(key, JSON.stringify(next)); } catch { /* In-memory draft still works when storage is unavailable. */ }
      return next;
    });
  }
  function clear() { try { sessionStorage.removeItem(key); } catch { /* Optional persistence. */ } setDraft(null); }
  return { form, update, clear, dirty, changedOnServer: dirty && Boolean(draft?.baseUpdatedAt && source?.updatedAt !== draft!.baseUpdatedAt) };
}

export function appendDraft(previous: string, inserted: string) {
  return previous.trim() ? `${previous.trimEnd()}\n\n${inserted}` : inserted;
}

export function validateProfile(form: ProfileForm): string | null {
  if (!form.name.trim()) return 'Nama prospek wajib diisi.';
  if (paxFields.some(key => !Number.isInteger(form[key]) || form[key] < 0)) return 'Jumlah jamaah harus bilangan bulat nol atau lebih.';
  return null;
}

// The setter captures the conversation identity, including during an async send.
export function useConversationDraft(identity: string) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const readMessage = (key: string) => { try { return sessionStorage.getItem(`azhan.chat-draft.${key}`) || ''; } catch { return ''; } };
  function setMessage(value: string | ((previous: string) => string)) {
    setDrafts(previous => {
      const next = typeof value === 'function' ? value(previous[identity] ?? readMessage(identity)) : value;
      try { if (next) sessionStorage.setItem(`azhan.chat-draft.${identity}`, next); else sessionStorage.removeItem(`azhan.chat-draft.${identity}`); } catch { /* Draft stays available in memory when storage is full. */ }
      return { ...previous, [identity]: next };
    });
  }
  return [drafts[identity] ?? readMessage(identity), setMessage] as const;
}
export function appendFlyerCaption(previous: string, caption: string) {
  return previous.trimEnd().endsWith(caption.trimEnd()) ? previous : appendDraft(previous, caption);
}
