import { describe, expect, it } from 'vitest';
import { annotateScript, buildScriptContext } from './context.js';

const brand = { name: 'Nava Tours', ppiuNumber: '123', bankName: null, bankAccountNumber: null, bankAccountHolder: null };
const script = { script: 'Kantor {{travel}}:\n{{alamat_kantor}}\n\n{{link_maps}}' };

describe('Token alamat kantor di pustaka script', () => {
  it('mengisi alamat dan link Maps dari data brand', () => {
    const ctx = buildScriptContext({ csName: 'CS', brand: { ...brand, address: 'Jl. Merdeka 1, Medan', gmapsUrl: 'https://maps.app.goo.gl/abc' }, pkg: null, prospect: null });
    expect(ctx.variables.alamat_kantor).toBe('Jl. Merdeka 1, Medan');
    expect(ctx.variables.link_maps).toBe('https://maps.app.goo.gl/abc');
  });

  it('memblokir script bila alamat brand kosong, bukan mengarang alamat', () => {
    const ctx = buildScriptContext({ csName: 'CS', brand: { ...brand, address: '  ', gmapsUrl: null }, pkg: null, prospect: null });
    const result = annotateScript(script, ctx);
    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('Admin perlu melengkapi alamat kantor brand');
  });
});
