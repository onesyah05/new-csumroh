import path from 'node:path';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState, type WASocket } from '@whiskeysockets/baileys';
import { z } from 'zod';
import { addLidMappings, toGatewayContact, toGatewayMessage, type HistoryContact } from './messages.js';

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
      statuses.set(brandId,'disconnected'); await notify('/wa/status',{brandId,status:'disconnected'});
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut && !manuallyStopped.has(brandId)) {
        const timer = setTimeout(() => void startSession(brandId), 2500);
        reconnectTimers.set(brandId, timer);
      }
    }
  });
  socket.ev.on('messaging-history.set', async ({ contacts, lidPnMappings, messages }) => {
    addLidMappings(lidPnMap, lidPnMappings, contacts);
    await syncContacts(brandId, contacts, lidPnMap);
    const history = messages
      .map((message) => toGatewayMessage(brandId, message, lidPnMap))
      .filter((message): message is NonNullable<typeof message> => Boolean(message));
    const skipped = messages.length - history.length;
    logger.info({ brandId, received: messages.length, imported: history.length, skipped }, 'Importing WhatsApp history');
    for (let index = 0; index < history.length; index += 50) {
      await notify('/messages/history', { brandId, messages: history.slice(index, index + 50) });
    }
  });
  socket.ev.on('messages.upsert', async ({ messages }) => {
    for (const message of messages) {
      const payload = toGatewayMessage(brandId, message, lidPnMap);
      if (payload) await notify('/messages/incoming', payload);
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
app.use(express.json({limit:'2mb'}));
app.use((req,res,next)=>{if(req.get('x-internal-secret')!==env.WA_GATEWAY_SECRET){res.status(401).json({success:false,error:'Unauthorized'});return;}next();});
app.get('/health',(_req,res)=>res.json({success:true,data:{service:'wa-gateway',sessions:sessions.size}}));
app.post('/sessions/:brandId/start',async(req,res,next)=>{try{const brandId=brandIdSchema.parse(req.params.brandId);await startSession(brandId);res.json({success:true,data:{brandId,status:statuses.get(brandId)}});}catch(error){next(error);}});
app.post('/sessions/:brandId/logout',async(req,res,next)=>{try{const brandId=brandIdSchema.parse(req.params.brandId);await stopSession(brandId);res.json({success:true,data:{brandId,status:'disconnected'}});}catch(error){next(error);}});
app.get('/sessions/:brandId/status',(req,res,next)=>{try{const brandId=brandIdSchema.parse(req.params.brandId);res.json({success:true,data:{brandId,status:statuses.get(brandId)??'disconnected',phoneNumber:sessions.get(brandId)?.user?.id}});}catch(error){next(error);}});
app.post('/sessions/:brandId/history',async(req,res,next)=>{try{const brandId=brandIdSchema.parse(req.params.brandId);const input=z.object({jid:z.string().min(5).max(100),phone:z.string().min(5).max(30).optional(),messageId:z.string().min(1).max(100),isFromMe:z.boolean(),timestamp:z.coerce.number().int().positive(),count:z.coerce.number().int().min(1).max(50).default(50)}).parse(req.body);const socket=sessions.get(brandId);if(!socket||statuses.get(brandId)!=='connected'){res.status(409).json({success:false,error:'WhatsApp session is not connected'});return;}if(input.jid.endsWith('@lid')){const mapped=await socket.signalRepository.lidMapping.getPNForLID(input.jid).catch(()=>undefined);if(mapped)lidPnMaps.get(brandId)?.set(input.jid,mapped);else if(input.phone)lidPnMaps.get(brandId)?.set(input.jid,input.phone);}const requestId=await socket.fetchMessageHistory(input.count,{remoteJid:input.jid,id:input.messageId,fromMe:input.isFromMe},input.timestamp*1000);logger.info({brandId,jid:input.jid,count:input.count,requestId},'Requested on-demand WhatsApp history');res.status(202).json({success:true,data:{requestId,status:'requested'}});}catch(error){next(error);}});
app.post('/sessions/:brandId/messages',async(req,res,next)=>{try{const brandId=Number(req.params.brandId);const input=z.object({jid:z.string().min(5),text:z.string().min(1).max(4000)}).parse(req.body);const socket=sessions.get(brandId);if(!socket||statuses.get(brandId)!=='connected'){res.status(409).json({success:false,error:'WhatsApp session is not connected'});return;}const sent=await socket.sendMessage(input.jid,{text:input.text});res.status(201).json({success:true,data:{messageId:sent?.key.id}});}catch(error){next(error);}});
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{logger.error(error);res.status(500).json({success:false,error:'WhatsApp gateway error'});});
app.listen(env.WA_GATEWAY_PORT,()=>{logger.info(`WA gateway ready on :${env.WA_GATEWAY_PORT}`);void restoreSessions().catch((error)=>logger.error(error,'Failed to restore WhatsApp sessions'));});
