import ImageReader from '../common/ImageReader';
import QRCodeReader from '../../../core/qrcode/QRCodeReader';
import LuminanceSource from '../../../core/LuminanceSource';
import BinaryBitmap from '../../../core/BinaryBitmap';
import HybridBinarizer from '../../../core/common/HybridBinarizer';
import RGBLuminanceSource from '../../../core/RGBLuminanceSource';
import Result from '../../../core/Result';

export default class QrReaderZXing implements ImageReader {

    private qrReader = new QRCodeReader();

    public decode(rgbaImage: Uint8ClampedArray, width, height, hints?): string {
        const luminance = QrReaderZXing.toLuminance(rgbaImage, width, height);
        const source: LuminanceSource = new RGBLuminanceSource(luminance, width, height);
        const bitmap = new BinaryBitmap(new HybridBinarizer(source));
        const result: Result = this.qrReader.decode(bitmap, hints);
        return result.getText();
    }

    // taken from HTMLCanvasElementLuminanceSource
    public static toLuminance(rgbaImage: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
        const grayscaleBuffer = new Uint8ClampedArray(width * height);
        for (let i = 0, j = 0, length = rgbaImage.length; i < length; i += 4, j++) {
            let gray;
            const alpha = rgbaImage[i + 3];
            // The color of fully-transparent pixels is irrelevant. They are often, technically, fully-transparent
            // black (0 alpha, and then 0 RGB). They are often used, of course as the "white" area in a
            // barcode image. Force any such pixel to be white:
            if (alpha === 0) {
                gray = 0xFF;
            } else {
                const pixelR = rgbaImage[i];
                const pixelG = rgbaImage[i + 1];
                const pixelB = rgbaImage[i + 2];
                // .299R + 0.587G + 0.114B (YUV/YIQ for PAL and NTSC),
                // (306*R) >> 10 is approximately equal to R*0.299, and so on.
                // 0x200 >> 10 is 0.5, it implements rounding.
                gray = (306 * pixelR +
                    601 * pixelG +
                    117 * pixelB +
                    0x200) >> 10;
            }
            grayscaleBuffer[j] = gray;
        }
        return grayscaleBuffer;
    }
}
