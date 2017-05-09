/*
 * Copyright 2009 ZXing authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License")
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*package com.google.zxing.qrcode;*/

import AbstractBlackBoxSpec from '../common/AbstractBlackBox';
import ImageReader from '../common/ImageReader';
import QrReaderZXing from './QrReaderZXing';
import QrReaderCozmo from './QrReaderCozmo';
import QrReaderLazlo from './QrReaderLazlo';

/**
 * These tests are supplied by Tim Gernat and test finder pattern detection at small size and under
 * rotation, which was a weak spot.
 */
export default class QRCodeBlackBox6Spec extends AbstractBlackBoxSpec {

    public constructor(reader: ImageReader) {
        super('src/test/resources/blackbox/qrcode-6', reader);
        this.addTest(0, 0, 0.0);
        this.addTest(0, 0, 90.0);
        this.addTest(0, 0, 180.0);
        this.addTest(0, 0, 270.0);
    }

}

describe('QRCodeBlackBox.6 zxing', () => {
    it('testBlackBox 6 zxing', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox6Spec(new QrReaderZXing());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});

describe('QRCodeBlackBox.6 cozmo', () => {
    it('testBlackBox 6 cozmo', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox6Spec(new QrReaderCozmo());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});

describe('QRCodeBlackBox.6 lazlo', () => {
    it('testBlackBox 6 lazlo', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox6Spec(new QrReaderLazlo());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});
