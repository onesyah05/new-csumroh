import { randomUUID } from 'node:crypto';
import { capiEventForStatus, type ProspectStatus } from '@csumroh/shared-types';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { buildCapiPayload } from './capi.payload.js';

export async function dispatchCapiForStatus(prospectId: number, status: ProspectStatus) {
  const eventName = capiEventForStatus(status);
  if (!eventName) return;
  const prospect = await prisma.prospect.findUnique({ where:{id:prospectId}, include:{brand:true} });
  if (!prospect?.phone || !prospect.brand.metaPixelId || !prospect.brand.metaAccessToken) return;
  const eventId = `${eventName}-${prospect.id}-${randomUUID()}`;
  const payload = buildCapiPayload({eventName,eventId,phone:prospect.phone,value:eventName==='Purchase'?Number(prospect.dealValue):undefined});
  let responseStatus:number|undefined;let responseBody='';let logStatus:'success'|'failed'='failed';
  try {
    const response=await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${prospect.brand.metaPixelId}/events?access_token=${encodeURIComponent(prospect.brand.metaAccessToken)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    responseStatus=response.status;responseBody=(await response.text()).slice(0,10000);logStatus=response.ok?'success':'failed';
  } catch(error) { responseBody=error instanceof Error?error.message:'Network error'; }
  await prisma.metaCapiLog.create({data:{brandId:prospect.brandId,prospectId:prospect.id,eventName,eventId,payload:JSON.stringify(payload),responseStatus,responseBody,status:logStatus}});
}
