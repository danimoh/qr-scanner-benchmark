import ImageReader from '../common/ImageReader';
import jsQR from 'jsqr';
import NotFoundException from '../../../core/NotFoundException';

export default class QrReaderCozmo implements ImageReader {

    public decode(image: Uint8ClampedArray, width: number, height: number, hints?): string {
        const result = jsQR(image, width, height);
        if (!result) throw new NotFoundException();
        return result.data;
    }

}
