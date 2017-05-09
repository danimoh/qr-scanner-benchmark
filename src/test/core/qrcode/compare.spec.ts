import AbstractBlackBoxSpec from '../common/AbstractBlackBox';
import QrReaderZXing from './QrReaderZXing';
import SharpImage from '../util/SharpImage';

import * as assert from 'assert';
import RGBLuminanceSource from '../../../core/RGBLuminanceSource';
import SharpImageLuminanceSource from '../SharpImageLuminanceSource';

describe('Test Suite changes', () => {
    it('can correctly read images into luma values', async () => {
        const filename = 'src/test/resources/blackbox/qrcode-1/1.png';

        const { buffer: rgba, width, height } = await AbstractBlackBoxSpec.loadRgbaImage(filename, 0);
        const luma1 = await QrReaderZXing.toLuminance(rgba, width, height);

        const sharpImage = await SharpImage.loadWithRotation(filename, 0);
        const luma2 = sharpImage.buffer;

        assert.strictEqual(luma1.length, luma2.length);
        assert.deepStrictEqual(luma1, luma2);

        const luminanceSource1 = new RGBLuminanceSource(luma1, width, height);
        const luminanceSource2 = new SharpImageLuminanceSource(sharpImage);

        const row1 = new Uint8ClampedArray(width),
            row2 = new Uint8ClampedArray(width);
        for (let y = 0; y < height; ++y) {
            luminanceSource1.getRow(y, row1);
            luminanceSource2.getRow(y, row2);

            for (let x = 0; x < width; ++x) {
                assert.strictEqual(row1[x], row2[x]);
            }
        }
    });
});
