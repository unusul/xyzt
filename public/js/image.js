// Phone photos are often larger than the 5 MB the bucket accepts: shrink them in the browser before the upload.
const MAX_SIDE = 1600;
const KEEP_AS_IS_BYTES = 600 * 1024;

export async function prepareImage(file) {
    if (file.type === 'image/gif' || file.size <= KEEP_AS_IS_BYTES) return file;
    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
        return blob && blob.size < file.size ? blob : file;
    } catch {
        return file; // a format the browser cannot decode: let the bucket accept or refuse it
    }
}
