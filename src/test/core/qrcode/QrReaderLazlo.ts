import ImageReader from '../common/ImageReader';
import NotFoundException from '../../../core/NotFoundException';

require('./LazloQrReaderLib.js');
// @ts-ignore
const LazloQrReaderLib = global.LazloQrReaderLib;


export default class QrReaderLazlo implements ImageReader {

    public decode(image: Uint8ClampedArray, width: number, height: number, hints?): string {
        const result = LazloQrReaderLib.decode({
            data: image,
            width,
            height
        });
        if (!result) throw new NotFoundException();
        return result;
    }

}
