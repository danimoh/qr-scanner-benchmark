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
import QrReaderCozmoImproved from './QrReaderCozmoImproved';

/**
 * Some very difficult exposure conditions including self-shadowing, which happens a lot when
 * pointing down at a barcode (i.e. the phone's shadow falls across part of the image).
 * The global histogram gets about 5/15, where the local one gets 15/15.
 *
 * @author dswitkin@google.com (Daniel Switkin)
 */
export default class QRCodeBlackBox5Spec extends AbstractBlackBoxSpec {

    public constructor(reader: ImageReader) {
        super('src/test/resources/blackbox/qrcode-5', reader);
        this.addTest(0, 0, 0.0);
        this.addTest(0, 0, 90.0);
        this.addTest(0, 0, 180.0);
        this.addTest(0, 0, 270.0);
    }

}

describe('QRCodeBlackBox.5 zxing', () => {
    it('testBlackBox 5 zxing', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox5Spec(new QrReaderZXing());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});

describe('QRCodeBlackBox.5 cozmo', () => {
    it('testBlackBox 5 cozmo', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox5Spec(new QrReaderCozmo());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});

describe('QRCodeBlackBox.5 cozmo improved', () => {
    it('testBlackBox 5 cozmo improved', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox5Spec(new QrReaderCozmoImproved());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});

describe('QRCodeBlackBox.5 lazlo', () => {
    it('testBlackBox 5 lazlo', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox5Spec(new QrReaderLazlo());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});
