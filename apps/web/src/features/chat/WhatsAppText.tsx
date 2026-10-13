import { Fragment } from 'react';
import { whatsappSegments } from './scriptLibrary';
import { cn } from '../../lib/cn';

/** Teks dengan tebal WhatsApp (*teks*) seperti yang akan terlihat di ponsel jamaah. */
export function WhatsAppText({ text, className }: { text: string; className?: string }) {
  return <p className={cn('whitespace-pre-line break-words', className)}>{whatsappSegments(text).map((part, index) => part.bold ? <strong key={index} className="font-semibold">{part.text}</strong> : <Fragment key={index}>{part.text}</Fragment>)}</p>;
}
