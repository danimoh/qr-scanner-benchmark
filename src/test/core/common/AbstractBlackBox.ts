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

/*package com.google.zxing.common;*/

import * as assert from 'assert';
import DecodeHintType from '../../../core/DecodeHintType';
import ImageReader from './ImageReader';
import TestResult from '../common/TestResult';
import StringEncoding from '../../../core/util/StringEncoding';

import * as fs from 'fs';
import * as path from 'path';
import sharp = require('sharp');

/*import javax.imageio.ImageIO;*/
/*import java.awt.Graphics;*/
/*import java.awt.geom.AffineTransform;*/
/*import java.awt.geom.RectangularShape;*/
/*import java.awt.image.AffineTransformOp;*/
/*import java.awt.image.BufferedImage;*/
/*import java.awt.image.BufferedImageOp;*/
/*import java.io.BufferedReader;*/
/*import java.io.IOException;*/
/*import java.nio.charset.Charset;*/
/*import java.nio.charset.StandardCharsets;*/
/*import java.nio.file.DirectoryStream;*/
/*import java.nio.file.Files;*/
/*import java.nio.file.Path;*/
/*import java.nio.file.Paths;*/
/*import java.util.ArrayList;*/
/*import java.util.EnumMap;*/
/*import java.util.List;*/
/*import java.util.Map;*/
/*import java.util.Properties;*/
/*import java.util.logging.Logger;*/

/**
 * @author Sean Owen
 * @author dswitkin@google.com (Daniel Switkin)
 */
abstract class AbstractBlackBoxSpec {

    private testBase: string;
    private testResults: Array<TestResult>;

    public static buildTestBase(testBasePathSuffix: string): string {
        let testBase = path.resolve(testBasePathSuffix);
        // TYPESCRIPTPORT: not applicable
        // if (!fs.existsSync(testBase)) {
        //   // try starting with 'core' since the test base is often given as the project root
        //   testBase = path.resolve("core", testBasePathSuffix)
        // }
        return testBase;
    }

    protected constructor(
        testBasePathSuffix: string,
        private imageReader: ImageReader,
    ) {
        this.testBase = AbstractBlackBoxSpec.buildTestBase(testBasePathSuffix);
        this.testResults = new Array<TestResult>();
    }

    protected getTestBase(): string {
        return this.testBase;
    }

    protected addTest(
        mustPassCount: number /* int */,
        tryHarderCount: number /* int */,
        rotation: number /* float */
    ): void {
        this.addTestWithMax(mustPassCount, tryHarderCount, 0, 0, rotation);
    }
    /**
     * Adds a new test for the current directory of images.
     *
     * @param mustPassCount The number of images which must decode for the test to pass.
     * @param tryHarderCount The number of images which must pass using the try harder flag.
     * @param maxMisreads Maximum number of images which can fail due to successfully reading the wrong contents
     * @param maxTryHarderMisreads Maximum number of images which can fail due to successfully
     *                             reading the wrong contents using the try harder flag
     * @param rotation The rotation in degrees clockwise to use for this test.
     */
    protected addTestWithMax(
        mustPassCount: number /* int */,
        tryHarderCount: number /* int */,
        maxMisreads: number /* int */ = 0,
        maxTryHarderMisreads: number /* int */ = 0,
        rotation: number/* float */
    ): void {
        this.testResults.push(new TestResult(mustPassCount, tryHarderCount, maxMisreads, maxTryHarderMisreads, rotation));
    }

    private walkDirectory(dirPath: string) {
        let results = new Array<string>();
        const dir = path.resolve(this.testBase, dirPath);
        const list = fs.readdirSync(dir);
        for (let file of list) {
            file = path.join(dir, file);
            const stat = fs.statSync(file);
            if (stat && stat.isDirectory()) {
                results = results.concat(this.walkDirectory(file));
            } else {
                if (['.jpg', '.jpeg', '.gif', '.png'].indexOf(path.extname(file)) !== -1) {
                    results.push(file);
                }
            }
        }

        if (results.length === 0) {
            console.log(`No files in folder ${dir}`);
        }

        return results;
    }

    /**
     * @throws IOException
     */
    protected getImageFiles(): Array<string> {
        assert.strictEqual(fs.existsSync(this.testBase), true, 'Please download and install test images, and run from the \'core\' directory');
        return this.walkDirectory(this.testBase);
    }

    protected getReader(): ImageReader {
        return this.imageReader;
    }

    /**
     * This workaround is used because AbstractNegativeBlackBoxTestCase
     * overrides this method but does not return SummaryResults.
     *
     * @param done
     *
     * @throws IOException
     */
    public testBlackBox(done: (err: any) => any): void {
        this.testBlackBoxCountingResults(true, done)
            .then(() => console.log('testBlackBox finished.'))
            .catch ((e) => {
                console.log('Test ended with error: ', e);
                done(e);
            });
    }

    /**
     * @throws IOException
     */
    private async testBlackBoxCountingResults(assertOnFailure: boolean, done: (err?: any) => any): Promise<void> {
        assert.strictEqual(this.testResults.length > 0, true);

        const imageFiles: Array<string> = this.getImageFiles();
        const testCount: number /*int*/ = this.testResults.length;

        const passedCounts = new Int32Array(testCount);
        const misreadCounts = new Int32Array(testCount);
        const tryHarderCounts = new Int32Array(testCount);
        const tryHarderMisreadCounts = new Int32Array(testCount);

        const alsoTryWithoutHard = false;

        for (const testImage of imageFiles) {

            // console.log(`    Starting ${testImage}`);
            const fileBaseName: string = path.basename(testImage, path.extname(testImage));
            let expectedTextFile: string = path.resolve(this.testBase, fileBaseName + '.txt');
            let expectedText: string;
            // Next line can be found in line 155 of the original file.
            if (fs.existsSync(expectedTextFile)) {
                expectedText = AbstractBlackBoxSpec.readTextFileAsString(expectedTextFile);
            } else {
                expectedTextFile = path.resolve(fileBaseName + '.bin');
                assert.strictEqual(fs.existsSync(expectedTextFile), true, 'result bin/text file should exists');
                expectedText = AbstractBlackBoxSpec.readBinFileAsString(expectedTextFile);
            }

            for (let x: number /*int*/ = 0; x < testCount; x++) {
                const rotation: number /*float*/ = this.testResults[x].getRotation();
                const { buffer: rgbaImage, width, height }  = await AbstractBlackBoxSpec.loadRgbaImage(testImage, rotation);
                if (alsoTryWithoutHard) {
                    try {
                        // creating a copy of rgbaImage to avoid side effects between tests
                        if (this.decode(new Uint8ClampedArray(rgbaImage), width, height, rotation, expectedText, false)) {
                            passedCounts[x]++;
                        } else {
                            misreadCounts[x]++;
                        }
                    } catch (e) {
                        // console.log(`could not read at rotation ${rotation} failed with ${e.constructor.name}. Message: ${e.message}`);
                    }
                }
                try {
                    // using a copy of the image here to avoid side effects of previous test
                    if (this.decode(rgbaImage, width, height, rotation, expectedText, true)) {
                        tryHarderCounts[x]++;
                    } else {
                        tryHarderMisreadCounts[x]++;
                    }
                } catch (e) {
                    // console.log(`could not read at rotation ${rotation} w/TH failed with ${e.constructor.name}.`);
                }
            }
        }

        // Original reference: 197.
        // Print the results of all tests first
        let totalFound /*int*/ = 0;
        let totalMustPass /*int*/ = 0;
        let totalMisread /*int*/ = 0;
        let totalMaxMisread /*int*/ = 0;

        for (let x: number /*int*/ = 0, length = this.testResults.length; x < length; x++) {
            const testResult: TestResult = this.testResults[x];
            console.log(`\n      Rotation ${testResult.getRotation()} degrees:`);
            let failed: number /*int*/;
            if (alsoTryWithoutHard) {
                console.log(`        ${passedCounts[x]} of ${imageFiles.length} images passed (${testResult.getMustPassCount()} required)`);
                failed = imageFiles.length - passedCounts[x];
                console.log(`        ${misreadCounts[x]} failed due to misreads, ${failed - misreadCounts[x]} not detected`);
            }
            console.log(`        ${tryHarderCounts[x]} of ${imageFiles.length} images passed with try harder (${testResult.getTryHarderCount()} required)`);
            failed = imageFiles.length - tryHarderCounts[x];
            console.log(`        ${tryHarderMisreadCounts[x]} failed due to misreads, ${failed - tryHarderMisreadCounts[x]} not detected`);
            totalFound += passedCounts[x] + tryHarderCounts[x];
            totalMustPass += testResult.getMustPassCount() + testResult.getTryHarderCount();
            totalMisread += misreadCounts[x] + tryHarderMisreadCounts[x];
            totalMaxMisread += testResult.getMaxMisreads() + testResult.getMaxTryHarderMisreads();
        }

        const totalTests: number /*int*/ = imageFiles.length * testCount
            * (alsoTryWithoutHard ? 2 : 1);

        console.log(`    Decoded ${totalFound} images out of ${totalTests} (${totalFound * 100 / totalTests}%, ${totalMustPass} required)`);

        if (totalFound > totalMustPass) {
            console.warn(`  +++ Test too lax by ${totalFound - totalMustPass} images`);
        } else if (totalFound < totalMustPass) {
            console.error(`  --- Test failed by ${totalMustPass - totalFound} images`);
        }

        if (totalMisread < totalMaxMisread) {
            console.warn(`  +++ Test expects too many misreads by ${totalMaxMisread - totalMisread} images`);
        } else if (totalMisread > totalMaxMisread) {
            console.error(`  --- Test had too many misreads by ${totalMisread - totalMaxMisread} images`);
        }

        // Then run through again and assert if any failed.
        if (assertOnFailure) {
            for (let x: number /*int*/ = 0; x < testCount; x++) {

                const testResult = this.testResults[x];
                const label = '      Rotation ' + testResult.getRotation() + ' degrees: Too many images failed.';

                assert.strictEqual(passedCounts[x] >= testResult.getMustPassCount(), true, label);
                assert.strictEqual(tryHarderCounts[x] >= testResult.getTryHarderCount(), true, `Try harder, ${label}`);
                assert.strictEqual(misreadCounts[x] <= testResult.getMaxMisreads(), true, label);
                assert.strictEqual(tryHarderMisreadCounts[x] <= testResult.getMaxTryHarderMisreads(), true, `Try harder, ${label}`);
            }
        }

        done();
    }

    /**
     * @throws ReaderException
     */
    private decode(
        rgbaImage: Uint8ClampedArray,
        width: number,
        height: number,
        rotation: number/*float*/,
        expectedText: string,
        tryHarder: boolean
    ): boolean {
        const suffix: string = ` (${tryHarder ? 'try harder, ' : ''}rotation: ${rotation})`;

        const hints = new Map<DecodeHintType, any>();
        if (tryHarder) {
            hints.set(DecodeHintType.TRY_HARDER, true);
        }

        // Don't run pure mode, as it is not our use case
        // Try in 'pure' mode mostly to exercise PURE_BARCODE code paths for exceptions;
        // not expected to pass, generally
        let resultText: string | null = null;
        // try {
        //     const pureHints = new Map<DecodeHintType, any>(hints);
        //     pureHints.set(DecodeHintType.PURE_BARCODE, true);
        //     resultText = this.imageReader.decode(rgbaImage, width, height, pureHints);
        // } catch (re/*ReaderException*/) {
        //     // continue
        // }

        if (resultText === null) {
            resultText = this.imageReader.decode(rgbaImage, width, height, hints);
        }

        // WORKAROUND: ignore new line diferences between systems
        // TODO: check if a real problem or only because test result is stored in a file with modified new line chars
        const expectedTextR = expectedText.replace(/\r\n/g, '\n');
        const resultTextR = resultText.replace(/\r\n/g, '\n');
        if (expectedTextR !== resultTextR) {
            const expectedTextHexCodes = AbstractBlackBoxSpec.toDebugHexStringCodes(expectedTextR);
            const resultTextHexCodes = AbstractBlackBoxSpec.toDebugHexStringCodes(resultTextR);
            // console.warn(`Content mismatch: expected '${expectedTextR}' (${expectedTextHexCodes}) but got '${resultTextR}'${suffix} (${resultTextHexCodes})`);
            return false;
        }

        return true;
    }

    // similar as in SharpImage.ts but without transforming to grayscale but transforming to rgba
    public static async loadRgbaImage(filepath: string, rotation: number):
        Promise<{ buffer: Uint8ClampedArray, width: number, height: number }> {
        const wrapper = sharp(filepath).raw();

        const metadata = await wrapper.metadata();

        if (metadata.channels !== 3 && metadata.space !== 'srgb') {
            // Image ${path} has ${metadata.channels} channels and will be transformed to sRGB.
            wrapper.toColorspace('sRGB');
        }

        const { data, info } = await wrapper.rotate(rotation).toBuffer({ resolveWithObject: true });
        const rgbaOrRgbaBuffer = new Uint8ClampedArray(data.buffer);
        let rgbaBuffer;

        if (info.channels === 3) {
            // convert to rgba with full alpha
            rgbaBuffer = new Uint8ClampedArray(info.width * info.height * 4);
            for (let y = 0; y < info.height; ++y) {
                for (let x = 0; x < info.width; ++x) {
                    const position = y * info.width + x;
                    const positionRGB = 3 * position;
                    const positionRGBA = 4 * position;
                    rgbaBuffer[positionRGBA] = rgbaOrRgbaBuffer[positionRGB];
                    rgbaBuffer[positionRGBA + 1] = rgbaOrRgbaBuffer[positionRGB + 1];
                    rgbaBuffer[positionRGBA + 2] = rgbaOrRgbaBuffer[positionRGB + 2];
                    rgbaBuffer[positionRGBA + 3] = 255;
                }
            }
        } else {
            rgbaBuffer = rgbaOrRgbaBuffer;
        }

        return {
            buffer: rgbaBuffer,
            width: info.width,
            height: info.height,
        };
    }

    private static toDebugHexStringCodes(text: string): string {
        let r = '';
        for (let i = 0, length = text.length; i !== length; i++) {
            if (i > 0) r += ', ';
            r += '0x' + text.charCodeAt(i).toString(16).toUpperCase();
        }
        return r;
    }

    /**
     * @throws IOException
     */
    protected static readTextFileAsString(file: string): string {
        const stringContents: string = fs.readFileSync(file, { encoding: 'utf8' });
        if (stringContents.endsWith('\n')) {
            // console.warn('contents: string of file ' + file + ' end with a newline. ' +
            //    'This may not be intended and cause a test failure');
        }
        return stringContents;
    }

    /**
     * @throws IOException
     */
    protected static readBinFileAsString(file: string): string {
        const bufferContents: Buffer = fs.readFileSync(file);
        const stringContents = StringEncoding.decode(new Uint8Array(bufferContents), 'iso-8859-1');
        if (stringContents.endsWith('\n')) {
            console.warn('contents: string of file ' + file + ' end with a newline. ' +
                'This may not be intended and cause a test failure');
        }
        return stringContents;
    }

}

export default AbstractBlackBoxSpec;
