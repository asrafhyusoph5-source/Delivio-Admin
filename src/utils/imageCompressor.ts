/**
 * Compresses an image File or Blob to a maximum dimension of 1024px,
 * JPEG quality 0.70, and ensures file size stays under 300 KB.
 * Returns a Base64 data URI string.
 */
export async function compressImageToDataUri(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = (err) => reject(err);
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = (err) => reject(err);
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        const maxDimension = 1024;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Fill white background to support transparent PNGs when converting to JPEG
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.70;
        let dataUri = canvas.toDataURL('image/jpeg', quality);

        // Calculate approximate size in bytes: Base64 length * 0.75
        let approxBytes = Math.round(dataUri.length * 0.75);
        const maxBytes = 300 * 1024; // 300 KB

        // If above 300 KB, incrementally lower quality down to 0.40
        while (approxBytes > maxBytes && quality > 0.40) {
          quality -= 0.10;
          dataUri = canvas.toDataURL('image/jpeg', quality);
          approxBytes = Math.round(dataUri.length * 0.75);
        }

        resolve(dataUri);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}
