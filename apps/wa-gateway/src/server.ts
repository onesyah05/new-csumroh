import path from 'node:path';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  downloadMediaMessage,
  normalizeMessageContent,
  getContentType,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { z } from 'zod';
import { addLidMappings, normalizePhone, toGatewayContact, toGatewayMessage, type HistoryContact } from './messages.js';
import { acquireInstanceLock } from './instance-lock.js';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const env = z.object({ WA_GATEWAY_PORT: z.coerce.number().default(4001), WA_GATEWAY_SECRET: z.string().min(16), API_INTERNAL_URL: z.string().url().default('http://localhost:4000'), WEB_ORIGIN: z.string().default('http://localhost:5173') }).parse(process.env);
const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'info' : 'warn' });
const sessions = new Map<number, WASocket>();
const statuses = new Map<number, string>();
const lidPnMaps = new Map<number, Map<string, string>>();
const reconnectTimers = new Map<number, NodeJS.Timeout>();
const generations = new Map<number, number>();
const manuallyStopped = new Set<number>();
const sessionsRoot = path.resolve(process.cwd(), 'sessions');
const brandIdSchema = z.coerce.number().int().positive();

async function notify(pathname: string, payload: unknown) {
  try {
    const response = await fetch(`${env.API_INTERNAL_URL}/internal${pathname}`, { method:'POST', headers:{'content-type':'application/json','x-internal-secret':env.WA_GATEWAY_SECRET}, body:JSON.stringify(payload) });
    if (!response.ok) logger.warn({ status: response.status, pathname }, 'API notification failed');
  } catch (error) {
    logger.warn({ error, pathname }, 'API notification unavailable');
  }
}

async function downloadAndSaveMedia(socket: WASocket, message: WAMessage): Promise<string | null> {
  try {
    const content = normalizeMessageContent(message.message);
    if (!content) return null;
    const messageType = getContentType(content);
    if (!messageType || !['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(messageType)) {
      return null;
    }

    const buffer = await downloadMediaMessage(
      message,
      'buffer',
      {},
      {
        logger,
        reuploadRequest: socket.updateMediaMessage,
      }
    );

    if (!buffer || !Buffer.isBuffer(buffer)) return null;

    let ext = '.bin';
    if (messageType === 'imageMessage') ext = '.jpg';
    else if (messageType === 'videoMessage') ext = '.mp4';
    else if (messageType === 'audioMessage') ext = (content as any).audioMessage?.ptt ? '.ogg' : '.mp3';
    else if (messageType === 'documentMessage') {
      const fileName = (content as any).documentMessage?.fileName || '';
      ext = path.extname(fileName) || '.pdf';
    }

    const cleanId = (message.key.id || `${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${Date.now()}_${cleanId}${ext}`;

    const uploadsDir = path.resolve(process.cwd(), '..', 'api', 'uploads', 'media');
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(path.join(uploadsDir, fileName), buffer);
    return `/uploads/media/${fileName}`;
  } catch (err) {
    logger.warn({ err, messageId: message.key.id }, 'Failed to download media message');
    return null;
  }
}

async function syncContacts(brandId: number, contacts: HistoryContact[], lidPnMap: Map<string, string>) {
  const normalized = contacts
    .map((contact) => toGatewayContact(brandId, contact, lidPnMap))
    .filter((contact): contact is NonNullable<typeof contact> => Boolean(contact));
  if (!normalized.length) return;
  logger.info({ brandId, received: contacts.length, imported: normalized.length }, 'Importing WhatsApp contacts');
  for (let index = 0; index < normalized.length; index += 100) {
    await notify('/contacts/sync', { brandId, contacts: normalized.slice(index, index + 100) });
  }
}

async function startSession(brandId: number) {
  const generation = (generations.get(brandId) ?? 0) + 1;
  generations.set(brandId, generation);
  manuallyStopped.delete(brandId);
  const reconnectTimer = reconnectTimers.get(brandId);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimers.delete(brandId);
  const previous = sessions.get(brandId);
  sessions.delete(brandId);
  previous?.end(undefined);
  statuses.set(brandId, 'connecting');
  await notify('/wa/status', { brandId, status: 'connecting', qrCode: null });
  const authPath = path.join(sessionsRoot, `brand_${brandId}`);
  await mkdir(authPath, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();
  const lidPnMap = new Map<string, string>();
  lidPnMaps.set(brandId, lidPnMap);
  const socket = makeWASocket({
    auth: state,
    version,
    browser: Browsers.ubuntu('CS Umroh'),
    logger,
    markOnlineOnConnect: false,
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
  });
  sessions.set(brandId, socket);
  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (generations.get(brandId) !== generation) return;
    if (qr) { statuses.set(brandId,'qr_ready'); await notify('/wa/status',{brandId,status:'qr_ready',qrCode:await QRCode.toDataURL(qr)}); }
    if (connection === 'open') { statuses.set(brandId,'connected'); await notify('/wa/status',{brandId,status:'connected',qrCode:null,phoneNumber:socket.user?.id.split(':')[0]}); }
    if (connection === 'close') {
      sessions.delete(brandId);
      statuses.set(brandId, 'disconnected');
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      const isLoggedOut = code === DisconnectReason.loggedOut || code === 401;
      // Sesi yang sama dibuka di tempat lain (mis. gateway kedua). Menyambung ulang otomatis akan
      // memutus pihak lain, lalu diputus balik — putus-sambung tanpa henti. Berhenti dan minta tindakan.
      const isReplaced = code === DisconnectReason.connectionReplaced;
      if (isReplaced) {
        logger.error({ brandId, code }, 'WhatsApp session replaced by another connection; auto-reconnect disabled. Pastikan hanya satu wa-gateway berjalan, lalu sambungkan ulang dari menu Perangkat.');
      }
      if (isLoggedOut) {
        logger.warn({ brandId, code }, 'Session logged out or device removed, clearing credentials');
        await rm(path.join(sessionsRoot, `brand_${brandId}`), { recursive: true, force: true }).catch(() => null);
      }
      await notify('/wa/status', { brandId, status: 'disconnected', qrCode: null });
      if (!isLoggedOut && !isReplaced && !manuallyStopped.has(brandId)) {
        const timer = setTimeout(() => void startSession(brandId), 2500);
        reconnectTimers.set(brandId, timer);
      }
    }
  });
  socket.ev.on('messaging-history.set', async ({ contacts, lidPnMappings, messages, chats }: any) => {
    addLidMappings(lidPnMap, lidPnMappings, contacts);
    const unreadChatJids = new Set<string>();
    if (Array.isArray(chats)) {
      for (const chat of chats) {
        if ((chat?.unreadCount ?? 0) > 0 && chat?.id) {
          unreadChatJids.add(chat.id);
        }
      }
    }

    const history = messages
      .map((message: any) => {
        const remoteJid = message.key?.remoteJid;
        const isChatUnread = remoteJid ? unreadChatJids.has(remoteJid) : false;
        return toGatewayMessage(brandId, message, lidPnMap, {
          isHistory: true,
          isChatRead: !isChatUnread,
        });
      })
      .filter((message: any): message is NonNullable<typeof message> => Boolean(message));
    const skipped = messages.length - history.length;
    logger.info({ brandId, received: messages.length, imported: history.length, skipped }, 'Importing WhatsApp history');
    for (let index = 0; index < history.length; index += 50) {
      await notify('/messages/history', { brandId, messages: history.slice(index, index + 50) });
    }
    // Sync contacts AFTER history messages so existing prospects get updated with WhatsApp username / contact name
    await syncContacts(brandId, contacts, lidPnMap);
  });
  socket.ev.on('messages.upsert', async ({ messages }) => {
    for (const message of messages) {
      const payload = toGatewayMessage(brandId, message, lidPnMap);
      if (payload) {
        if (['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(payload.messageType) && !payload.mediaUrl) {
          const mediaUrl = await downloadAndSaveMedia(socket, message);
          if (mediaUrl) payload.mediaUrl = mediaUrl;
        }
        await notify('/messages/incoming', payload);
      }
    }
  });
  socket.ev.on('chats.update', async (updates) => {
    for (const update of updates) {
      if (!update.id) continue;
      const isRead = update.unreadCount === 0 || (update as any).read === true;
      if (isRead) {
        await notify('/chats/read', {
          brandId,
          remoteJid: update.id,
        });
      }
    }
  });
  socket.ev.on('messages.update', async (updates) => {
    for (const { key, update } of updates) {
      if (!key?.id) continue;
      const rawStatus = (update as any)?.status;
      let status: string | undefined;
      if (rawStatus === 4 || rawStatus === 5 || rawStatus === 'READ' || rawStatus === 'PLAYED') {
        status = 'read';
      } else if (rawStatus === 3 || rawStatus === 'DELIVERY_ACK') {
        status = 'delivered';
      } else if (rawStatus === 2 || rawStatus === 'SERVER_ACK') {
        status = 'sent';
      }
      if (status) {
        await notify('/messages/status', {
          brandId,
          messageId: key.id,
          remoteJid: key.remoteJid,
          status,
        });
      }
    }
  });
  socket.ev.on('message-receipt.update', async (receipts) => {
    for (const item of receipts) {
      if (!item.key?.id) continue;
      const receipt = item.receipt;
      const isRead = Boolean(receipt?.readTimestamp || (receipt as any)?.read || receipt?.playedTimestamp);
      if (isRead) {
        await notify('/messages/status', {
          brandId,
          messageId: item.key.id,
          remoteJid: item.key.remoteJid,
          status: 'read',
        });
      } else if (receipt?.receiptTimestamp) {
        await notify('/messages/status', {
          brandId,
          messageId: item.key.id,
          remoteJid: item.key.remoteJid,
          status: 'delivered',
        });
      }
    }
  });
  socket.ev.on('messages.reaction', async (reactions) => {
    for (const item of reactions) {
      if (!item.key?.id) continue;
      await notify('/messages/reaction', {
        brandId,
        messageId: item.key.id,
        remoteJid: item.key.remoteJid,
        emoji: item.reaction?.text || null,
      });
    }
  });
  socket.ev.on('contacts.upsert', async (contacts) => {
    addLidMappings(lidPnMap, [], contacts);
    await syncContacts(brandId, contacts, lidPnMap);
  });
  socket.ev.on('contacts.update', async (contacts) => {
    addLidMappings(lidPnMap, [], contacts);
    await syncContacts(brandId, contacts, lidPnMap);
  });
  return socket;
}

async function stopSession(brandId: number) {
  manuallyStopped.add(brandId);
  generations.set(brandId, (generations.get(brandId) ?? 0) + 1);
  const reconnectTimer = reconnectTimers.get(brandId);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimers.delete(brandId);
  const socket = sessions.get(brandId);
  sessions.delete(brandId);
  lidPnMaps.delete(brandId);
  if (socket) {
    await socket.logout().catch((error) => logger.warn({ error, brandId }, 'WhatsApp logout failed'));
    socket.end(undefined);
  }
  statuses.set(brandId, 'disconnected');
  await rm(path.join(sessionsRoot, `brand_${brandId}`), { recursive: true, force: true });
  await notify('/wa/status', { brandId, status: 'disconnected', qrCode: null, phoneNumber: null });
}

async function restoreSessions() {
  await mkdir(sessionsRoot, { recursive: true });
  const entries = await readdir(sessionsRoot, { withFileTypes: true });
  const brandIds = entries
    .filter((entry) => entry.isDirectory() && /^brand_\d+$/.test(entry.name))
    .map((entry) => Number(entry.name.slice('brand_'.length)));
  await Promise.allSettled(brandIds.map((brandId) => startSession(brandId)));
  if (brandIds.length) logger.info({ brandIds }, 'Restored WhatsApp sessions');
}

const app = express();
app.use(helmet());
const origins=env.WEB_ORIGIN.split(',').map((item)=>item.trim());
app.use(cors({origin(origin,callback){callback(null,!origin||origins.includes(origin));},credentials:true}));
app.use(express.json({limit:'50mb'}));
app.get('/health', (_req, res) => res.json({ success: true, data: { service: 'wa-gateway', sessions: sessions.size } }));
app.use((req, res, next) => {
  if (req.get('x-internal-secret') !== env.WA_GATEWAY_SECRET) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  next();
});
app.post('/sessions/:brandId/start', async (req, res, next) => {
  try {
    const brandId = brandIdSchema.parse(req.params.brandId);
    if (statuses.get(brandId) !== 'connected') {
      await rm(path.join(sessionsRoot, `brand_${brandId}`), { recursive: true, force: true }).catch(() => null);
    }
    await startSession(brandId);
    res.json({ success: true, data: { brandId, status: statuses.get(brandId) } });
  } catch (error) {
    next(error);
  }
});
app.post('/sessions/:brandId/logout', async (req, res, next) => {
  try {
    const brandId = brandIdSchema.parse(req.params.brandId);
    await stopSession(brandId);
    res.json({ success: true, data: { brandId, status: 'disconnected' } });
  } catch (error) {
    next(error);
  }
});
app.get('/sessions/:brandId/status',(req,res,next)=>{try{const brandId=brandIdSchema.parse(req.params.brandId);res.json({success:true,data:{brandId,status:statuses.get(brandId)??'disconnected',phoneNumber:sessions.get(brandId)?.user?.id}});}catch(error){next(error);}});
app.get('/sessions/:brandId/profile-pic', async (req, res, next) => {
  try {
    const brandId = brandIdSchema.parse(req.params.brandId);
    const jid = req.query.jid ? String(req.query.jid) : undefined;
    const phone = req.query.phone ? String(req.query.phone) : undefined;
    const socket = sessions.get(brandId);
    if (!socket || statuses.get(brandId) !== 'connected') {
      res.status(409).json({ success: false, error: 'WhatsApp session is not connected' });
      return;
    }

    const lidPnMap = lidPnMaps.get(brandId);
    const candidates: string[] = [];
    if (jid) candidates.push(jid);
    if (jid && jid.endsWith('@lid')) {
      const pn = lidPnMap?.get(jid) || (phone ? phone.replace(/\D/g, '') : undefined);
      if (pn) candidates.push(`${pn}@s.whatsapp.net`);
      try {
        const mapped = await socket.signalRepository?.lidMapping?.getPNForLID(jid);
        if (mapped) candidates.push(`${mapped.replace(/\D/g, '')}@s.whatsapp.net`);
      } catch {}
    }
    if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone) candidates.push(`${cleanPhone}@s.whatsapp.net`);
    }

    let url: string | null = null;
    for (const cand of candidates) {
      try {
        const fetched = await socket.profilePictureUrl(cand, 'image');
        if (fetched) {
          url = fetched;
          break;
        }
      } catch {
        try {
          const fetched = await socket.profilePictureUrl(cand, 'preview');
          if (fetched) {
            url = fetched;
            break;
          }
        } catch {}
      }
    }

    res.json({ success: true, data: { url } });
  } catch (error) {
    next(error);
  }
});
app.post('/sessions/:brandId/history',async(req,res,next)=>{try{const brandId=brandIdSchema.parse(req.params.brandId);const input=z.object({jid:z.string().min(5).max(100),phone:z.string().min(5).max(30).optional(),messageId:z.string().min(1).max(100),isFromMe:z.boolean(),timestamp:z.coerce.number().int().positive(),count:z.coerce.number().int().min(1).max(50).default(50)}).parse(req.body);const socket=sessions.get(brandId);if(!socket||statuses.get(brandId)!=='connected'){res.status(409).json({success:false,error:'WhatsApp session is not connected'});return;}if(input.jid.endsWith('@lid')){const mapped=await socket.signalRepository.lidMapping.getPNForLID(input.jid).catch(()=>undefined);if(mapped)lidPnMaps.get(brandId)?.set(input.jid,mapped);else if(input.phone)lidPnMaps.get(brandId)?.set(input.jid,input.phone);}const requestId=await socket.fetchMessageHistory(input.count,{remoteJid:input.jid,id:input.messageId,fromMe:input.isFromMe},input.timestamp*1000);logger.info({brandId,jid:input.jid,count:input.count,requestId},'Requested on-demand WhatsApp history');res.status(202).json({success:true,data:{requestId,status:'requested'}});}catch(error){next(error);}});
app.post('/sessions/:brandId/resolve-lids', async (req, res, next) => {
  try {
    const brandId = brandIdSchema.parse(req.params.brandId);
    const input = z.object({ jids: z.array(z.string().min(5)) }).parse(req.body);
    const socket = sessions.get(brandId);
    const lidPnMap = lidPnMaps.get(brandId);
    const results: Record<string, string> = {};
    for (const jid of input.jids) {
      if (!jid.endsWith('@lid')) continue;
      let pn = lidPnMap?.get(jid);
      if (!pn && socket) {
        pn = await (socket as any).signalRepository?.lidMapping?.getPNForLID(jid).catch(() => undefined);
        if (pn) lidPnMap?.set(jid, pn);
      }
      if (pn) {
        results[jid] = pn.replace(/\D/g, '');
      }
    }
    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
});
app.post('/sessions/:brandId/messages', async (req, res, next) => {
  try {
    const brandId = Number(req.params.brandId);
    const input = z.object({
      jid: z.string().min(5),
      text: z.string().min(1).max(4000),
      quotedMessageId: z.string().optional(),
      quotedText: z.string().optional(),
      isQuotedFromMe: z.boolean().optional(),
    }).parse(req.body);
    const socket = sessions.get(brandId);
    if (!socket || statuses.get(brandId) !== 'connected') {
      res.status(409).json({ success: false, error: 'WhatsApp session is not connected' });
      return;
    }

    let targetJid = input.jid;
    if (!targetJid.includes('@')) {
      targetJid = `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
    }
    if (targetJid.endsWith('@lid')) {
      const pn = lidPnMaps.get(brandId)?.get(targetJid);
      if (pn) {
        const clean = normalizePhone(pn);
        if (clean) targetJid = `${clean}@s.whatsapp.net`;
      }
    }

    const options: any = {};
    if (input.quotedMessageId) {
      options.quoted = {
        key: {
          remoteJid: targetJid,
          id: input.quotedMessageId,
          fromMe: input.isQuotedFromMe ?? false,
        },
        message: {
          conversation: input.quotedText || '',
        },
      };
    }

    const sent = await socket.sendMessage(targetJid, { text: input.text }, options);
    res.status(201).json({ success: true, data: { messageId: sent?.key.id } });
  } catch (error) {
    next(error);
  }
});

app.post('/sessions/:brandId/media', async (req, res, next) => {
  try {
    const brandId = brandIdSchema.parse(req.params.brandId);
    const input = z.object({
      jid: z.string().min(5),
      fileName: z.string().min(1).max(255),
      mimeType: z.string().min(1).max(100),
      base64Data: z.string().min(1),
      mediaType: z.enum(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage']),
      caption: z.string().max(4000).optional(),
      quotedMessageId: z.string().optional(),
    }).parse(req.body);

    const socket = sessions.get(brandId);
    if (!socket || statuses.get(brandId) !== 'connected') {
      res.status(409).json({ success: false, error: 'WhatsApp session is not connected' });
      return;
    }

    let targetJid = input.jid;
    if (!targetJid.includes('@')) {
      targetJid = `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
    }
    if (targetJid.endsWith('@lid')) {
      const pn = lidPnMaps.get(brandId)?.get(targetJid);
      if (pn) {
        const clean = normalizePhone(pn);
        if (clean) targetJid = `${clean}@s.whatsapp.net`;
      }
    }

    const options: any = {};
    if (input.quotedMessageId) {
      options.quoted = {
        key: {
          remoteJid: targetJid,
          id: input.quotedMessageId,
          fromMe: false,
        },
      };
    }

    const buffer = Buffer.from(input.base64Data, 'base64');
    let messageContent: any;

    if (input.mediaType === 'imageMessage') {
      messageContent = {
        image: buffer,
        caption: input.caption || undefined,
        mimetype: input.mimeType,
      };
    } else if (input.mediaType === 'videoMessage') {
      messageContent = {
        video: buffer,
        caption: input.caption || undefined,
        mimetype: input.mimeType,
      };
    } else if (input.mediaType === 'audioMessage') {
      messageContent = {
        audio: buffer,
        mimetype: input.mimeType,
        ptt: false,
      };
    } else {
      messageContent = {
        document: buffer,
        mimetype: input.mimeType,
        fileName: input.fileName,
        caption: input.caption || undefined,
      };
    }

    const sent = await socket.sendMessage(targetJid, messageContent, options);
    res.status(201).json({ success: true, data: { messageId: sent?.key.id } });
  } catch (error) {
    next(error);
  }
});

app.post('/sessions/:brandId/delete', async (req, res, next) => {
  try {
    const brandId = brandIdSchema.parse(req.params.brandId);
    const input = z.object({
      jid: z.string().min(5),
      messageId: z.string().min(1),
      isFromMe: z.boolean(),
    }).parse(req.body);

    const socket = sessions.get(brandId);
    if (!socket || statuses.get(brandId) !== 'connected') {
      res.status(409).json({ success: false, error: 'WhatsApp session is not connected' });
      return;
    }

    let targetJid = input.jid;
    if (!targetJid.includes('@')) {
      targetJid = `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
    }

    await socket.sendMessage(targetJid, {
      delete: {
        remoteJid: targetJid,
        id: input.messageId,
        fromMe: input.isFromMe,
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post('/sessions/:brandId/react', async (req, res, next) => {
  try {
    const brandId = brandIdSchema.parse(req.params.brandId);
    const input = z.object({
      jid: z.string().min(5),
      messageId: z.string().min(1),
      isFromMe: z.boolean(),
      participant: z.string().optional(),
      emoji: z.string().max(10).default(''),
    }).parse(req.body);

    const socket = sessions.get(brandId);
    if (!socket || statuses.get(brandId) !== 'connected') {
      res.status(409).json({ success: false, error: 'WhatsApp session is not connected' });
      return;
    }

    let targetJid = input.jid;
    if (!targetJid.includes('@')) {
      targetJid = `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
    }

    await socket.sendMessage(targetJid, {
      react: {
        text: input.emoji,
        key: {
          remoteJid: targetJid,
          id: input.messageId,
          fromMe: input.isFromMe,
          ...(input.participant ? { participant: input.participant } : {}),
        },
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post('/sessions/:brandId/read', async (req, res, next) => {
  try {
    const brandId = brandIdSchema.parse(req.params.brandId);
    const input = z.object({
      jid: z.string().min(3),
      messageIds: z.array(z.string()).optional(),
    }).parse(req.body);

    const socket = sessions.get(brandId);
    if (!socket || statuses.get(brandId) !== 'connected') {
      res.status(409).json({ success: false, error: 'WhatsApp session is not connected' });
      return;
    }

    let targetJid = input.jid;
    if (!targetJid.includes('@')) {
      targetJid = `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
    }
    if (targetJid.endsWith('@lid')) {
      const pn = lidPnMaps.get(brandId)?.get(targetJid);
      if (pn) {
        const clean = normalizePhone(pn);
        if (clean) targetJid = `${clean}@s.whatsapp.net`;
      }
    }

    // 1. Send read receipts for individual messages to WhatsApp server (sender gets blue ticks)
    if (input.messageIds && input.messageIds.length > 0) {
      const keys = input.messageIds.map((id) => ({
        remoteJid: targetJid,
        id,
        fromMe: false,
      }));
      await socket.readMessages(keys).catch((err) => logger.warn({ err, targetJid }, 'Failed to readMessages'));
    }

    // 2. Mark chat as read in WhatsApp app state (clears unread badge on physical phone)
    await socket.chatModify({ markRead: true, lastMessages: [] }, targetJid).catch(() => null);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{logger.error(error);res.status(500).json({success:false,error:'WhatsApp gateway error'});});
// Satu gateway per folder sesi: dua instance dengan kredensial yang sama saling memutus sesi WhatsApp.
const instanceLock = acquireInstanceLock(sessionsRoot);
if (!instanceLock.acquired) {
  logger.fatal({ holderPid: instanceLock.holderPid }, `wa-gateway lain (PID ${instanceLock.holderPid}) sudah memakai folder sesi ini. Instance ini berhenti.`);
  process.exit(1);
}
process.on('exit', () => instanceLock.release());
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => process.exit(0));

const server = app.listen(env.WA_GATEWAY_PORT, () => {
  logger.info(`WA gateway ready on :${env.WA_GATEWAY_PORT}`);
  void restoreSessions().catch((error) => logger.error(error, 'Failed to restore WhatsApp sessions'));
});
// Gagal mendapat port = jangan tetap hidup setengah jalan; keluar agar tidak ada sesi yatim.
server.on('error', (error) => {
  logger.fatal({ error }, `wa-gateway gagal membuka port ${env.WA_GATEWAY_PORT}`);
  process.exit(1);
});
