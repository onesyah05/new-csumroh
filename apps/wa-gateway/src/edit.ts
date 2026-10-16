import { generateMessageIDV2, generateWAMessageFromContent, jidNormalizedUser, proto } from '@whiskeysockets/baileys';

export type EditQuote = {
  /** ID pesan yang dikutip. */
  messageId: string;
  /** Teks pesan yang dikutip (salinan saat dibalas). */
  text: string;
  /** Pesan yang dikutip dikirim oleh kita (brand), bukan oleh jamaah. */
  fromMe: boolean;
};

/** Bagian socket Baileys yang dipakai edit; dipisah agar mudah diuji dengan socket palsu. */
export type EditSocket = {
  user?: { id?: string } | null;
  sendMessage(jid: string, content: any, options?: any): Promise<unknown>;
  relayMessage(jid: string, message: any, options: any): Promise<unknown>;
};

/**
 * Isi pesan edit WhatsApp (protocolMessage MESSAGE_EDIT). Bila pesan asli membalas pesan lain, kutipannya ikut di dalam
 * isi yang diedit: klien penerima mengganti isi pesan secara utuh, jadi tanpa konteks kutipan, balasan kehilangan
 * kutipannya setelah diedit.
 */
export function buildEditMessage(input: { jid: string; messageId: string; text: string; ownJid?: string | null; quote?: EditQuote | null }): proto.IMessage {
  const { jid, messageId, text, ownJid, quote } = input;
  const editedMessage: proto.IMessage = quote
    ? {
        extendedTextMessage: {
          text,
          contextInfo: {
            stanzaId: quote.messageId,
            // Chat pribadi: pengirim kutipan adalah kita sendiri atau lawan bicara.
            participant: quote.fromMe && ownJid ? jidNormalizedUser(ownJid) : jid,
            quotedMessage: { conversation: quote.text },
          },
        },
      }
    : { conversation: text };
  return {
    protocolMessage: {
      key: { remoteJid: jid, id: messageId, fromMe: true },
      type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
      editedMessage,
      timestampMs: Date.now() as unknown as proto.Message.IProtocolMessage['timestampMs'],
    },
  };
}

/**
 * Edit teks pesan yang kita kirim. Pesan tanpa kutipan memakai jalur standar Baileys. Pesan yang membalas pesan lain
 * dikirim lewat relay dengan kutipan di dalam isi edit; bila relay gagal, jatuh ke jalur standar (edit tetap terjadi,
 * kutipan bisa hilang di sisi penerima). Mengembalikan jalur yang dipakai.
 */
export async function editMessage(
  socket: EditSocket,
  input: { jid: string; messageId: string; text: string; quote?: EditQuote | null },
  onFallback?: (error: unknown) => void,
): Promise<'quoted' | 'standard'> {
  const { jid, messageId, text, quote } = input;
  const ownJid = socket.user?.id ?? null;
  if (quote && ownJid) {
    try {
      const full = generateWAMessageFromContent(jid, buildEditMessage({ jid, messageId, text, ownJid, quote }), {
        userJid: ownJid,
        messageId: generateMessageIDV2(ownJid),
      });
      await socket.relayMessage(jid, full.message!, { messageId: full.key.id!, additionalAttributes: { edit: '1' } });
      return 'quoted';
    } catch (error) {
      onFallback?.(error);
    }
  }
  await socket.sendMessage(jid, { text, edit: { remoteJid: jid, id: messageId, fromMe: true } });
  return 'standard';
}
