/*
 * Copyright 2008 ZXing authors
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
import QrReaderCozmoImproved from './QrReaderCozmoImproved';

/**
 * @author Sean Owen
 */
class QRCodeBlackBox1Spec extends AbstractBlackBoxSpec {

    public constructor(reader: ImageReader) {
        super('src/test/resources/blackbox/qrcode-1', reader);
        this.addTest(0, 0, 0.0);
        this.addTest(0, 0, 90.0);
        this.addTest(0, 0, 180.0);
        this.addTest(0, 0, 270.0);
    }

}

describe('QRCodeBlackBox.1 zxing', () => {
    it('testBlackBox 1 zxing', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox1Spec(new QrReaderZXing());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});

describe('QRCodeBlackBox.1 cozmo', () => {
    it('testBlackBox 1 cozmo', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox1Spec(new QrReaderCozmo());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});

describe('QRCodeBlackBox.1 cozmo improved', () => {
    it('testBlackBox 1 cozmo improved', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox1Spec(new QrReaderCozmoImproved());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});

describe('QRCodeBlackBox.1 lazlo', () => {
    it('testBlackBox 1 lazlo', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox1Spec(new QrReaderLazlo());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});
