// similar to Reader.ts

export default ImageReader;

interface ImageReader {

    decode(image: Uint8ClampedArray, width: number, height: number, hints?): string;

}
