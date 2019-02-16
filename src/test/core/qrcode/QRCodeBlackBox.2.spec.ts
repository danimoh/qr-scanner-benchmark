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
export default class QRCodeBlackBox2Spec extends AbstractBlackBoxSpec {

    public constructor(reader: ImageReader) {
        // for this set of images disabled 30.png as it was only readable in pure mode which we disabled in
        // AbstractBlackBox as it doesn't fit our use case. As we disabled one image, also mustPassCount and
        // tryHarderCount are reduced by 1
        super('src/test/resources/blackbox/qrcode-2', reader);
        this.addTest(0, 0, 0.0);
        this.addTest(0, 0, 90.0);
        this.addTest(0, 0, 180.0);
        this.addTest(0, 0, 270.0);
    }

}


describe('QRCodeBlackBox.2 zxing', () => {
    it('testBlackBox 2 zxing', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox2Spec(new QrReaderZXing());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});

describe('QRCodeBlackBox.2 cosmo', () => {
    it('testBlackBox 2 cosmo', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox2Spec(new QrReaderCozmo());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});

describe('QRCodeBlackBox.2 cozmo improved', () => {
    it('testBlackBox 2 cozmo improved', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox2Spec(new QrReaderCozmoImproved());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});

describe('QRCodeBlackBox.2 lazlo', () => {
    it('testBlackBox 2 lazlo', done => {
        let start = Date.now();
        const test = new QRCodeBlackBox2Spec(new QrReaderLazlo());
        return test.testBlackBox(() => {
            console.log(`Took ${(Date.now() - start) / 1000}s`);
            done();
        });
    });
});
