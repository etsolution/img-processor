import { removeBackground } from 'https://esm.sh/@imgly/background-removal@1.7.0';

// Run AI segmentation once — returns ImageData with transparent background
export async function segmentImage(imageData, onProgress) {
    onProgress('Loading background removal AI...');

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = imageData.width;
    srcCanvas.height = imageData.height;
    srcCanvas.getContext('2d').putImageData(imageData, 0, 0);
    const blob = await new Promise(resolve => srcCanvas.toBlob(resolve, 'image/png'));

    onProgress('Removing background...');
    const resultBlob = await removeBackground(blob, { model: 'large' });

    const img = await createImageBitmap(resultBlob);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
}

// Fast — no AI, just composites cached transparent image onto a background color
export function applyBackground(transparentImageData, bgColor) {
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = 1;
    const tmpCtx = tmp.getContext('2d');
    tmpCtx.fillStyle = bgColor;
    tmpCtx.fillRect(0, 0, 1, 1);
    const [bgR, bgG, bgB] = tmpCtx.getImageData(0, 0, 1, 1).data;

    const src = transparentImageData.data;
    const out = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
        const alpha = src[i + 3] / 255;
        out[i]     = Math.round(src[i]     * alpha + bgR * (1 - alpha));
        out[i + 1] = Math.round(src[i + 1] * alpha + bgG * (1 - alpha));
        out[i + 2] = Math.round(src[i + 2] * alpha + bgB * (1 - alpha));
        out[i + 3] = 255;
    }
    return new ImageData(out, transparentImageData.width, transparentImageData.height);
}
