// ── WebP Autocompression helper ────────────────────────────────────────────────
export async function compressImageToWebp(file: File): Promise<{
  dataUrl: string;
  originalSize: number;
  compressedSize: number;
  savingsPercent: number;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('File gambar tidak valid.'));
      img.onload = () => {
        const maxW = 1200;
        const maxH = 1600;
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > maxW || height > maxH) {
          const ratio = Math.min(maxW / width, maxH / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas tidak didukung oleh peramban.'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/webp', 0.82);
        const base64Length = dataUrl.length - (dataUrl.indexOf(',') + 1);
        const compressedSize = Math.round((base64Length * 3) / 4);
        const originalSize = file.size;
        const savingsPercent = Math.max(0, Math.round(((originalSize - compressedSize) / originalSize) * 100));

        resolve({ dataUrl, originalSize, compressedSize, savingsPercent });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
