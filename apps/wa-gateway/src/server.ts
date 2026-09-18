import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, getContentType, useMultiFileAuthState, type WASocket, type WAMessage } from '@whiskeysockets/baileys';
import { z } from 'zod';
import { extractMetaReferral } from './referral.js';

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

const env = z.object({ WA_GATEWAY_PORT: z.coerce.number().default(4001), WA_GATEWAY_SECRET: z.string().min(16), API_INTERNAL_URL: z.string().url().default('http://localhost:4000'), WEB_ORIGIN: z.string().default('http://localhost:5173') }).parse(process.env);
const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'info' : 'warn' });
const sessions = new Map<number, WASocket>();
const statuses = new Map<number, string>();

async function notify(pathname: string, payload: unknown) {
  const response = await fetch(`${env.API_INTERNAL_URL}/internal${pathname}`, { method:'POST', headers:{'content-type':'application/json','x-internal-secret':env.WA_GATEWAY_SECRET}, body:JSON.stringify(payload) });
  if (!response.ok) logger.warn({ status: response.status, pathname }, 'API notification failed');
}

function messageText(message: WAMessage) {
  const body = message.message;
  if (!body) return '';
  return body.conversation ?? body.extendedTextMessage?.text ?? body.imageMessage?.caption ?? body.videoMessage?.caption ?? body.documentMessage?.caption ?? '';
}

async function startSession(brandId: number) {
  sessions.get(brandId)?.end(undefined);
  statuses.set(brandId, 'connecting');
  const authPath = path.resolve(process.cwd(), 'sessions', `brand_${brandId}`);
  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();
  const socket = makeWASocket({ auth: state, version, browser: Browsers.ubuntu('CS Umroh'), logger, markOnlineOnConnect: false, syncFullHistory: false });
  sessions.set(brandId, socket);
  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) { statuses.set(brandId,'qr_ready'); await notify('/wa/status',{brandId,status:'qr_ready',qrCode:await QRCode.toDataURL(qr)}); }
    if (connection === 'open') { statuses.set(brandId,'connected'); await notify('/wa/status',{brandId,status:'connected',phoneNumber:socket.user?.id.split(':')[0]}); }
    if (connection === 'close') {
      statuses.set(brandId,'disconnected'); await notify('/wa/status',{brandId,status:'disconnected'});
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) setTimeout(() => void startSession(brandId), 2500);
    }
  });
  socket.ev.on('messages.upsert', async ({ messages }) => {
    for (const message of messages) {
      if (!message.key.remoteJid || !message.key.id) continue;
      const type = getContentType(message.message ?? undefined) ?? 'conversation';
      await notify('/messages/incoming', { brandId, messageId:message.key.id, remoteJid:message.key.remoteJid, phone:message.key.remoteJid.split('@')[0], senderName:message.pushName, text:messageText(message), timestamp:Number(message.messageTimestamp), messageType:type, referral:extractMetaReferral(message) });
    }
  });
  return socket;
}

const app = express();
app.use(helmet());
const origins=env.WEB_ORIGIN.split(',').map((item)=>item.trim());
app.use(cors({origin(origin,callback){callback(null,!origin||origins.includes(origin));},credentials:true}));
app.use(express.json({limit:'2mb'}));
app.use((req,res,next)=>{if(req.get('x-internal-secret')!==env.WA_GATEWAY_SECRET){res.status(401).json({success:false,error:'Unauthorized'});return;}next();});
app.get('/health',(_req,res)=>res.json({success:true,data:{service:'wa-gateway',sessions:sessions.size}}));
app.post('/sessions/:brandId/start',async(req,res,next)=>{try{const brandId=Number(req.params.brandId);await startSession(brandId);res.json({success:true,data:{brandId,status:statuses.get(brandId)}});}catch(error){next(error);}});
app.get('/sessions/:brandId/status',(req,res)=>{const brandId=Number(req.params.brandId);res.json({success:true,data:{brandId,status:statuses.get(brandId)??'disconnected',phoneNumber:sessions.get(brandId)?.user?.id}});});
app.post('/sessions/:brandId/messages',async(req,res,next)=>{try{const brandId=Number(req.params.brandId);const input=z.object({jid:z.string().min(5),text:z.string().min(1).max(4000)}).parse(req.body);const socket=sessions.get(brandId);if(!socket||statuses.get(brandId)!=='connected'){res.status(409).json({success:false,error:'WhatsApp session is not connected'});return;}const sent=await socket.sendMessage(input.jid,{text:input.text});res.status(201).json({success:true,data:{messageId:sent?.key.id}});}catch(error){next(error);}});
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{logger.error(error);res.status(500).json({success:false,error:'WhatsApp gateway error'});});
app.listen(env.WA_GATEWAY_PORT,()=>logger.info(`WA gateway ready on :${env.WA_GATEWAY_PORT}`));
