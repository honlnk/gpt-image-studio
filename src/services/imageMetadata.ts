export type ImageDimensions = {
  width: number;
  height: number;
};

export async function readImageDimensions(blob: Blob): Promise<ImageDimensions | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      const dimensions = {
        width: bitmap.width,
        height: bitmap.height,
      };
      bitmap.close();
      return dimensions;
    } catch {
      // Fall back to HTMLImageElement decoding below.
    }
  }

  return readImageDimensionsFromElement(blob);
}

function readImageDimensionsFromElement(blob: Blob): Promise<ImageDimensions | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    image.src = url;
  });
}
