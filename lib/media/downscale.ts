/**
 * Shrinking a picture in the browser, before it is ever uploaded.
 *
 * Two limits sit above ours and neither gives a readable error. The platform
 * refuses an oversized request body before the route handler runs at all — the
 * reply is a plain-text 413 from the edge, not the sentence we wrote — and LINE
 * has its own ceiling further on. Sending a smaller file is the only fix that
 * works regardless of which one you meet first, and it makes the upload quicker
 * for the operator besides.
 *
 * The output is always JPEG. LINE accepts JPEG and PNG, and a photograph is
 * smaller as a JPEG by a wide margin; the canvas is filled white first so a PNG
 * with transparency does not come out with a black background. It also means an
 * iPhone photo the browser can decode but LINE would refuse arrives as
 * something LINE accepts.
 */

/**
 * Comfortably under the platform's request-body ceiling rather than at it: the
 * multipart envelope and headers ride along with the bytes, and a file that
 * exactly hits the limit is a file that fails.
 */
export const TARGET_UPLOAD_BYTES = 2.5 * 1024 * 1024

/**
 * Plenty for a phone screen and for LINE's own rendering, which never shows the
 * original at anything like this width. Beyond it the extra pixels cost upload
 * time and buy nothing anybody sees.
 */
const MAX_EDGE = 1600

/** Tried in order. Below the last one a photograph starts to look like one. */
const QUALITIES = [0.85, 0.72, 0.6, 0.45]

/** Small already, and in a format LINE takes: leave it alone rather than re-encode. */
function isFineAsItIs(file: File): boolean {
  return (
    (file.type === 'image/jpeg' || file.type === 'image/png') &&
    file.size <= TARGET_UPLOAD_BYTES / 2
  )
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

export class ImageUnreadable extends Error {
  constructor() {
    super('That file could not be read as an image. Try a JPEG or PNG.')
    this.name = 'ImageUnreadable'
  }
}

export async function downscaleImage(file: File): Promise<File> {
  if (isFineAsItIs(file)) return file

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ImageUnreadable()
  }

  try {
    // Halving the long edge each time the quality ladder runs out: quality alone
    // cannot save a photograph that is 8000 pixels wide, and resolution is the
    // thing nobody will miss.
    for (let edge = MAX_EDGE; edge >= 400; edge = Math.round(edge / 2)) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))

      const context = canvas.getContext('2d')
      if (!context) throw new ImageUnreadable()

      // Transparency would otherwise come out black once it is a JPEG.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

      for (const quality of QUALITIES) {
        const blob = await canvasToBlob(canvas, quality)
        if (blob && blob.size <= TARGET_UPLOAD_BYTES) {
          return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
            type: 'image/jpeg',
            lastModified: Date.now(),
          })
        }
      }
    }

    throw new ImageUnreadable()
  } finally {
    bitmap.close()
  }
}
