/**
 * Helper kompresi media otomatis di sisi client (browser)
 * Mengurangi beban bandwidth, CPU, memori, dan storage server secara signifikan.
 */

export interface CompressionResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  savingsPercent: number;
  isCompressed: boolean;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export async function autoCompressMedia(
  file: File,
  options: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  } = {}
): Promise<CompressionResult> {
  const originalSize = file.size;

  // Jika bukan gambar (misal dokumen PDF, video, audio), lewati kompresi canvas
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') {
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      savingsPercent: 0,
      isCompressed: false,
    };
  }

  // Jika gambar sudah kecil (< 200 KB), lewati agar tidak menurunkan kualitas tanpa alasan
  if (file.size <= 200 * 1024) {
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      savingsPercent: 0,
      isCompressed: false,
    };
  }

  const maxWidth = options.maxWidth ?? 1600;
  const maxHeight = options.maxHeight ?? 1600;
  const quality = options.quality ?? 0.82;

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;

      // Hitung skala rasio agar tidak melebihi batas resolusi optimal
      if (width > maxWidth || height > maxHeight) {
        if (width > height) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        } else {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({
          file,
          originalSize,
          compressedSize: originalSize,
          savingsPercent: 0,
          isCompressed: false,
        });
        return;
      }

      // Smooth scaling rendering
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      // Ekspor ke JPEG terkompresi
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= originalSize) {
            // Jika hasil kompresi malah lebih besar, pertahankan file asli
            resolve({
              file,
              originalSize,
              compressedSize: originalSize,
              savingsPercent: 0,
              isCompressed: false,
            });
            return;
          }

          const baseName = file.name.replace(/\.[^/.]+$/, '');
          const compressedFile = new File([blob], `${baseName}.jpg`, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });

          const savingsPercent = Math.round(((originalSize - compressedFile.size) / originalSize) * 100);

          resolve({
            file: compressedFile,
            originalSize,
            compressedSize: compressedFile.size,
            savingsPercent,
            isCompressed: true,
          });
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        file,
        originalSize,
        compressedSize: originalSize,
        savingsPercent: 0,
        isCompressed: false,
      });
    };

    img.src = objectUrl;
  });
}
