import ImageReader from '../common/ImageReader';
import jsQR from 'jsqr-es6'; // implementation with some improvements (https://github.com/danimoh/jsQR)
import NotFoundException from '../../../core/NotFoundException';

export default class QrReaderCozmoImproved implements ImageReader {

    public decode(image: Uint8ClampedArray, width: number, height: number, hints?): string {
        const result = jsQR(image, width, height, {
            // weights for quick luma integer approximation (https://en.wikipedia.org/wiki/YUV#Full_swing_for_BT.601)
            greyScaleWeights: {
                red: 77,
                green: 150,
                blue: 29,
                useIntegerApproximation: true,
            }
        });
        if (!result) throw new NotFoundException();
        return result.data;
    }

}
