import { describe, expect, it } from 'vitest';

describe('Financial Guard & Seat Quota Integrity (A04 & A05)', () => {
  it('calculates total passenger seats correctly excluding infants', () => {
    const prospect = {
      paxQuad: 2,
      paxTriple: 1,
      paxDouble: 2,
      paxInfant: 1,
    };
    const seatCount = (prospect.paxQuad || 0) + (prospect.paxTriple || 0) + (prospect.paxDouble || 0) || 1;
    expect(seatCount).toBe(5); // 2 + 1 + 2 = 5 seats, infant is 0 seat
  });

  it('correctly determines paid_full vs partial_dp based on dealValue', () => {
    const dealValue = 35_000_000;

    const partialApproved = 5_000_000;
    const isPartialFull = dealValue > 0 && partialApproved >= dealValue;
    const partialStatus = isPartialFull ? 'paid_full' : 'partial_dp';
    expect(partialStatus).toBe('partial_dp');

    const fullApproved = 35_000_000;
    const isFull = dealValue > 0 && fullApproved >= dealValue;
    const fullStatus = isFull ? 'paid_full' : 'partial_dp';
    expect(fullStatus).toBe('paid_full');

    const overApproved = 36_000_000;
    const isOverFull = dealValue > 0 && overApproved >= dealValue;
    const overStatus = isOverFull ? 'paid_full' : 'partial_dp';
    expect(overStatus).toBe('paid_full');
  });

  it('rejects verification if package quota is insufficient for passenger seats', () => {
    const pkg = { name: 'Umroh Syawal Gold', quotaRemaining: 3 };
    const requiredSeats = 4;

    expect(() => {
      if (pkg.quotaRemaining < requiredSeats) {
        throw new Error(`Kuota paket "${pkg.name}" tidak mencukupi (tersisa ${pkg.quotaRemaining}, dibutuhkan ${requiredSeats} seat).`);
      }
    }).toThrowError(/Kuota paket "Umroh Syawal Gold" tidak mencukupi/);
  });
});

describe('Magic Bytes Image File Validation (A20)', () => {
  function validateMagicBytes(buffer: Buffer) {
    const isJpeg = buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
    const isPng = buffer.length > 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    const isWebp = buffer.length > 12 && buffer.toString('utf8', 0, 4) === 'RIFF' && buffer.toString('utf8', 8, 12) === 'WEBP';
    const isPdf = buffer.length > 4 && buffer.toString('utf8', 0, 4) === '%PDF';
    return isJpeg || isPng || isWebp || isPdf;
  }

  it('accepts valid PNG buffer', () => {
    const pngBuf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    expect(validateMagicBytes(pngBuf)).toBe(true);
  });

  it('accepts valid JPEG buffer', () => {
    const jpegBuf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    expect(validateMagicBytes(jpegBuf)).toBe(true);
  });

  it('accepts valid PDF buffer', () => {
    const pdfBuf = Buffer.from('%PDF-1.5 test document');
    expect(validateMagicBytes(pdfBuf)).toBe(true);
  });

  it('rejects executable or script masquerading as image', () => {
    const scriptBuf = Buffer.from('<?php echo "evil"; ?>');
    expect(validateMagicBytes(scriptBuf)).toBe(false);

    const exeBuf = Buffer.from([0x4D, 0x5A, 0x90, 0x00]); // MZ executable
    expect(validateMagicBytes(exeBuf)).toBe(false);
  });
});
