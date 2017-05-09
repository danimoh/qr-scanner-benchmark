
// Implementation taken from https://github.com/nimiq-design/nimiqode and follows the idea of
// https://github.com/zxing/zxing/blob/master/core/src/main/java/com/google/zxing/common/HybridBinarizer.java


class Binarizer {
    static calculateRequiredBufferSize(imageWidth, imageHeight) {
        // memory for threshold for every block
        const [, blockCountX, blockCountY] = Binarizer._calculateBlockSize(imageWidth, imageHeight);
        return blockCountX * blockCountY;
    }

    static _calculateBlockSize(imageWidth, imageHeight) {
        const blockSize = Math.max(
            Math.floor(Math.min(imageWidth, imageHeight) / Binarizer.TARGET_BLOCK_COUNT_ALONG_SHORTER_SIDE),
            Binarizer.MIN_BLOCK_SIZE
        );

        const blockCountX = Math.ceil(imageWidth / blockSize);
        const blockCountY = Math.ceil(imageHeight / blockSize);
        return [blockSize, blockCountX, blockCountY];
    }

    static binarize(inputGrayscale, imageWidth, imageHeight, outputBinary = inputGrayscale, buffer = null) {
        const [blockSize, blockCountX, blockCountY] =
            Binarizer._calculateBlockSize(imageWidth, imageHeight);
        let blockThresholds;
        if (buffer) {
            if (!(buffer instanceof Uint8ClampedArray) || buffer.byteLength !== blockCountX * blockCountY) {
                throw new Error('QR Error: Illegal Buffer.');
            }
            blockThresholds = buffer;
        } else {
            blockThresholds = new Uint8ClampedArray(blockCountX * blockCountY);
        }
        // calculate the thresholds for the blocks
        for (let blockIndexY=0; blockIndexY < blockCountY; ++blockIndexY) {
            for (let blockIndexX=0; blockIndexX < blockCountX; ++blockIndexX) {
                const threshold = Binarizer._calculateBlockThreshold(inputGrayscale, imageWidth, imageHeight,
                    blockIndexX, blockIndexY, blockCountX, blockSize, blockThresholds);
                blockThresholds[blockIndexY * blockCountX + blockIndexX] = threshold;
            }
        }
        for (let blockIndexY=0; blockIndexY < blockCountY; ++blockIndexY) {
            for (let blockIndexX=0; blockIndexX < blockCountX; ++blockIndexX) {
                // calculate the average threshold over a 5x5 grid to essentially make the area bigger and increase
                // the chance that we have a bright and dark pixel in the area for good threshold computation. By
                // keeping the real block size small we ensure a good local threshold estimate (the step size in x and
                // y direction is essentially smaller).
                //
                // Instead of (min+max)/2 like in _calculateBlockThreshold, here we use a real average to be more prune
                // against outliers. E.g. imagine whats behind the scanned screen is really dark, the screen (including
                // dark pixels on the screen) rather bright. In this case, we want the threshold on the screen to be
                // rather bright and therefore not to factor in the background too much.
                let sum = 0;
                for (let i = -2; i<=2; ++i) {
                    for (let j = -2; j<=2; ++j) {
                        const neighborIndexX = Math.max(0, Math.min(blockCountX-1, blockIndexX+i));
                        const neighborIndexY = Math.max(0, Math.min(blockCountY-1, blockIndexY+j));
                        sum += blockThresholds[neighborIndexY * blockCountX + neighborIndexX];
                    }
                }
                Binarizer._applyThresholdToBlock(inputGrayscale, imageWidth, imageHeight, blockIndexX, blockIndexY,
                    blockSize, sum / 25, outputBinary);
            }
        }
    }

    static _calculateBlockThreshold(inputGrayscale, imageWidth, imageHeight, blockIndexX, blockIndexY, blockCountX, blockSize,
                                    blockThresholds) {
        let min = 0xFF, max = 0;
        const left = Math.min(blockIndexX * blockSize, imageWidth - blockSize);
        const top = Math.min(blockIndexY * blockSize, imageHeight - blockSize);
        let rowStart = top * imageWidth + left;
        for (let y=0; y<blockSize; ++y) {
            for (let x=0; x<blockSize; ++x) {
                const pixel = inputGrayscale[rowStart + x];
                if (pixel < min) {
                    min = pixel;
                }
                if (pixel > max) {
                    max = pixel;
                }
            }
            rowStart += imageWidth;
        }
        // Small bias towards black by moving the threshold up. We do this, as in the finder patterns white holes tend
        // to appear which makes them undetectable.
        const blackBias = 1.1;
        if (max - min > Binarizer.MIN_DYNAMIC_RANGE) {
            // The values span a minimum dynamic range, so we can assume we have bright and dark pixels. Return the
            // average of min and max as threshold. We could also compute the real average of all pixel but following
            // the assumption that the nimiqode consists of bright and dark pixels and essentially not much in between
            // then by (min + max)/2 we make the cut really between those two classes. If using the average over all
            // pixel then in a block of mostly bright pixels and few dark pixels, the avg would tend to the bright side
            // and darker bright pixels could be interpreted as dark.
            const threshold = (min + max) / 2;
            const maxBias = (min + max) / 4;
            return Math.min(255, threshold + maxBias, threshold * blackBias);
        } else {
            // We have a low dynamic range and assume the block is of solid bright or dark color.
            // TODO this zxing implementation is somewhat weird. Think of a better threshold propagation strategy.
            // Ideas:
            // - start the propagation in the middle of the screen following the assumption that the nimiqode / screen
            //   is centered in the image. By this, we avoid propagation of thresholds from the surrounding to the
            //   screen which hold the only interesting information to us.
            // - Combine the threshold propagation with edge detection
            // - When propagating a threshold adapt it by comparing the average brightness in my block to the average
            //   brightness in block we are propagating from
            if (blockIndexX === 0 || blockIndexY === 0) {
                // cant compare to the neighbours. Assume it's a light background
                return min - 1;
            } else {
                const myIndex = blockIndexY * blockCountX + blockIndexX;
                const leftBlockThreshold = blockThresholds[myIndex - 1];
                const topBlockThreshold = blockThresholds[myIndex - blockCountX];
                const topLeftBlockThreshold = blockCountX[myIndex - blockCountX - 1];
                const neighbourAverage = (leftBlockThreshold + topBlockThreshold + topLeftBlockThreshold) / 3;
                if (neighbourAverage > min) {
                    return neighbourAverage; // no need to apply black bias as it was already applied to neighbors
                } else {
                    // the block is brighter than its neighbors and we assume it to be white
                    return min - 1;
                }
            }
        }
    }


    static _applyThresholdToBlock(inputGrayscale, imageWidth, imageHeight, blockIndexX, blockIndexY, blockSize, threshold,
                                  outputBinary = inputGrayscale) {
        const left = Math.min(blockIndexX * blockSize, imageWidth - blockSize);
        const top = Math.min(blockIndexY * blockSize, imageHeight - blockSize);
        let rowStart = top * imageWidth + left;
        for (let y=0; y<blockSize; ++y) {
            for (let x=0; x<blockSize; ++x) {
                const index = rowStart + x;
                outputBinary[index] = inputGrayscale[index] <= threshold;
            }
            rowStart += imageWidth;
        }
    }
}
Binarizer.TARGET_BLOCK_COUNT_ALONG_SHORTER_SIDE = 40;
Binarizer.MIN_BLOCK_SIZE = 16;
Binarizer.MIN_DYNAMIC_RANGE = 12; // if the dynamic range in a block is below this value it's assumed to be single color
/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


var GridSampler = {};

GridSampler.checkAndNudgePoints=function( image,  points)
{
    var width = qrcode.width;
    var height = qrcode.height;
    // Check and nudge points from start until we see some that are OK:
    var nudged = true;
    for (var offset = 0; offset < points.length && nudged; offset += 2)
    {
        var x = Math.floor (points[offset]);
        var y = Math.floor( points[offset + 1]);
        if (x < - 1 || x > width || y < - 1 || y > height)
        {
            throw new Error("QR Error: Error.checkAndNudgePoints");
        }
        nudged = false;
        if (x == - 1)
        {
            points[offset] = 0.0;
            nudged = true;
        }
        else if (x == width)
        {
            points[offset] = width - 1;
            nudged = true;
        }
        if (y == - 1)
        {
            points[offset + 1] = 0.0;
            nudged = true;
        }
        else if (y == height)
        {
            points[offset + 1] = height - 1;
            nudged = true;
        }
    }
    // Check and nudge points from end:
    nudged = true;
    for (var offset = points.length - 2; offset >= 0 && nudged; offset -= 2)
    {
        var x = Math.floor( points[offset]);
        var y = Math.floor( points[offset + 1]);
        if (x < - 1 || x > width || y < - 1 || y > height)
        {
            throw new Error("QR Error: Error.checkAndNudgePoints");
        }
        nudged = false;
        if (x == - 1)
        {
            points[offset] = 0.0;
            nudged = true;
        }
        else if (x == width)
        {
            points[offset] = width - 1;
            nudged = true;
        }
        if (y == - 1)
        {
            points[offset + 1] = 0.0;
            nudged = true;
        }
        else if (y == height)
        {
            points[offset + 1] = height - 1;
            nudged = true;
        }
    }
}



GridSampler.sampleGrid3=function( image,  dimension,  transform)
{
    var bits = new BitMatrix(dimension);
    var points = new Array(dimension << 1);
    for (var y = 0; y < dimension; y++)
    {
        var max = points.length;
        var iValue =  y + 0.5;
        for (var x = 0; x < max; x += 2)
        {
            points[x] =  (x >> 1) + 0.5;
            points[x + 1] = iValue;
        }
        transform.transformPoints1(points);
        // Quick check to see if points transformed to something inside the image;
        // sufficient to check the endpoints
        GridSampler.checkAndNudgePoints(image, points);
        try
        {
            for (var x = 0; x < max; x += 2)
            {
                //var xpoint = (Math.floor( points[x]) * 4) + (Math.floor( points[x + 1]) * qrcode.width * 4);
                var bit = image[Math.floor( points[x])+ qrcode.width* Math.floor( points[x + 1])];
                //qrcode.imagedata.data[xpoint] = bit?255:0;
                //qrcode.imagedata.data[xpoint+1] = bit?255:0;
                //qrcode.imagedata.data[xpoint+2] = 0;
                //qrcode.imagedata.data[xpoint+3] = 255;
                //bits[x >> 1][ y]=bit;
                if(bit)
                    bits.set_Renamed(x >> 1, y);
            }
        }
        catch ( aioobe)
        {
            // This feels wrong, but, sometimes if the finder patterns are misidentified, the resulting
            // transform gets "twisted" such that it maps a straight line of points to a set of points
            // whose endpoints are in bounds, but others are not. There is probably some mathematical
            // way to detect this about the transformation that I don't know yet.
            // This results in an ugly runtime exception despite our clever checks above -- can't have
            // that. We could check each point's coordinates but that feels duplicative. We settle for
            // catching and wrapping ArrayIndexOutOfBoundsException.
            throw new Error("QR Error: Error.checkAndNudgePoints");
        }
    }
    return bits;
}

GridSampler.sampleGridx=function( image,  dimension,  p1ToX,  p1ToY,  p2ToX,  p2ToY,  p3ToX,  p3ToY,  p4ToX,  p4ToY,  p1FromX,  p1FromY,  p2FromX,  p2FromY,  p3FromX,  p3FromY,  p4FromX,  p4FromY)
{
    var transform = PerspectiveTransform.quadrilateralToQuadrilateral(p1ToX, p1ToY, p2ToX, p2ToY, p3ToX, p3ToY, p4ToX, p4ToY, p1FromX, p1FromY, p2FromX, p2FromY, p3FromX, p3FromY, p4FromX, p4FromY);

    return GridSampler.sampleGrid3(image, dimension, transform);
}
/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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



function ECB(count,  dataCodewords)
{
    this.count = count;
    this.dataCodewords = dataCodewords;

    this.getCount = function()
    {
        return this.count;
    };
    this.getDataCodewords = function()
    {
        return this.dataCodewords;
    };
}

function ECBlocks( ecCodewordsPerBlock,  ecBlocks1,  ecBlocks2)
{
    this.ecCodewordsPerBlock = ecCodewordsPerBlock;
    if(ecBlocks2)
        this.ecBlocks = new Array(ecBlocks1, ecBlocks2);
    else
        this.ecBlocks = new Array(ecBlocks1);

    this.getECCodewordsPerBlock = function()
    {
        return this.ecCodewordsPerBlock;
    };

    this.getTotalECCodewords = function()
    {
        return  this.ecCodewordsPerBlock * this.getNumBlocks();
    };

    this.getNumBlocks = function()
    {
        var total = 0;
        for (var i = 0; i < this.ecBlocks.length; i++)
        {
            total += this.ecBlocks[i].length;
        }
        return total;
    };

    this.getECBlocks=function()
    {
        return this.ecBlocks;
    }
}

function Version( versionNumber,  alignmentPatternCenters,  ecBlocks1,  ecBlocks2,  ecBlocks3,  ecBlocks4)
{
    this.versionNumber = versionNumber;
    this.alignmentPatternCenters = alignmentPatternCenters;
    this.ecBlocks = new Array(ecBlocks1, ecBlocks2, ecBlocks3, ecBlocks4);

    var total = 0;
    var ecCodewords = ecBlocks1.getECCodewordsPerBlock();
    var ecbArray = ecBlocks1.getECBlocks();
    for (var i = 0; i < ecbArray.length; i++)
    {
        var ecBlock = ecbArray[i];
        total += ecBlock.getCount() * (ecBlock.getDataCodewords() + ecCodewords);
    }
    this.totalCodewords = total;

    this.getVersionNumber = function()
    {
        return  this.versionNumber;
    };

    this.getAlignmentPatternCenters = function()
    {
        return  this.alignmentPatternCenters;
    };
    this.getTotalCodewords = function()
    {
        return  this.totalCodewords;
    };
    this.getDimensionForVersion = function()
    {
        return  17 + 4 * this.versionNumber;
    };

    this.buildFunctionPattern=function()
    {
        var dimension = this.getDimensionForVersion();
        var bitMatrix = new BitMatrix(dimension);

        // Top left finder pattern + separator + format
        bitMatrix.setRegion(0, 0, 9, 9);
        // Top right finder pattern + separator + format
        bitMatrix.setRegion(dimension - 8, 0, 8, 9);
        // Bottom left finder pattern + separator + format
        bitMatrix.setRegion(0, dimension - 8, 9, 8);

        // Alignment patterns
        var max = this.alignmentPatternCenters.length;
        for (var x = 0; x < max; x++)
        {
            var i = this.alignmentPatternCenters[x] - 2;
            for (var y = 0; y < max; y++)
            {
                if ((x == 0 && (y == 0 || y == max - 1)) || (x == max - 1 && y == 0))
                {
                    // No alignment patterns near the three finder paterns
                    continue;
                }
                bitMatrix.setRegion(this.alignmentPatternCenters[y] - 2, i, 5, 5);
            }
        }

        // Vertical timing pattern
        bitMatrix.setRegion(6, 9, 1, dimension - 17);
        // Horizontal timing pattern
        bitMatrix.setRegion(9, 6, dimension - 17, 1);

        if (this.versionNumber > 6)
        {
            // Version info, top right
            bitMatrix.setRegion(dimension - 11, 0, 3, 6);
            // Version info, bottom left
            bitMatrix.setRegion(0, dimension - 11, 6, 3);
        }

        return bitMatrix;
    }
    this.getECBlocksForLevel=function( ecLevel)
    {
        return this.ecBlocks[ecLevel.ordinal()];
    }
}

Version.VERSION_DECODE_INFO = new Array(0x07C94, 0x085BC, 0x09A99, 0x0A4D3, 0x0BBF6, 0x0C762, 0x0D847, 0x0E60D, 0x0F928, 0x10B78, 0x1145D, 0x12A17, 0x13532, 0x149A6, 0x15683, 0x168C9, 0x177EC, 0x18EC4, 0x191E1, 0x1AFAB, 0x1B08E, 0x1CC1A, 0x1D33F, 0x1ED75, 0x1F250, 0x209D5, 0x216F0, 0x228BA, 0x2379F, 0x24B0B, 0x2542E, 0x26A64, 0x27541, 0x28C69);

Version.VERSIONS = buildVersions();

Version.getVersionForNumber=function( versionNumber)
{
    if (versionNumber < 1 || versionNumber > 40)
    {
        throw new Error("QR Error: ArgumentException");
    }
    return Version.VERSIONS[versionNumber - 1];
}

Version.getProvisionalVersionForDimension=function(dimension)
{
    if (dimension % 4 != 1)
    {
        throw new Error("QR Error: Error getProvisionalVersionForDimension");
    }
    try
    {
        return Version.getVersionForNumber((dimension - 17) >> 2);
    }
    catch ( iae)
    {
        throw new Error("QR Error: Error getVersionForNumber");
    }
}

Version.decodeVersionInformation=function( versionBits)
{
    var bestDifference = 0xffffffff;
    var bestVersion = 0;
    for (var i = 0; i < Version.VERSION_DECODE_INFO.length; i++)
    {
        var targetVersion = Version.VERSION_DECODE_INFO[i];
        // Do the version info bits match exactly? done.
        if (targetVersion == versionBits)
        {
            return Version.getVersionForNumber(i + 7);
        }
        // Otherwise see if this is the closest to a real version info bit string
        // we have seen so far
        var bitsDifference = FormatInformation.numBitsDiffering(versionBits, targetVersion);
        if (bitsDifference < bestDifference)
        {
            bestVersion = i + 7;
            bestDifference = bitsDifference;
        }
    }
    // We can tolerate up to 3 bits of error since no two version info codewords will
    // differ in less than 4 bits.
    if (bestDifference <= 3)
    {
        return Version.getVersionForNumber(bestVersion);
    }
    // If we didn't find a close enough match, fail
    return null;
}

function buildVersions()
{
    return new Array(new Version(1, new Array(), new ECBlocks(7, new ECB(1, 19)), new ECBlocks(10, new ECB(1, 16)), new ECBlocks(13, new ECB(1, 13)), new ECBlocks(17, new ECB(1, 9))),
        new Version(2, new Array(6, 18), new ECBlocks(10, new ECB(1, 34)), new ECBlocks(16, new ECB(1, 28)), new ECBlocks(22, new ECB(1, 22)), new ECBlocks(28, new ECB(1, 16))),
        new Version(3, new Array(6, 22), new ECBlocks(15, new ECB(1, 55)), new ECBlocks(26, new ECB(1, 44)), new ECBlocks(18, new ECB(2, 17)), new ECBlocks(22, new ECB(2, 13))),
        new Version(4, new Array(6, 26), new ECBlocks(20, new ECB(1, 80)), new ECBlocks(18, new ECB(2, 32)), new ECBlocks(26, new ECB(2, 24)), new ECBlocks(16, new ECB(4, 9))),
        new Version(5, new Array(6, 30), new ECBlocks(26, new ECB(1, 108)), new ECBlocks(24, new ECB(2, 43)), new ECBlocks(18, new ECB(2, 15), new ECB(2, 16)), new ECBlocks(22, new ECB(2, 11), new ECB(2, 12))),
        new Version(6, new Array(6, 34), new ECBlocks(18, new ECB(2, 68)), new ECBlocks(16, new ECB(4, 27)), new ECBlocks(24, new ECB(4, 19)), new ECBlocks(28, new ECB(4, 15))),
        new Version(7, new Array(6, 22, 38), new ECBlocks(20, new ECB(2, 78)), new ECBlocks(18, new ECB(4, 31)), new ECBlocks(18, new ECB(2, 14), new ECB(4, 15)), new ECBlocks(26, new ECB(4, 13), new ECB(1, 14))),
        new Version(8, new Array(6, 24, 42), new ECBlocks(24, new ECB(2, 97)), new ECBlocks(22, new ECB(2, 38), new ECB(2, 39)), new ECBlocks(22, new ECB(4, 18), new ECB(2, 19)), new ECBlocks(26, new ECB(4, 14), new ECB(2, 15))),
        new Version(9, new Array(6, 26, 46), new ECBlocks(30, new ECB(2, 116)), new ECBlocks(22, new ECB(3, 36), new ECB(2, 37)), new ECBlocks(20, new ECB(4, 16), new ECB(4, 17)), new ECBlocks(24, new ECB(4, 12), new ECB(4, 13))),
        new Version(10, new Array(6, 28, 50), new ECBlocks(18, new ECB(2, 68), new ECB(2, 69)), new ECBlocks(26, new ECB(4, 43), new ECB(1, 44)), new ECBlocks(24, new ECB(6, 19), new ECB(2, 20)), new ECBlocks(28, new ECB(6, 15), new ECB(2, 16))),
        new Version(11, new Array(6, 30, 54), new ECBlocks(20, new ECB(4, 81)), new ECBlocks(30, new ECB(1, 50), new ECB(4, 51)), new ECBlocks(28, new ECB(4, 22), new ECB(4, 23)), new ECBlocks(24, new ECB(3, 12), new ECB(8, 13))),
        new Version(12, new Array(6, 32, 58), new ECBlocks(24, new ECB(2, 92), new ECB(2, 93)), new ECBlocks(22, new ECB(6, 36), new ECB(2, 37)), new ECBlocks(26, new ECB(4, 20), new ECB(6, 21)), new ECBlocks(28, new ECB(7, 14), new ECB(4, 15))),
        new Version(13, new Array(6, 34, 62), new ECBlocks(26, new ECB(4, 107)), new ECBlocks(22, new ECB(8, 37), new ECB(1, 38)), new ECBlocks(24, new ECB(8, 20), new ECB(4, 21)), new ECBlocks(22, new ECB(12, 11), new ECB(4, 12))),
        new Version(14, new Array(6, 26, 46, 66), new ECBlocks(30, new ECB(3, 115), new ECB(1, 116)), new ECBlocks(24, new ECB(4, 40), new ECB(5, 41)), new ECBlocks(20, new ECB(11, 16), new ECB(5, 17)), new ECBlocks(24, new ECB(11, 12), new ECB(5, 13))),
        new Version(15, new Array(6, 26, 48, 70), new ECBlocks(22, new ECB(5, 87), new ECB(1, 88)), new ECBlocks(24, new ECB(5, 41), new ECB(5, 42)), new ECBlocks(30, new ECB(5, 24), new ECB(7, 25)), new ECBlocks(24, new ECB(11, 12), new ECB(7, 13))),
        new Version(16, new Array(6, 26, 50, 74), new ECBlocks(24, new ECB(5, 98), new ECB(1, 99)), new ECBlocks(28, new ECB(7, 45), new ECB(3, 46)), new ECBlocks(24, new ECB(15, 19), new ECB(2, 20)), new ECBlocks(30, new ECB(3, 15), new ECB(13, 16))),
        new Version(17, new Array(6, 30, 54, 78), new ECBlocks(28, new ECB(1, 107), new ECB(5, 108)), new ECBlocks(28, new ECB(10, 46), new ECB(1, 47)), new ECBlocks(28, new ECB(1, 22), new ECB(15, 23)), new ECBlocks(28, new ECB(2, 14), new ECB(17, 15))),
        new Version(18, new Array(6, 30, 56, 82), new ECBlocks(30, new ECB(5, 120), new ECB(1, 121)), new ECBlocks(26, new ECB(9, 43), new ECB(4, 44)), new ECBlocks(28, new ECB(17, 22), new ECB(1, 23)), new ECBlocks(28, new ECB(2, 14), new ECB(19, 15))),
        new Version(19, new Array(6, 30, 58, 86), new ECBlocks(28, new ECB(3, 113), new ECB(4, 114)), new ECBlocks(26, new ECB(3, 44), new ECB(11, 45)), new ECBlocks(26, new ECB(17, 21), new ECB(4, 22)), new ECBlocks(26, new ECB(9, 13), new ECB(16, 14))),
        new Version(20, new Array(6, 34, 62, 90), new ECBlocks(28, new ECB(3, 107), new ECB(5, 108)), new ECBlocks(26, new ECB(3, 41), new ECB(13, 42)), new ECBlocks(30, new ECB(15, 24), new ECB(5, 25)), new ECBlocks(28, new ECB(15, 15), new ECB(10, 16))),
        new Version(21, new Array(6, 28, 50, 72, 94), new ECBlocks(28, new ECB(4, 116), new ECB(4, 117)), new ECBlocks(26, new ECB(17, 42)), new ECBlocks(28, new ECB(17, 22), new ECB(6, 23)), new ECBlocks(30, new ECB(19, 16), new ECB(6, 17))),
        new Version(22, new Array(6, 26, 50, 74, 98), new ECBlocks(28, new ECB(2, 111), new ECB(7, 112)), new ECBlocks(28, new ECB(17, 46)), new ECBlocks(30, new ECB(7, 24), new ECB(16, 25)), new ECBlocks(24, new ECB(34, 13))),
        new Version(23, new Array(6, 30, 54, 74, 102), new ECBlocks(30, new ECB(4, 121), new ECB(5, 122)), new ECBlocks(28, new ECB(4, 47), new ECB(14, 48)), new ECBlocks(30, new ECB(11, 24), new ECB(14, 25)), new ECBlocks(30, new ECB(16, 15), new ECB(14, 16))),
        new Version(24, new Array(6, 28, 54, 80, 106), new ECBlocks(30, new ECB(6, 117), new ECB(4, 118)), new ECBlocks(28, new ECB(6, 45), new ECB(14, 46)), new ECBlocks(30, new ECB(11, 24), new ECB(16, 25)), new ECBlocks(30, new ECB(30, 16), new ECB(2, 17))),
        new Version(25, new Array(6, 32, 58, 84, 110), new ECBlocks(26, new ECB(8, 106), new ECB(4, 107)), new ECBlocks(28, new ECB(8, 47), new ECB(13, 48)), new ECBlocks(30, new ECB(7, 24), new ECB(22, 25)), new ECBlocks(30, new ECB(22, 15), new ECB(13, 16))),
        new Version(26, new Array(6, 30, 58, 86, 114), new ECBlocks(28, new ECB(10, 114), new ECB(2, 115)), new ECBlocks(28, new ECB(19, 46), new ECB(4, 47)), new ECBlocks(28, new ECB(28, 22), new ECB(6, 23)), new ECBlocks(30, new ECB(33, 16), new ECB(4, 17))),
        new Version(27, new Array(6, 34, 62, 90, 118), new ECBlocks(30, new ECB(8, 122), new ECB(4, 123)), new ECBlocks(28, new ECB(22, 45), new ECB(3, 46)), new ECBlocks(30, new ECB(8, 23), new ECB(26, 24)), new ECBlocks(30, new ECB(12, 15), 		new ECB(28, 16))),
        new Version(28, new Array(6, 26, 50, 74, 98, 122), new ECBlocks(30, new ECB(3, 117), new ECB(10, 118)), new ECBlocks(28, new ECB(3, 45), new ECB(23, 46)), new ECBlocks(30, new ECB(4, 24), new ECB(31, 25)), new ECBlocks(30, new ECB(11, 15), new ECB(31, 16))),
        new Version(29, new Array(6, 30, 54, 78, 102, 126), new ECBlocks(30, new ECB(7, 116), new ECB(7, 117)), new ECBlocks(28, new ECB(21, 45), new ECB(7, 46)), new ECBlocks(30, new ECB(1, 23), new ECB(37, 24)), new ECBlocks(30, new ECB(19, 15), new ECB(26, 16))),
        new Version(30, new Array(6, 26, 52, 78, 104, 130), new ECBlocks(30, new ECB(5, 115), new ECB(10, 116)), new ECBlocks(28, new ECB(19, 47), new ECB(10, 48)), new ECBlocks(30, new ECB(15, 24), new ECB(25, 25)), new ECBlocks(30, new ECB(23, 15), new ECB(25, 16))),
        new Version(31, new Array(6, 30, 56, 82, 108, 134), new ECBlocks(30, new ECB(13, 115), new ECB(3, 116)), new ECBlocks(28, new ECB(2, 46), new ECB(29, 47)), new ECBlocks(30, new ECB(42, 24), new ECB(1, 25)), new ECBlocks(30, new ECB(23, 15), new ECB(28, 16))),
        new Version(32, new Array(6, 34, 60, 86, 112, 138), new ECBlocks(30, new ECB(17, 115)), new ECBlocks(28, new ECB(10, 46), new ECB(23, 47)), new ECBlocks(30, new ECB(10, 24), new ECB(35, 25)), new ECBlocks(30, new ECB(19, 15), new ECB(35, 16))),
        new Version(33, new Array(6, 30, 58, 86, 114, 142), new ECBlocks(30, new ECB(17, 115), new ECB(1, 116)), new ECBlocks(28, new ECB(14, 46), new ECB(21, 47)), new ECBlocks(30, new ECB(29, 24), new ECB(19, 25)), new ECBlocks(30, new ECB(11, 15), new ECB(46, 16))),
        new Version(34, new Array(6, 34, 62, 90, 118, 146), new ECBlocks(30, new ECB(13, 115), new ECB(6, 116)), new ECBlocks(28, new ECB(14, 46), new ECB(23, 47)), new ECBlocks(30, new ECB(44, 24), new ECB(7, 25)), new ECBlocks(30, new ECB(59, 16), new ECB(1, 17))),
        new Version(35, new Array(6, 30, 54, 78, 102, 126, 150), new ECBlocks(30, new ECB(12, 121), new ECB(7, 122)), new ECBlocks(28, new ECB(12, 47), new ECB(26, 48)), new ECBlocks(30, new ECB(39, 24), new ECB(14, 25)),new ECBlocks(30, new ECB(22, 15), new ECB(41, 16))),
        new Version(36, new Array(6, 24, 50, 76, 102, 128, 154), new ECBlocks(30, new ECB(6, 121), new ECB(14, 122)), new ECBlocks(28, new ECB(6, 47), new ECB(34, 48)), new ECBlocks(30, new ECB(46, 24), new ECB(10, 25)), new ECBlocks(30, new ECB(2, 15), new ECB(64, 16))),
        new Version(37, new Array(6, 28, 54, 80, 106, 132, 158), new ECBlocks(30, new ECB(17, 122), new ECB(4, 123)), new ECBlocks(28, new ECB(29, 46), new ECB(14, 47)), new ECBlocks(30, new ECB(49, 24), new ECB(10, 25)), new ECBlocks(30, new ECB(24, 15), new ECB(46, 16))),
        new Version(38, new Array(6, 32, 58, 84, 110, 136, 162), new ECBlocks(30, new ECB(4, 122), new ECB(18, 123)), new ECBlocks(28, new ECB(13, 46), new ECB(32, 47)), new ECBlocks(30, new ECB(48, 24), new ECB(14, 25)), new ECBlocks(30, new ECB(42, 15), new ECB(32, 16))),
        new Version(39, new Array(6, 26, 54, 82, 110, 138, 166), new ECBlocks(30, new ECB(20, 117), new ECB(4, 118)), new ECBlocks(28, new ECB(40, 47), new ECB(7, 48)), new ECBlocks(30, new ECB(43, 24), new ECB(22, 25)), new ECBlocks(30, new ECB(10, 15), new ECB(67, 16))),
        new Version(40, new Array(6, 30, 58, 86, 114, 142, 170), new ECBlocks(30, new ECB(19, 118), new ECB(6, 119)), new ECBlocks(28, new ECB(18, 47), new ECB(31, 48)), new ECBlocks(30, new ECB(34, 24), new ECB(34, 25)), new ECBlocks(30, new ECB(20, 15), new ECB(61, 16))));
}
/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


function PerspectiveTransform( a11,  a21,  a31,  a12,  a22,  a32,  a13,  a23,  a33)
{
    this.a11 = a11;
    this.a12 = a12;
    this.a13 = a13;
    this.a21 = a21;
    this.a22 = a22;
    this.a23 = a23;
    this.a31 = a31;
    this.a32 = a32;
    this.a33 = a33;
    this.transformPoints1=function( points)
    {
        var max = points.length;
        var a11 = this.a11;
        var a12 = this.a12;
        var a13 = this.a13;
        var a21 = this.a21;
        var a22 = this.a22;
        var a23 = this.a23;
        var a31 = this.a31;
        var a32 = this.a32;
        var a33 = this.a33;
        for (var i = 0; i < max; i += 2)
        {
            var x = points[i];
            var y = points[i + 1];
            var denominator = a13 * x + a23 * y + a33;
            points[i] = (a11 * x + a21 * y + a31) / denominator;
            points[i + 1] = (a12 * x + a22 * y + a32) / denominator;
        }
    }
    this. transformPoints2=function(xValues, yValues)
    {
        var n = xValues.length;
        for (var i = 0; i < n; i++)
        {
            var x = xValues[i];
            var y = yValues[i];
            var denominator = this.a13 * x + this.a23 * y + this.a33;
            xValues[i] = (this.a11 * x + this.a21 * y + this.a31) / denominator;
            yValues[i] = (this.a12 * x + this.a22 * y + this.a32) / denominator;
        }
    }

    this.buildAdjoint=function()
    {
        // Adjoint is the transpose of the cofactor matrix:
        return new PerspectiveTransform(this.a22 * this.a33 - this.a23 * this.a32, this.a23 * this.a31 - this.a21 * this.a33, this.a21 * this.a32 - this.a22 * this.a31, this.a13 * this.a32 - this.a12 * this.a33, this.a11 * this.a33 - this.a13 * this.a31, this.a12 * this.a31 - this.a11 * this.a32, this.a12 * this.a23 - this.a13 * this.a22, this.a13 * this.a21 - this.a11 * this.a23, this.a11 * this.a22 - this.a12 * this.a21);
    }
    this.times=function( other)
    {
        return new PerspectiveTransform(this.a11 * other.a11 + this.a21 * other.a12 + this.a31 * other.a13, this.a11 * other.a21 + this.a21 * other.a22 + this.a31 * other.a23, this.a11 * other.a31 + this.a21 * other.a32 + this.a31 * other.a33, this.a12 * other.a11 + this.a22 * other.a12 + this.a32 * other.a13, this.a12 * other.a21 + this.a22 * other.a22 + this.a32 * other.a23, this.a12 * other.a31 + this.a22 * other.a32 + this.a32 * other.a33, this.a13 * other.a11 + this.a23 * other.a12 +this.a33 * other.a13, this.a13 * other.a21 + this.a23 * other.a22 + this.a33 * other.a23, this.a13 * other.a31 + this.a23 * other.a32 + this.a33 * other.a33);
    }

}

PerspectiveTransform.quadrilateralToQuadrilateral=function( x0,  y0,  x1,  y1,  x2,  y2,  x3,  y3,  x0p,  y0p,  x1p,  y1p,  x2p,  y2p,  x3p,  y3p)
{

    var qToS = PerspectiveTransform.quadrilateralToSquare(x0, y0, x1, y1, x2, y2, x3, y3);
    var sToQ = PerspectiveTransform.squareToQuadrilateral(x0p, y0p, x1p, y1p, x2p, y2p, x3p, y3p);
    return sToQ.times(qToS);
}

PerspectiveTransform.squareToQuadrilateral=function( x0,  y0,  x1,  y1,  x2,  y2,  x3,  y3)
{
    var dy2 = y3 - y2;
    var dy3 = y0 - y1 + y2 - y3;
    if (dy2 == 0.0 && dy3 == 0.0)
    {
        return new PerspectiveTransform(x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0.0, 0.0, 1.0);
    }
    else
    {
        var dx1 = x1 - x2;
        var dx2 = x3 - x2;
        var dx3 = x0 - x1 + x2 - x3;
        var dy1 = y1 - y2;
        var denominator = dx1 * dy2 - dx2 * dy1;
        var a13 = (dx3 * dy2 - dx2 * dy3) / denominator;
        var a23 = (dx1 * dy3 - dx3 * dy1) / denominator;
        return new PerspectiveTransform(x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0, y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0, a13, a23, 1.0);
    }
}

PerspectiveTransform.quadrilateralToSquare=function( x0,  y0,  x1,  y1,  x2,  y2,  x3,  y3)
{
    // Here, the adjoint serves as the inverse:
    return PerspectiveTransform.squareToQuadrilateral(x0, y0, x1, y1, x2, y2, x3, y3).buildAdjoint();
}

function DetectorResult(bits,  points)
{
    this.bits = bits;
    this.points = points;
}


function Detector(image)
{
    this.image=image;
    this.resultPointCallback = null;

    this.sizeOfBlackWhiteBlackRun=function( fromX,  fromY,  toX,  toY)
    {
        // Mild variant of Bresenham's algorithm;
        // see http://en.wikipedia.org/wiki/Bresenham's_line_algorithm
        var steep = Math.abs(toY - fromY) > Math.abs(toX - fromX);
        if (steep)
        {
            var temp = fromX;
            fromX = fromY;
            fromY = temp;
            temp = toX;
            toX = toY;
            toY = temp;
        }

        var dx = Math.abs(toX - fromX);
        var dy = Math.abs(toY - fromY);
        var error = - dx >> 1;
        var ystep = fromY < toY?1:- 1;
        var xstep = fromX < toX?1:- 1;
        var state = 0; // In black pixels, looking for white, first or second time
        for (var x = fromX, y = fromY; x != toX; x += xstep)
        {

            var realX = steep?y:x;
            var realY = steep?x:y;
            if (state == 1)
            {
                // In white pixels, looking for black
                if (this.image[realX + realY*qrcode.width])
                {
                    state++;
                }
            }
            else
            {
                if (!this.image[realX + realY*qrcode.width])
                {
                    state++;
                }
            }

            if (state == 3)
            {
                // Found black, white, black, and stumbled back onto white; done
                var diffX = x - fromX;
                var diffY = y - fromY;
                return  Math.sqrt( (diffX * diffX + diffY * diffY));
            }
            error += dy;
            if (error > 0)
            {
                if (y == toY)
                {
                    break;
                }
                y += ystep;
                error -= dx;
            }
        }
        var diffX2 = toX - fromX;
        var diffY2 = toY - fromY;
        return  Math.sqrt( (diffX2 * diffX2 + diffY2 * diffY2));
    }


    this.sizeOfBlackWhiteBlackRunBothWays=function( fromX,  fromY,  toX,  toY)
    {

        var result = this.sizeOfBlackWhiteBlackRun(fromX, fromY, toX, toY);

        // Now count other way -- don't run off image though of course
        var scale = 1.0;
        var otherToX = fromX - (toX - fromX);
        if (otherToX < 0)
        {
            scale =  fromX /  (fromX - otherToX);
            otherToX = 0;
        }
        else if (otherToX >= qrcode.width)
        {
            scale =  (qrcode.width - 1 - fromX) /  (otherToX - fromX);
            otherToX = qrcode.width - 1;
        }
        var otherToY = Math.floor (fromY - (toY - fromY) * scale);

        scale = 1.0;
        if (otherToY < 0)
        {
            scale =  fromY /  (fromY - otherToY);
            otherToY = 0;
        }
        else if (otherToY >= qrcode.height)
        {
            scale =  (qrcode.height - 1 - fromY) /  (otherToY - fromY);
            otherToY = qrcode.height - 1;
        }
        otherToX = Math.floor (fromX + (otherToX - fromX) * scale);

        result += this.sizeOfBlackWhiteBlackRun(fromX, fromY, otherToX, otherToY);
        return result - 1.0; // -1 because we counted the middle pixel twice
    }



    this.calculateModuleSizeOneWay=function( pattern,  otherPattern)
    {
        var moduleSizeEst1 = this.sizeOfBlackWhiteBlackRunBothWays(Math.floor( pattern.getX()), Math.floor( pattern.getY()), Math.floor( otherPattern.getX()), Math.floor(otherPattern.getY()));
        var moduleSizeEst2 = this.sizeOfBlackWhiteBlackRunBothWays(Math.floor(otherPattern.getX()), Math.floor(otherPattern.getY()), Math.floor( pattern.getX()), Math.floor(pattern.getY()));
        if (isNaN(moduleSizeEst1))
        {
            return moduleSizeEst2 / 7.0;
        }
        if (isNaN(moduleSizeEst2))
        {
            return moduleSizeEst1 / 7.0;
        }
        // Average them, and divide by 7 since we've counted the width of 3 black modules,
        // and 1 white and 1 black module on either side. Ergo, divide sum by 14.
        return (moduleSizeEst1 + moduleSizeEst2) / 14.0;
    }


    this.calculateModuleSize=function( topLeft,  topRight,  bottomLeft)
    {
        // Take the average
        return (this.calculateModuleSizeOneWay(topLeft, topRight) + this.calculateModuleSizeOneWay(topLeft, bottomLeft)) / 2.0;
    }

    this.distance=function( pattern1,  pattern2)
    {
        var xDiff = pattern1.getX() - pattern2.getX();
        var yDiff = pattern1.getY() - pattern2.getY();
        return  Math.sqrt( (xDiff * xDiff + yDiff * yDiff));
    }
    this.computeDimension=function( topLeft,  topRight,  bottomLeft,  moduleSize)
    {

        var tltrCentersDimension = Math.round(this.distance(topLeft, topRight) / moduleSize);
        var tlblCentersDimension = Math.round(this.distance(topLeft, bottomLeft) / moduleSize);
        var dimension = ((tltrCentersDimension + tlblCentersDimension) >> 1) + 7;
        switch (dimension & 0x03)
        {

            // mod 4
            case 0:
                dimension++;
                break;
            // 1? do nothing

            case 2:
                dimension--;
                break;

            case 3:
                throw new Error("QR Error: in detector");
        }
        return dimension;
    }

    this.findAlignmentInRegion=function( overallEstModuleSize,  estAlignmentX,  estAlignmentY,  allowanceFactor)
    {
        // Look for an alignment pattern (3 modules in size) around where it
        // should be
        var allowance = Math.floor (allowanceFactor * overallEstModuleSize);
        var alignmentAreaLeftX = Math.max(0, estAlignmentX - allowance);
        var alignmentAreaRightX = Math.min(qrcode.width - 1, estAlignmentX + allowance);
        if (alignmentAreaRightX - alignmentAreaLeftX < overallEstModuleSize * 3)
        {
            throw new Error("QR Error: in detector");
        }

        var alignmentAreaTopY = Math.max(0, estAlignmentY - allowance);
        var alignmentAreaBottomY = Math.min(qrcode.height - 1, estAlignmentY + allowance);

        var alignmentFinder = new AlignmentPatternFinder(this.image, alignmentAreaLeftX, alignmentAreaTopY, alignmentAreaRightX - alignmentAreaLeftX, alignmentAreaBottomY - alignmentAreaTopY, overallEstModuleSize, this.resultPointCallback);
        return alignmentFinder.find();
    }

    this.createTransform=function( topLeft,  topRight,  bottomLeft, alignmentPattern, dimension)
    {
        var dimMinusThree =  dimension - 3.5;
        var bottomRightX;
        var bottomRightY;
        var sourceBottomRightX;
        var sourceBottomRightY;
        if (alignmentPattern != null)
        {
            bottomRightX = alignmentPattern.getX();
            bottomRightY = alignmentPattern.getY();
            sourceBottomRightX = sourceBottomRightY = dimMinusThree - 3.0;
        }
        else
        {
            // Don't have an alignment pattern, just make up the bottom-right point
            bottomRightX = (topRight.getX() - topLeft.getX()) + bottomLeft.getX();
            bottomRightY = (topRight.getY() - topLeft.getY()) + bottomLeft.getY();
            sourceBottomRightX = sourceBottomRightY = dimMinusThree;
        }

        var transform = PerspectiveTransform.quadrilateralToQuadrilateral(3.5, 3.5, dimMinusThree, 3.5, sourceBottomRightX, sourceBottomRightY, 3.5, dimMinusThree, topLeft.getX(), topLeft.getY(), topRight.getX(), topRight.getY(), bottomRightX, bottomRightY, bottomLeft.getX(), bottomLeft.getY());

        return transform;
    }

    this.sampleGrid=function( image,  transform,  dimension)
    {

        var sampler = GridSampler;
        return sampler.sampleGrid3(image, dimension, transform);
    }

    this.processFinderPatternInfo = function( info)
    {

        var topLeft = info.getTopLeft();
        var topRight = info.getTopRight();
        var bottomLeft = info.getBottomLeft();

        var moduleSize = this.calculateModuleSize(topLeft, topRight, bottomLeft);
        if (moduleSize < 1.0)
        {
            throw new Error("QR Error: in detector");
        }
        var dimension = this.computeDimension(topLeft, topRight, bottomLeft, moduleSize);
        var provisionalVersion = Version.getProvisionalVersionForDimension(dimension);
        var modulesBetweenFPCenters = provisionalVersion.getDimensionForVersion() - 7;

        var alignmentPattern = null;
        // Anything above version 1 has an alignment pattern
        if (provisionalVersion.getAlignmentPatternCenters().length > 0)
        {

            // Guess where a "bottom right" finder pattern would have been
            var bottomRightX = topRight.getX() - topLeft.getX() + bottomLeft.getX();
            var bottomRightY = topRight.getY() - topLeft.getY() + bottomLeft.getY();

            // Estimate that alignment pattern is closer by 3 modules
            // from "bottom right" to known top left location
            var correctionToTopLeft = 1.0 - 3.0 /  modulesBetweenFPCenters;
            var estAlignmentX = Math.floor (topLeft.getX() + correctionToTopLeft * (bottomRightX - topLeft.getX()));
            var estAlignmentY = Math.floor (topLeft.getY() + correctionToTopLeft * (bottomRightY - topLeft.getY()));

            // Kind of arbitrary -- expand search radius before giving up
            for (var i = 4; i <= 16; i <<= 1)
            {
                try
                {
                    alignmentPattern = this.findAlignmentInRegion(moduleSize, estAlignmentX, estAlignmentY,  i);
                    break;
                }
                catch (re)
                {
                    // try next round
                }
            }
            // If we didn't find alignment pattern... well try anyway without it
        }

        var transform = this.createTransform(topLeft, topRight, bottomLeft, alignmentPattern, dimension);

        var bits = this.sampleGrid(this.image, transform, dimension);

        var points;
        if (alignmentPattern == null)
        {
            points = new Array(bottomLeft, topLeft, topRight);
        }
        else
        {
            points = new Array(bottomLeft, topLeft, topRight, alignmentPattern);
        }
        return new DetectorResult(bits, points);
    }



    this.detect=function()
    {
        var info =  new FinderPatternFinder().findFinderPattern(this.image);

        return this.processFinderPatternInfo(info);
    }
}
/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


var FORMAT_INFO_MASK_QR = 0x5412;
var FORMAT_INFO_DECODE_LOOKUP = new Array(new Array(0x5412, 0x00), new Array(0x5125, 0x01), new Array(0x5E7C, 0x02), new Array(0x5B4B, 0x03), new Array(0x45F9, 0x04), new Array(0x40CE, 0x05), new Array(0x4F97, 0x06), new Array(0x4AA0, 0x07), new Array(0x77C4, 0x08), new Array(0x72F3, 0x09), new Array(0x7DAA, 0x0A), new Array(0x789D, 0x0B), new Array(0x662F, 0x0C), new Array(0x6318, 0x0D), new Array(0x6C41, 0x0E), new Array(0x6976, 0x0F), new Array(0x1689, 0x10), new Array(0x13BE, 0x11), new Array(0x1CE7, 0x12), new Array(0x19D0, 0x13), new Array(0x0762, 0x14), new Array(0x0255, 0x15), new Array(0x0D0C, 0x16), new Array(0x083B, 0x17), new Array(0x355F, 0x18), new Array(0x3068, 0x19), new Array(0x3F31, 0x1A), new Array(0x3A06, 0x1B), new Array(0x24B4, 0x1C), new Array(0x2183, 0x1D), new Array(0x2EDA, 0x1E), new Array(0x2BED, 0x1F));
var BITS_SET_IN_HALF_BYTE = new Array(0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4);


function FormatInformation(formatInfo)
{
    this.errorCorrectionLevel = ErrorCorrectionLevel.forBits((formatInfo >> 3) & 0x03);
    this.dataMask =  (formatInfo & 0x07);

    this.getErrorCorrectionLevel = function()
    {
        return this.errorCorrectionLevel;
    };
    this.getDataMask = function()
    {
        return this.dataMask;
    };
    this.GetHashCode=function()
    {
        return (this.errorCorrectionLevel.ordinal() << 3) |  this.dataMask;
    }
    this.Equals=function( o)
    {
        var other =  o;
        return this.errorCorrectionLevel == other.errorCorrectionLevel && this.dataMask == other.dataMask;
    }
}

FormatInformation.numBitsDiffering=function( a,  b)
{
    a ^= b; // a now has a 1 bit exactly where its bit differs with b's
    // Count bits set quickly with a series of lookups:
    return BITS_SET_IN_HALF_BYTE[a & 0x0F] + BITS_SET_IN_HALF_BYTE[(URShift(a, 4) & 0x0F)] + BITS_SET_IN_HALF_BYTE[(URShift(a, 8) & 0x0F)] + BITS_SET_IN_HALF_BYTE[(URShift(a, 12) & 0x0F)] + BITS_SET_IN_HALF_BYTE[(URShift(a, 16) & 0x0F)] + BITS_SET_IN_HALF_BYTE[(URShift(a, 20) & 0x0F)] + BITS_SET_IN_HALF_BYTE[(URShift(a, 24) & 0x0F)] + BITS_SET_IN_HALF_BYTE[(URShift(a, 28) & 0x0F)];
}

FormatInformation.decodeFormatInformation=function( maskedFormatInfo)
{
    var formatInfo = FormatInformation.doDecodeFormatInformation(maskedFormatInfo);
    if (formatInfo != null)
    {
        return formatInfo;
    }
    // Should return null, but, some QR codes apparently
    // do not mask this info. Try again by actually masking the pattern
    // first
    return FormatInformation.doDecodeFormatInformation(maskedFormatInfo ^ FORMAT_INFO_MASK_QR);
}
FormatInformation.doDecodeFormatInformation=function( maskedFormatInfo)
{
    // Find the int in FORMAT_INFO_DECODE_LOOKUP with fewest bits differing
    var bestDifference = 0xffffffff;
    var bestFormatInfo = 0;
    for (var i = 0; i < FORMAT_INFO_DECODE_LOOKUP.length; i++)
    {
        var decodeInfo = FORMAT_INFO_DECODE_LOOKUP[i];
        var targetInfo = decodeInfo[0];
        if (targetInfo == maskedFormatInfo)
        {
            // Found an exact match
            return new FormatInformation(decodeInfo[1]);
        }
        var bitsDifference = FormatInformation.numBitsDiffering(maskedFormatInfo, targetInfo);
        if (bitsDifference < bestDifference)
        {
            bestFormatInfo = decodeInfo[1];
            bestDifference = bitsDifference;
        }
    }
    // Hamming distance of the 32 masked codes is 7, by construction, so <= 3 bits
    // differing means we found a match
    if (bestDifference <= 3)
    {
        return new FormatInformation(bestFormatInfo);
    }
    return null;
}


/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


function ErrorCorrectionLevel(ordinal,  bits, name)
{
    this.ordinal_Renamed_Field = ordinal;
    this.bits = bits;
    this.name = name;
    this.getBits = function()
    {
        return this.bits;
    };
    this.getName = function()
    {
        return this.name;
    };
    this.ordinal=function()
    {
        return this.ordinal_Renamed_Field;
    }
}

ErrorCorrectionLevel.forBits=function( bits)
{
    if (bits < 0 || bits >= FOR_BITS.length)
    {
        throw new Error("QR Error: ArgumentException");
    }
    return FOR_BITS[bits];
}

var L = new ErrorCorrectionLevel(0, 0x01, "L");
var M = new ErrorCorrectionLevel(1, 0x00, "M");
var Q = new ErrorCorrectionLevel(2, 0x03, "Q");
var H = new ErrorCorrectionLevel(3, 0x02, "H");
var FOR_BITS = new Array( M, L, H, Q);
/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


function BitMatrix( width,  height)
{
    if(!height)
        height=width;
    if (width < 1 || height < 1)
    {
        throw new Error("QR Error: Both dimensions must be greater than 0");
    }
    this.width = width;
    this.height = height;
    var rowSize = width >> 5;
    if ((width & 0x1f) != 0)
    {
        rowSize++;
    }
    this.rowSize = rowSize;
    this.bits = new Array(rowSize * height);
    for(var i=0;i<this.bits.length;i++)
        this.bits[i]=0;

    this.getWidth = function()
    {
        return this.width;
    };
    this.getHeight = function()
    {
        return this.height;
    };
    this.getDimension = function()
    {
        if (this.width != this.height)
        {
            throw new Error("QR Error: Can't call getDimension() on a non-square matrix");
        }
        return this.width;
    };

    this.get_Renamed=function( x,  y)
    {
        var offset = y * this.rowSize + (x >> 5);
        return ((URShift(this.bits[offset], (x & 0x1f))) & 1) != 0;
    }
    this.set_Renamed=function( x,  y)
    {
        var offset = y * this.rowSize + (x >> 5);
        this.bits[offset] |= 1 << (x & 0x1f);
    }
    this.flip=function( x,  y)
    {
        var offset = y * this.rowSize + (x >> 5);
        this.bits[offset] ^= 1 << (x & 0x1f);
    }
    this.clear=function()
    {
        var max = this.bits.length;
        for (var i = 0; i < max; i++)
        {
            this.bits[i] = 0;
        }
    }
    this.setRegion=function( left,  top,  width,  height)
    {
        if (top < 0 || left < 0)
        {
            throw new Error("QR Error: Left and top must be nonnegative");
        }
        if (height < 1 || width < 1)
        {
            throw new Error("QR Error: Height and width must be at least 1");
        }
        var right = left + width;
        var bottom = top + height;
        if (bottom > this.height || right > this.width)
        {
            throw new Error("QR Error: The region must fit inside the matrix");
        }
        for (var y = top; y < bottom; y++)
        {
            var offset = y * this.rowSize;
            for (var x = left; x < right; x++)
            {
                this.bits[offset + (x >> 5)] |= 1 << (x & 0x1f);
            }
        }
    }
}
/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


function DataBlock(numDataCodewords,  codewords)
{
    this.numDataCodewords = numDataCodewords;
    this.codewords = codewords;

    this.getNumDataCodewords = function()
    {
        return this.numDataCodewords;
    };
    this.getCodewords = function()
    {
        return this.codewords;
    };
}

DataBlock.getDataBlocks=function(rawCodewords,  version,  ecLevel)
{

    if (rawCodewords.length != version.getTotalCodewords())
    {
        throw new Error("QR Error: ArgumentException");
    }

    // Figure out the number and size of data blocks used by this version and
    // error correction level
    var ecBlocks = version.getECBlocksForLevel(ecLevel);

    // First count the total number of data blocks
    var totalBlocks = 0;
    var ecBlockArray = ecBlocks.getECBlocks();
    for (var i = 0; i < ecBlockArray.length; i++)
    {
        totalBlocks += ecBlockArray[i].getCount();
    }

    // Now establish DataBlocks of the appropriate size and number of data codewords
    var result = new Array(totalBlocks);
    var numResultBlocks = 0;
    for (var j = 0; j < ecBlockArray.length; j++)
    {
        var ecBlock = ecBlockArray[j];
        for (var i = 0; i < ecBlock.getCount(); i++)
        {
            var numDataCodewords = ecBlock.getDataCodewords();
            var numBlockCodewords = ecBlocks.getECCodewordsPerBlock() + numDataCodewords;
            result[numResultBlocks++] = new DataBlock(numDataCodewords, new Array(numBlockCodewords));
        }
    }

    // All blocks have the same amount of data, except that the last n
    // (where n may be 0) have 1 more byte. Figure out where these start.
    var shorterBlocksTotalCodewords = result[0].codewords.length;
    var longerBlocksStartAt = result.length - 1;
    while (longerBlocksStartAt >= 0)
    {
        var numCodewords = result[longerBlocksStartAt].codewords.length;
        if (numCodewords == shorterBlocksTotalCodewords)
        {
            break;
        }
        longerBlocksStartAt--;
    }
    longerBlocksStartAt++;

    var shorterBlocksNumDataCodewords = shorterBlocksTotalCodewords - ecBlocks.getECCodewordsPerBlock();
    // The last elements of result may be 1 element longer;
    // first fill out as many elements as all of them have
    var rawCodewordsOffset = 0;
    for (var i = 0; i < shorterBlocksNumDataCodewords; i++)
    {
        for (var j = 0; j < numResultBlocks; j++)
        {
            result[j].codewords[i] = rawCodewords[rawCodewordsOffset++];
        }
    }
    // Fill out the last data block in the longer ones
    for (var j = longerBlocksStartAt; j < numResultBlocks; j++)
    {
        result[j].codewords[shorterBlocksNumDataCodewords] = rawCodewords[rawCodewordsOffset++];
    }
    // Now add in error correction blocks
    var max = result[0].codewords.length;
    for (var i = shorterBlocksNumDataCodewords; i < max; i++)
    {
        for (var j = 0; j < numResultBlocks; j++)
        {
            var iOffset = j < longerBlocksStartAt?i:i + 1;
            result[j].codewords[iOffset] = rawCodewords[rawCodewordsOffset++];
        }
    }
    return result;
}

/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


function BitMatrixParser(bitMatrix)
{
    var dimension = bitMatrix.getDimension();
    if (dimension < 21 || (dimension & 0x03) != 1)
    {
        throw new Error("QR Error: Error BitMatrixParser");
    }
    this.bitMatrix = bitMatrix;
    this.parsedVersion = null;
    this.parsedFormatInfo = null;

    this.copyBit=function( i,  j,  versionBits)
    {
        return this.bitMatrix.get_Renamed(i, j)?(versionBits << 1) | 0x1:versionBits << 1;
    }

    this.readFormatInformation=function()
    {
        if (this.parsedFormatInfo != null)
        {
            return this.parsedFormatInfo;
        }

        // Read top-left format info bits
        var formatInfoBits = 0;
        for (var i = 0; i < 6; i++)
        {
            formatInfoBits = this.copyBit(i, 8, formatInfoBits);
        }
        // .. and skip a bit in the timing pattern ...
        formatInfoBits = this.copyBit(7, 8, formatInfoBits);
        formatInfoBits = this.copyBit(8, 8, formatInfoBits);
        formatInfoBits = this.copyBit(8, 7, formatInfoBits);
        // .. and skip a bit in the timing pattern ...
        for (var j = 5; j >= 0; j--)
        {
            formatInfoBits = this.copyBit(8, j, formatInfoBits);
        }

        this.parsedFormatInfo = FormatInformation.decodeFormatInformation(formatInfoBits);
        if (this.parsedFormatInfo != null)
        {
            return this.parsedFormatInfo;
        }

        // Hmm, failed. Try the top-right/bottom-left pattern
        var dimension = this.bitMatrix.getDimension();
        formatInfoBits = 0;
        var iMin = dimension - 8;
        for (var i = dimension - 1; i >= iMin; i--)
        {
            formatInfoBits = this.copyBit(i, 8, formatInfoBits);
        }
        for (var j = dimension - 7; j < dimension; j++)
        {
            formatInfoBits = this.copyBit(8, j, formatInfoBits);
        }

        this.parsedFormatInfo = FormatInformation.decodeFormatInformation(formatInfoBits);
        if (this.parsedFormatInfo != null)
        {
            return this.parsedFormatInfo;
        }
        throw new Error("QR Error: Error readFormatInformation");
    }
    this.readVersion=function()
    {

        if (this.parsedVersion != null)
        {
            return this.parsedVersion;
        }

        var dimension = this.bitMatrix.getDimension();

        var provisionalVersion = (dimension - 17) >> 2;
        if (provisionalVersion <= 6)
        {
            return Version.getVersionForNumber(provisionalVersion);
        }

        // Read top-right version info: 3 wide by 6 tall
        var versionBits = 0;
        var ijMin = dimension - 11;
        for (var j = 5; j >= 0; j--)
        {
            for (var i = dimension - 9; i >= ijMin; i--)
            {
                versionBits = this.copyBit(i, j, versionBits);
            }
        }

        this.parsedVersion = Version.decodeVersionInformation(versionBits);
        if (this.parsedVersion != null && this.parsedVersion.getDimensionForVersion() == dimension)
        {
            return this.parsedVersion;
        }

        // Hmm, failed. Try bottom left: 6 wide by 3 tall
        versionBits = 0;
        for (var i = 5; i >= 0; i--)
        {
            for (var j = dimension - 9; j >= ijMin; j--)
            {
                versionBits = this.copyBit(i, j, versionBits);
            }
        }

        this.parsedVersion = Version.decodeVersionInformation(versionBits);
        if (this.parsedVersion != null && this.parsedVersion.getDimensionForVersion() == dimension)
        {
            return this.parsedVersion;
        }
        throw new Error("QR Error: Error readVersion");
    }
    this.readCodewords=function()
    {

        var formatInfo = this.readFormatInformation();
        var version = this.readVersion();

        // Get the data mask for the format used in this QR Code. This will exclude
        // some bits from reading as we wind through the bit matrix.
        var dataMask = DataMask.forReference( formatInfo.getDataMask());
        var dimension = this.bitMatrix.getDimension();
        dataMask.unmaskBitMatrix(this.bitMatrix, dimension);

        var functionPattern = version.buildFunctionPattern();

        var readingUp = true;
        var result = new Array(version.getTotalCodewords());
        var resultOffset = 0;
        var currentByte = 0;
        var bitsRead = 0;
        // Read columns in pairs, from right to left
        for (var j = dimension - 1; j > 0; j -= 2)
        {
            if (j == 6)
            {
                // Skip whole column with vertical alignment pattern;
                // saves time and makes the other code proceed more cleanly
                j--;
            }
            // Read alternatingly from bottom to top then top to bottom
            for (var count = 0; count < dimension; count++)
            {
                var i = readingUp?dimension - 1 - count:count;
                for (var col = 0; col < 2; col++)
                {
                    // Ignore bits covered by the function pattern
                    if (!functionPattern.get_Renamed(j - col, i))
                    {
                        // Read a bit
                        bitsRead++;
                        currentByte <<= 1;
                        if (this.bitMatrix.get_Renamed(j - col, i))
                        {
                            currentByte |= 1;
                        }
                        // If we've made a whole byte, save it off
                        if (bitsRead == 8)
                        {
                            result[resultOffset++] =  currentByte;
                            bitsRead = 0;
                            currentByte = 0;
                        }
                    }
                }
            }
            readingUp ^= true; // readingUp = !readingUp; // switch directions
        }
        if (resultOffset != version.getTotalCodewords())
        {
            throw new Error("QR Error: Error readCodewords");
        }
        return result;
    }
}
/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


var DataMask = {};

DataMask.forReference = function(reference)
{
    if (reference < 0 || reference > 7)
    {
        throw new Error("QR Error: System.ArgumentException");
    }
    return DataMask.DATA_MASKS[reference];
}

function DataMask000()
{
    this.unmaskBitMatrix=function(bits,  dimension)
    {
        for (var i = 0; i < dimension; i++)
        {
            for (var j = 0; j < dimension; j++)
            {
                if (this.isMasked(i, j))
                {
                    bits.flip(j, i);
                }
            }
        }
    }
    this.isMasked=function( i,  j)
    {
        return ((i + j) & 0x01) == 0;
    }
}

function DataMask001()
{
    this.unmaskBitMatrix=function(bits,  dimension)
    {
        for (var i = 0; i < dimension; i++)
        {
            for (var j = 0; j < dimension; j++)
            {
                if (this.isMasked(i, j))
                {
                    bits.flip(j, i);
                }
            }
        }
    }
    this.isMasked=function( i,  j)
    {
        return (i & 0x01) == 0;
    }
}

function DataMask010()
{
    this.unmaskBitMatrix=function(bits,  dimension)
    {
        for (var i = 0; i < dimension; i++)
        {
            for (var j = 0; j < dimension; j++)
            {
                if (this.isMasked(i, j))
                {
                    bits.flip(j, i);
                }
            }
        }
    }
    this.isMasked=function( i,  j)
    {
        return j % 3 == 0;
    }
}

function DataMask011()
{
    this.unmaskBitMatrix=function(bits,  dimension)
    {
        for (var i = 0; i < dimension; i++)
        {
            for (var j = 0; j < dimension; j++)
            {
                if (this.isMasked(i, j))
                {
                    bits.flip(j, i);
                }
            }
        }
    }
    this.isMasked=function( i,  j)
    {
        return (i + j) % 3 == 0;
    }
}

function DataMask100()
{
    this.unmaskBitMatrix=function(bits,  dimension)
    {
        for (var i = 0; i < dimension; i++)
        {
            for (var j = 0; j < dimension; j++)
            {
                if (this.isMasked(i, j))
                {
                    bits.flip(j, i);
                }
            }
        }
    }
    this.isMasked=function( i,  j)
    {
        return (((URShift(i, 1)) + (j / 3)) & 0x01) == 0;
    }
}

function DataMask101()
{
    this.unmaskBitMatrix=function(bits,  dimension)
    {
        for (var i = 0; i < dimension; i++)
        {
            for (var j = 0; j < dimension; j++)
            {
                if (this.isMasked(i, j))
                {
                    bits.flip(j, i);
                }
            }
        }
    }
    this.isMasked=function( i,  j)
    {
        var temp = i * j;
        return (temp & 0x01) + (temp % 3) == 0;
    }
}

function DataMask110()
{
    this.unmaskBitMatrix=function(bits,  dimension)
    {
        for (var i = 0; i < dimension; i++)
        {
            for (var j = 0; j < dimension; j++)
            {
                if (this.isMasked(i, j))
                {
                    bits.flip(j, i);
                }
            }
        }
    }
    this.isMasked=function( i,  j)
    {
        var temp = i * j;
        return (((temp & 0x01) + (temp % 3)) & 0x01) == 0;
    }
}
function DataMask111()
{
    this.unmaskBitMatrix=function(bits,  dimension)
    {
        for (var i = 0; i < dimension; i++)
        {
            for (var j = 0; j < dimension; j++)
            {
                if (this.isMasked(i, j))
                {
                    bits.flip(j, i);
                }
            }
        }
    }
    this.isMasked=function( i,  j)
    {
        return ((((i + j) & 0x01) + ((i * j) % 3)) & 0x01) == 0;
    }
}

DataMask.DATA_MASKS = new Array(new DataMask000(), new DataMask001(), new DataMask010(), new DataMask011(), new DataMask100(), new DataMask101(), new DataMask110(), new DataMask111());


/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


function ReedSolomonDecoder(field)
{
    this.field = field;
    this.decode=function(received,  twoS)
    {
        var poly = new GF256Poly(this.field, received);
        var syndromeCoefficients = new Array(twoS);
        for(var i=0;i<syndromeCoefficients.length;i++)syndromeCoefficients[i]=0;
        var dataMatrix = false;//this.field.Equals(GF256.DATA_MATRIX_FIELD);
        var noError = true;
        for (var i = 0; i < twoS; i++)
        {
            // Thanks to sanfordsquires for this fix:
            var evalu = poly.evaluateAt(this.field.exp(dataMatrix?i + 1:i));
            syndromeCoefficients[syndromeCoefficients.length - 1 - i] = evalu;
            if (evalu != 0)
            {
                noError = false;
            }
        }
        if (noError)
        {
            return ;
        }
        var syndrome = new GF256Poly(this.field, syndromeCoefficients);
        var sigmaOmega = this.runEuclideanAlgorithm(this.field.buildMonomial(twoS, 1), syndrome, twoS);
        var sigma = sigmaOmega[0];
        var omega = sigmaOmega[1];
        var errorLocations = this.findErrorLocations(sigma);
        var errorMagnitudes = this.findErrorMagnitudes(omega, errorLocations, dataMatrix);
        for (var i = 0; i < errorLocations.length; i++)
        {
            var position = received.length - 1 - this.field.log(errorLocations[i]);
            if (position < 0)
            {
                throw new Error("QR Error: ReedSolomonException Bad error location");
            }
            received[position] = GF256.addOrSubtract(received[position], errorMagnitudes[i]);
        }
    }

    this.runEuclideanAlgorithm=function( a,  b,  R)
    {
        // Assume a's degree is >= b's
        if (a.getDegree() < b.getDegree())
        {
            var temp = a;
            a = b;
            b = temp;
        }

        var rLast = a;
        var r = b;
        var sLast = this.field.getOne();
        var s = this.field.getZero();
        var tLast = this.field.getZero();
        var t = this.field.getOne();

        // Run Euclidean algorithm until r's degree is less than R/2
        while (r.getDegree() >= Math.floor(R / 2))
        {
            var rLastLast = rLast;
            var sLastLast = sLast;
            var tLastLast = tLast;
            rLast = r;
            sLast = s;
            tLast = t;

            // Divide rLastLast by rLast, with quotient in q and remainder in r
            if (rLast.getZero())
            {
                // Oops, Euclidean algorithm already terminated?
                throw new Error("QR Error: r_{i-1} was zero");
            }
            r = rLastLast;
            var q = this.field.getZero();
            var denominatorLeadingTerm = rLast.getCoefficient(rLast.getDegree());
            var dltInverse = this.field.inverse(denominatorLeadingTerm);
            while (r.getDegree() >= rLast.getDegree() && !r.getZero())
            {
                var degreeDiff = r.getDegree() - rLast.getDegree();
                var scale = this.field.multiply(r.getCoefficient(r.getDegree()), dltInverse);
                q = q.addOrSubtract(this.field.buildMonomial(degreeDiff, scale));
                r = r.addOrSubtract(rLast.multiplyByMonomial(degreeDiff, scale));
                //r.EXE();
            }

            s = q.multiply1(sLast).addOrSubtract(sLastLast);
            t = q.multiply1(tLast).addOrSubtract(tLastLast);
        }

        var sigmaTildeAtZero = t.getCoefficient(0);
        if (sigmaTildeAtZero == 0)
        {
            throw new Error("QR Error: ReedSolomonException sigmaTilde(0) was zero");
        }

        var inverse = this.field.inverse(sigmaTildeAtZero);
        var sigma = t.multiply2(inverse);
        var omega = r.multiply2(inverse);
        return new Array(sigma, omega);
    }
    this.findErrorLocations=function( errorLocator)
    {
        // This is a direct application of Chien's search
        var numErrors = errorLocator.getDegree();
        if (numErrors == 1)
        {
            // shortcut
            return new Array(errorLocator.getCoefficient(1));
        }
        var result = new Array(numErrors);
        var e = 0;
        for (var i = 1; i < 256 && e < numErrors; i++)
        {
            if (errorLocator.evaluateAt(i) == 0)
            {
                result[e] = this.field.inverse(i);
                e++;
            }
        }
        if (e != numErrors)
        {
            throw new Error("QR Error: Error locator degree does not match number of roots");
        }
        return result;
    }
    this.findErrorMagnitudes=function( errorEvaluator,  errorLocations,  dataMatrix)
    {
        // This is directly applying Forney's Formula
        var s = errorLocations.length;
        var result = new Array(s);
        for (var i = 0; i < s; i++)
        {
            var xiInverse = this.field.inverse(errorLocations[i]);
            var denominator = 1;
            for (var j = 0; j < s; j++)
            {
                if (i != j)
                {
                    denominator = this.field.multiply(denominator, GF256.addOrSubtract(1, this.field.multiply(errorLocations[j], xiInverse)));
                }
            }
            result[i] = this.field.multiply(errorEvaluator.evaluateAt(xiInverse), this.field.inverse(denominator));
            // Thanks to sanfordsquires for this fix:
            if (dataMatrix)
            {
                result[i] = this.field.multiply(result[i], xiInverse);
            }
        }
        return result;
    }
}
/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


function GF256Poly(field,  coefficients)
{
    if (coefficients == null || coefficients.length == 0)
    {
        throw new Error("QR Error: System.ArgumentException");
    }
    this.field = field;
    var coefficientsLength = coefficients.length;
    if (coefficientsLength > 1 && coefficients[0] == 0)
    {
        // Leading term must be non-zero for anything except the constant polynomial "0"
        var firstNonZero = 1;
        while (firstNonZero < coefficientsLength && coefficients[firstNonZero] == 0)
        {
            firstNonZero++;
        }
        if (firstNonZero == coefficientsLength)
        {
            this.coefficients = field.getZero().coefficients;
        }
        else
        {
            this.coefficients = new Array(coefficientsLength - firstNonZero);
            for(var i=0;i<this.coefficients.length;i++)this.coefficients[i]=0;
            //Array.Copy(coefficients, firstNonZero, this.coefficients, 0, this.coefficients.length);
            for(var ci=0;ci<this.coefficients.length;ci++)this.coefficients[ci]=coefficients[firstNonZero+ci];
        }
    }
    else
    {
        this.coefficients = coefficients;
    }

    this.getZero = function()
    {
        return this.coefficients[0] == 0;
    };
    this.getDegree = function()
    {
        return this.coefficients.length - 1;
    };
    this.getCoefficients = function()
    {
        return this.coefficients;
    };

    this.getCoefficient=function( degree)
    {
        return this.coefficients[this.coefficients.length - 1 - degree];
    }

    this.evaluateAt=function( a)
    {
        if (a == 0)
        {
            // Just return the x^0 coefficient
            return this.getCoefficient(0);
        }
        var size = this.coefficients.length;
        if (a == 1)
        {
            // Just the sum of the coefficients
            var result = 0;
            for (var i = 0; i < size; i++)
            {
                result = GF256.addOrSubtract(result, this.coefficients[i]);
            }
            return result;
        }
        var result2 = this.coefficients[0];
        for (var i = 1; i < size; i++)
        {
            result2 = GF256.addOrSubtract(this.field.multiply(a, result2), this.coefficients[i]);
        }
        return result2;
    }

    this.addOrSubtract=function( other)
    {
        if (this.field != other.field)
        {
            throw new Error("QR Error: GF256Polys do not have same GF256 field");
        }
        if (this.getZero())
        {
            return other;
        }
        if (other.getZero())
        {
            return this;
        }

        var smallerCoefficients = this.coefficients;
        var largerCoefficients = other.coefficients;
        if (smallerCoefficients.length > largerCoefficients.length)
        {
            var temp = smallerCoefficients;
            smallerCoefficients = largerCoefficients;
            largerCoefficients = temp;
        }
        var sumDiff = new Array(largerCoefficients.length);
        var lengthDiff = largerCoefficients.length - smallerCoefficients.length;
        // Copy high-order terms only found in higher-degree polynomial's coefficients
        //Array.Copy(largerCoefficients, 0, sumDiff, 0, lengthDiff);
        for(var ci=0;ci<lengthDiff;ci++)sumDiff[ci]=largerCoefficients[ci];

        for (var i = lengthDiff; i < largerCoefficients.length; i++)
        {
            sumDiff[i] = GF256.addOrSubtract(smallerCoefficients[i - lengthDiff], largerCoefficients[i]);
        }

        return new GF256Poly(field, sumDiff);
    }
    this.multiply1=function( other)
    {
        if (this.field!=other.field)
        {
            throw new Error("QR Error: GF256Polys do not have same GF256 field");
        }
        if (this.getZero() || other.getZero())
        {
            return this.field.getZero();
        }
        var aCoefficients = this.coefficients;
        var aLength = aCoefficients.length;
        var bCoefficients = other.coefficients;
        var bLength = bCoefficients.length;
        var product = new Array(aLength + bLength - 1);
        for (var i = 0; i < aLength; i++)
        {
            var aCoeff = aCoefficients[i];
            for (var j = 0; j < bLength; j++)
            {
                product[i + j] = GF256.addOrSubtract(product[i + j], this.field.multiply(aCoeff, bCoefficients[j]));
            }
        }
        return new GF256Poly(this.field, product);
    }
    this.multiply2=function( scalar)
    {
        if (scalar == 0)
        {
            return this.field.getZero();
        }
        if (scalar == 1)
        {
            return this;
        }
        var size = this.coefficients.length;
        var product = new Array(size);
        for (var i = 0; i < size; i++)
        {
            product[i] = this.field.multiply(this.coefficients[i], scalar);
        }
        return new GF256Poly(this.field, product);
    }
    this.multiplyByMonomial=function( degree,  coefficient)
    {
        if (degree < 0)
        {
            throw new Error("QR Error: System.ArgumentException");
        }
        if (coefficient == 0)
        {
            return this.field.getZero();
        }
        var size = this.coefficients.length;
        var product = new Array(size + degree);
        for(var i=0;i<product.length;i++)product[i]=0;
        for (var i = 0; i < size; i++)
        {
            product[i] = this.field.multiply(this.coefficients[i], coefficient);
        }
        return new GF256Poly(this.field, product);
    }
    this.divide=function( other)
    {
        if (this.field!=other.field)
        {
            throw new Error("QR Error: GF256Polys do not have same GF256 field");
        }
        if (other.getZero())
        {
            throw new Error("QR Error: Divide by 0");
        }

        var quotient = this.field.getZero();
        var remainder = this;

        var denominatorLeadingTerm = other.getCoefficient(other.getDegree());
        var inverseDenominatorLeadingTerm = this.field.inverse(denominatorLeadingTerm);

        while (remainder.getDegree() >= other.getDegree() && !remainder.getZero())
        {
            var degreeDifference = remainder.getDegree() - other.getDegree();
            var scale = this.field.multiply(remainder.getCoefficient(remainder.getDegree()), inverseDenominatorLeadingTerm);
            var term = other.multiplyByMonomial(degreeDifference, scale);
            var iterationQuotient = this.field.buildMonomial(degreeDifference, scale);
            quotient = quotient.addOrSubtract(iterationQuotient);
            remainder = remainder.addOrSubtract(term);
        }

        return new Array(quotient, remainder);
    }
}
/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


function GF256( primitive)
{
    this.expTable = new Array(256);
    this.logTable = new Array(256);
    var x = 1;
    for (var i = 0; i < 256; i++)
    {
        this.expTable[i] = x;
        x <<= 1; // x = x * 2; we're assuming the generator alpha is 2
        if (x >= 0x100)
        {
            x ^= primitive;
        }
    }
    for (var i = 0; i < 255; i++)
    {
        this.logTable[this.expTable[i]] = i;
    }
    // logTable[0] == 0 but this should never be used
    var at0=new Array(1);at0[0]=0;
    this.zero = new GF256Poly(this, new Array(at0));
    var at1=new Array(1);at1[0]=1;
    this.one = new GF256Poly(this, new Array(at1));

    this.getZero = function()
    {
        return this.zero;
    };
    this.getOne = function()
    {
        return this.one;
    };
    this.buildMonomial=function( degree,  coefficient)
    {
        if (degree < 0)
        {
            throw new Error("QR Error: System.ArgumentException");
        }
        if (coefficient == 0)
        {
            return this.zero;
        }
        var coefficients = new Array(degree + 1);
        for(var i=0;i<coefficients.length;i++)coefficients[i]=0;
        coefficients[0] = coefficient;
        return new GF256Poly(this, coefficients);
    }
    this.exp=function( a)
    {
        return this.expTable[a];
    }
    this.log=function( a)
    {
        if (a == 0)
        {
            throw new Error("QR Error: System.ArgumentException");
        }
        return this.logTable[a];
    }
    this.inverse=function( a)
    {
        if (a == 0)
        {
            throw new Error("QR Error: System.ArithmeticException");
        }
        return this.expTable[255 - this.logTable[a]];
    }
    this.multiply=function( a,  b)
    {
        if (a == 0 || b == 0)
        {
            return 0;
        }
        if (a == 1)
        {
            return b;
        }
        if (b == 1)
        {
            return a;
        }
        return this.expTable[(this.logTable[a] + this.logTable[b]) % 255];
    }
}

GF256.QR_CODE_FIELD = new GF256(0x011D);
GF256.DATA_MATRIX_FIELD = new GF256(0x012D);

GF256.addOrSubtract=function( a,  b)
{
    return a ^ b;
}
/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


var Decoder={};
Decoder.rsDecoder = new ReedSolomonDecoder(GF256.QR_CODE_FIELD);

Decoder.correctErrors=function( codewordBytes,  numDataCodewords)
{
    var numCodewords = codewordBytes.length;
    // First read into an array of ints
    var codewordsInts = new Array(numCodewords);
    for (var i = 0; i < numCodewords; i++)
    {
        codewordsInts[i] = codewordBytes[i] & 0xFF;
    }
    var numECCodewords = codewordBytes.length - numDataCodewords;
    try
    {
        Decoder.rsDecoder.decode(codewordsInts, numECCodewords);
        //var corrector = new ReedSolomon(codewordsInts, numECCodewords);
        //corrector.correct();
    }
    catch ( rse)
    {
        throw rse;
    }
    // Copy back into array of bytes -- only need to worry about the bytes that were data
    // We don't care about errors in the error-correction codewords
    for (var i = 0; i < numDataCodewords; i++)
    {
        codewordBytes[i] =  codewordsInts[i];
    }
}

Decoder.decode=function(bits)
{
    var parser = new BitMatrixParser(bits);
    var version = parser.readVersion();
    var ecLevel = parser.readFormatInformation().getErrorCorrectionLevel();

    // Read codewords
    var codewords = parser.readCodewords();

    // Separate into data blocks
    var dataBlocks = DataBlock.getDataBlocks(codewords, version, ecLevel);

    // Count total number of data bytes
    var totalBytes = 0;
    for (var i = 0; i < dataBlocks.length; i++)
    {
        totalBytes += dataBlocks[i].getNumDataCodewords();
    }
    var resultBytes = new Array(totalBytes);
    var resultOffset = 0;

    // Error-correct and copy data blocks together into a stream of bytes
    for (var j = 0; j < dataBlocks.length; j++)
    {
        var dataBlock = dataBlocks[j];
        var codewordBytes = dataBlock.getCodewords();
        var numDataCodewords = dataBlock.getNumDataCodewords();
        Decoder.correctErrors(codewordBytes, numDataCodewords);
        for (var i = 0; i < numDataCodewords; i++)
        {
            resultBytes[resultOffset++] = codewordBytes[i];
        }
    }

    // Decode the contents of that stream of bytes
    var reader = new QRCodeDataBlockReader(resultBytes, version.getVersionNumber(), ecLevel.getBits());
    return reader;
    //return DecodedBitStreamParser.decode(resultBytes, version, ecLevel);
}

/*
   Copyright 2011 Lazar Laszlo (lazarsoft@gmail.com, www.lazarsoft.info)

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/


var qrcode = {};
qrcode.width = 0;
qrcode.height = 0;
qrcode.debug = false;
qrcode.maxImgSize = 1024*1024;

qrcode.sizeOfDataLengthInfo =  [  [ 10, 9, 8, 8 ],  [ 12, 11, 16, 10 ],  [ 14, 13, 16, 12 ] ];

qrcode.callback = null;

qrcode.decode = function(imageData) {
    qrcode.width = imageData.width;
    qrcode.height = imageData.height;
    const result = qrcode.process(imageData);
    if(qrcode.callback!=null)
        qrcode.callback(result);
    return result;
}

qrcode.isUrl = function(s)
{
    try {
        new URL(s);
        return true;
    } catch(e) {
        return false;
    }
}

qrcode.decode_url = function (s)
{
    var escaped = "";
    try{
        escaped = escape( s );
    }
    catch(e)
    {
        console.log(e);
        escaped = s;
    }
    var ret = "";
    try{
        ret = decodeURIComponent( escaped );
    }
    catch(e)
    {
        console.log(e);
        ret = escaped;
    }
    return ret;
}

qrcode.decode_utf8 = function ( s )
{
    if(qrcode.isUrl(s))
        return qrcode.decode_url(s);
    else
        return s;
}

qrcode.grayscaleWeights = {
    // weights for quick luma integer approximation (https://en.wikipedia.org/wiki/YUV#Full_swing_for_BT.601)
    red: 77,
    blue: 150,
    green: 29
};

qrcode.inversionMode = 'original';

qrcode.process = function(imageData){
    var inputRgba = imageData.data;
    // asign the grayscale and binary image within the rgba buffer as the rgba image will not be needed anymore
    var offset = 0;
    var grayscaleImage = new Uint8ClampedArray(inputRgba.buffer, offset, qrcode.width * qrcode.height);
    offset += qrcode.width * qrcode.height;
    var binaryImage = new Uint8ClampedArray(inputRgba.buffer, offset, qrcode.width * qrcode.height);
    offset += qrcode.width * qrcode.height;
    var binarizerBufferSize = Binarizer.calculateRequiredBufferSize(qrcode.width, qrcode.height);
    var binarizerBuffer = new Uint8ClampedArray(inputRgba.buffer, offset, binarizerBufferSize);

    qrcode.grayscale(inputRgba, qrcode.width, qrcode.height, grayscaleImage);

    var invertImage = qrcode.inversionMode === 'invert';
    var inversionsToTry = qrcode.inversionMode === 'both' ? 2 : 1;
    for (var i = 1; i <= inversionsToTry; ++i)
    {
        if (invertImage) qrcode.invertGrayscale(grayscaleImage, qrcode.width, qrcode.height, grayscaleImage);

        Binarizer.binarize(grayscaleImage, qrcode.width, qrcode.height, binaryImage, binarizerBuffer);

        var debugImage;
        if(qrcode.debug)
        {
            debugImage = new ImageData(new Uint8ClampedArray(qrcode.width * qrcode.height * 4), qrcode.width, qrcode.height);
            _renderDebugImage(binaryImage, qrcode.width, qrcode.height, debugImage);
        }

        try {
            var detector = new Detector(binaryImage);

            var qrCodeMatrix = detector.detect(); // throws if no qr code was found

            if (qrcode.debug) {
                _renderDebugQrCodeMatrix(qrCodeMatrix, qrcode.width, debugImage);
            }
            break; // we found a qr code
        } catch(e) {
            if (i === inversionsToTry) throw e; // tried all inversion modes
        } finally {
            if (qrcode.debug) {
                sendDebugImage(debugImage);
            }
            invertImage = true; // try inversion
        }
    }

    var reader = Decoder.decode(qrCodeMatrix.bits);
    var data = reader.getDataByte();
    var str="";
    for(var i=0;i<data.length;i++)
    {
        for(var j=0;j<data[i].length;j++)
            str+=String.fromCharCode(data[i][j]);
    }

    return qrcode.decode_utf8(str);
}

qrcode.grayscale = function(inputRgba, width, height, out_grayscale)
{
    var weightRed = qrcode.grayscaleWeights.red;
    var weightBlue = qrcode.grayscaleWeights.blue;
    var weightGreen = qrcode.grayscaleWeights.green;
    for (var y = 0; y < height; y++)
    {
        for (var x = 0; x < width; x++)
        {
            var index = y*width + x;
            var rgbaIndex = 4 * index;
            // based on quick luma integer approximation (https://en.wikipedia.org/wiki/YUV#Full_swing_for_BT.601)
            out_grayscale[index] = (weightRed * inputRgba[rgbaIndex] + weightBlue * inputRgba[rgbaIndex+1] +
                weightGreen * inputRgba[rgbaIndex+2] + 128) >> 8;
        }
    }
}

qrcode.invertGrayscale = function(input_grayscale, width, height, out_grayscale) {
    for (var y = 0; y < height; y++)
    {
        for (var x = 0; x < width; x++)
        {
            var index = y*width + x;
            out_grayscale[index] = 255 - input_grayscale[index];
        }
    }
}

function _renderDebugImage(grayscaleOrBinaryImage, width, height, debugImage)
{
    for (var y = 0; y < height; y++)
    {
        for (var x = 0; x < width; x++)
        {
            var point = (x * 4) + (y * width * 4);
            var pixel = grayscaleOrBinaryImage[y * width + x]? 0 : 255;
            debugImage.data[point] = pixel;
            debugImage.data[point+1] = pixel;
            debugImage.data[point+2] = pixel;
            debugImage.data[point+3] = 255; // alpha
        }
    }
}

function _renderDebugQrCodeMatrix(qrCodeMatrix, imageWidth, debugImage)
{
    for (var y = 0; y < qrCodeMatrix.bits.getHeight(); y++)
    {
        for (var x = 0; x < qrCodeMatrix.bits.getWidth(); x++)
        {
            var point = (x * 4 * 2) + (y * 2 * imageWidth * 4);
            var isSet = qrCodeMatrix.bits.get_Renamed(x, y);
            debugImage.data[point] = isSet ? 0 : 255;
            debugImage.data[point + 1] = isSet ? 0 : 255;
            debugImage.data[point + 2] = 255;
        }
    }
}

function URShift( number,  bits)
{
    if (number >= 0)
        return number >> bits;
    else
        return (number >> bits) + (2 << ~bits);
}
/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


var MIN_SKIP = 3; // 1 pixel/module times 3 modules/center
var MAX_MODULES = 57; // support up to version 10 for mobile clients
var CENTER_QUORUM = 2;

qrcode.orderBestPatterns=function(patterns)
{

    function distance( pattern1,  pattern2)
    {
        var xDiff = pattern1.getX() - pattern2.getX();
        var yDiff = pattern1.getY() - pattern2.getY();
        return  Math.sqrt( (xDiff * xDiff + yDiff * yDiff));
    }

    /// <summary> Returns the z component of the cross product between vectors BC and BA.</summary>
    function crossProductZ( pointA,  pointB,  pointC)
    {
        var bX = pointB.x;
        var bY = pointB.y;
        return ((pointC.x - bX) * (pointA.y - bY)) - ((pointC.y - bY) * (pointA.x - bX));
    }


    // Find distances between pattern centers
    var zeroOneDistance = distance(patterns[0], patterns[1]);
    var oneTwoDistance = distance(patterns[1], patterns[2]);
    var zeroTwoDistance = distance(patterns[0], patterns[2]);

    var pointA, pointB, pointC;
    // Assume one closest to other two is B; A and C will just be guesses at first
    if (oneTwoDistance >= zeroOneDistance && oneTwoDistance >= zeroTwoDistance)
    {
        pointB = patterns[0];
        pointA = patterns[1];
        pointC = patterns[2];
    }
    else if (zeroTwoDistance >= oneTwoDistance && zeroTwoDistance >= zeroOneDistance)
    {
        pointB = patterns[1];
        pointA = patterns[0];
        pointC = patterns[2];
    }
    else
    {
        pointB = patterns[2];
        pointA = patterns[0];
        pointC = patterns[1];
    }

    // Use cross product to figure out whether A and C are correct or flipped.
    // This asks whether BC x BA has a positive z component, which is the arrangement
    // we want for A, B, C. If it's negative, then we've got it flipped around and
    // should swap A and C.
    if (crossProductZ(pointA, pointB, pointC) < 0.0)
    {
        var temp = pointA;
        pointA = pointC;
        pointC = temp;
    }

    patterns[0] = pointA;
    patterns[1] = pointB;
    patterns[2] = pointC;
}


function FinderPattern(posX, posY,  estimatedModuleSize)
{
    this.x=posX;
    this.y=posY;
    this.count = 1;
    this.estimatedModuleSize = estimatedModuleSize;

    this.getEstimatedModuleSize = function()
    {
        return this.estimatedModuleSize;
    };
    this.getCount = function()
    {
        return this.count;
    };
    this.getX = function()
    {
        return this.x;
    };
    this.getY = function()
    {
        return this.y;
    };
    this.incrementCount = function()
    {
        this.count++;
    }
    this.aboutEquals=function( moduleSize,  i,  j)
    {
        if (Math.abs(i - this.y) <= moduleSize && Math.abs(j - this.x) <= moduleSize)
        {
            var moduleSizeDiff = Math.abs(moduleSize - this.estimatedModuleSize);
            return moduleSizeDiff <= 1.0 || moduleSizeDiff / this.estimatedModuleSize <= 1.0;
        }
        return false;
    }

}

function FinderPatternInfo(patternCenters)
{
    this.bottomLeft = patternCenters[0];
    this.topLeft = patternCenters[1];
    this.topRight = patternCenters[2];
    this.getBottomLeft = function()
    {
        return this.bottomLeft;
    };
    this.getTopLeft = function()
    {
        return this.topLeft;
    };
    this.getTopRight = function()
    {
        return this.topRight;
    };
}

/**
 * Finds a finder pattern. A finder pattern is one of the patterns in the corners
 * of the QR codes. The patterns consist of black and white squares of specific proportions.
 * If you consider a line through the pattern, the color changes proportionally between white and black:
 *   1   -   1   -   3   -   1   -   1
 * black - white - black - white - black
 */
function FinderPatternFinder()
{
    this.image=null;
    this.possibleCenters = [];
    this.hasSkipped = false;
    this.crossCheckStateCount = new Array(0,0,0,0,0);
    this.resultPointCallback = null;

    this.getCrossCheckStateCount = function()
    {
        this.crossCheckStateCount[0] = 0;
        this.crossCheckStateCount[1] = 0;
        this.crossCheckStateCount[2] = 0;
        this.crossCheckStateCount[3] = 0;
        this.crossCheckStateCount[4] = 0;
        return this.crossCheckStateCount;
    };

    this.foundPatternCross=function( stateCount)
    {
        var totalModuleSize = 0;
        for (var i = 0; i < 5; i++)
        {
            var count = stateCount[i];
            if (count == 0)
            {
                return false;
            }
            totalModuleSize += count;
        }
        if (totalModuleSize < 7)
        {
            return false;
        }
        var moduleSize = Math.floor(totalModuleSize / 7);
        var maxVariance = Math.floor(moduleSize * 0.7);
        // Allow less than 70% variance from 1-1-3-1-1 proportions
        return Math.abs(moduleSize - stateCount[0]) < maxVariance
            && Math.abs(moduleSize - stateCount[1]) < maxVariance
            && Math.abs(3 * moduleSize - stateCount[2]) < 3 * maxVariance
            && Math.abs(moduleSize - stateCount[3]) < maxVariance
            && Math.abs(moduleSize - stateCount[4]) < maxVariance;
    }
    this.centerFromEnd=function( stateCount,  end)
    {
        return  (end - stateCount[4] - stateCount[3]) - stateCount[2] / 2.0;
    }
    this.crossCheckVertical=function( startI,  centerJ,  maxCount,  originalStateCountTotal)
    {
        var image = this.image;

        var maxI = qrcode.height;
        var stateCount = this.getCrossCheckStateCount();

        // Start counting up from center
        var i = startI;
        while (i >= 0 && image[centerJ + i*qrcode.width])
        {
            stateCount[2]++;
            i--;
        }
        if (i < 0)
        {
            return NaN;
        }
        while (i >= 0 && !image[centerJ +i*qrcode.width] && stateCount[1] <= maxCount)
        {
            stateCount[1]++;
            i--;
        }
        // If already too many modules in this state or ran off the edge:
        if (i < 0 || stateCount[1] > maxCount)
        {
            return NaN;
        }
        while (i >= 0 && image[centerJ + i*qrcode.width] && stateCount[0] <= maxCount)
        {
            stateCount[0]++;
            i--;
        }
        if (stateCount[0] > maxCount)
        {
            return NaN;
        }

        // Now also count down from center
        i = startI + 1;
        while (i < maxI && image[centerJ +i*qrcode.width])
        {
            stateCount[2]++;
            i++;
        }
        if (i == maxI)
        {
            return NaN;
        }
        while (i < maxI && !image[centerJ + i*qrcode.width] && stateCount[3] < maxCount)
        {
            stateCount[3]++;
            i++;
        }
        if (i == maxI || stateCount[3] >= maxCount)
        {
            return NaN;
        }
        while (i < maxI && image[centerJ + i*qrcode.width] && stateCount[4] < maxCount)
        {
            stateCount[4]++;
            i++;
        }
        if (stateCount[4] >= maxCount)
        {
            return NaN;
        }

        // If we found a finder-pattern-like section, but its size is more than 40% different than
        // the original, assume it's a false positive
        var stateCountTotal = stateCount[0] + stateCount[1] + stateCount[2] + stateCount[3] + stateCount[4];
        if (5 * Math.abs(stateCountTotal - originalStateCountTotal) >= 2 * originalStateCountTotal)
        {
            return NaN;
        }

        return this.foundPatternCross(stateCount)?this.centerFromEnd(stateCount, i):NaN;
    }
    this.crossCheckHorizontal=function( startJ,  centerI,  maxCount, originalStateCountTotal)
    {
        var image = this.image;

        var maxJ = qrcode.width;
        var stateCount = this.getCrossCheckStateCount();

        var j = startJ;
        while (j >= 0 && image[j+ centerI*qrcode.width])
        {
            stateCount[2]++;
            j--;
        }
        if (j < 0)
        {
            return NaN;
        }
        while (j >= 0 && !image[j+ centerI*qrcode.width] && stateCount[1] <= maxCount)
        {
            stateCount[1]++;
            j--;
        }
        if (j < 0 || stateCount[1] > maxCount)
        {
            return NaN;
        }
        while (j >= 0 && image[j+ centerI*qrcode.width] && stateCount[0] <= maxCount)
        {
            stateCount[0]++;
            j--;
        }
        if (stateCount[0] > maxCount)
        {
            return NaN;
        }

        j = startJ + 1;
        while (j < maxJ && image[j+ centerI*qrcode.width])
        {
            stateCount[2]++;
            j++;
        }
        if (j == maxJ)
        {
            return NaN;
        }
        while (j < maxJ && !image[j+ centerI*qrcode.width] && stateCount[3] < maxCount)
        {
            stateCount[3]++;
            j++;
        }
        if (j == maxJ || stateCount[3] >= maxCount)
        {
            return NaN;
        }
        while (j < maxJ && image[j+ centerI*qrcode.width] && stateCount[4] < maxCount)
        {
            stateCount[4]++;
            j++;
        }
        if (stateCount[4] >= maxCount)
        {
            return NaN;
        }

        // If we found a finder-pattern-like section, but its size is significantly different than
        // the original, assume it's a false positive
        var stateCountTotal = stateCount[0] + stateCount[1] + stateCount[2] + stateCount[3] + stateCount[4];
        if (5 * Math.abs(stateCountTotal - originalStateCountTotal) >= originalStateCountTotal)
        {
            return NaN;
        }

        return this.foundPatternCross(stateCount)?this.centerFromEnd(stateCount, j):NaN;
    }
    this.handlePossibleCenter=function( stateCount,  i,  j)
    {
        var stateCountTotal = stateCount[0] + stateCount[1] + stateCount[2] + stateCount[3] + stateCount[4];
        var centerJ = this.centerFromEnd(stateCount, j); //float
        var centerI = this.crossCheckVertical(i, Math.floor( centerJ), stateCount[2], stateCountTotal); //float
        if (!isNaN(centerI))
        {
            // Re-cross check
            centerJ = this.crossCheckHorizontal(Math.floor( centerJ), Math.floor( centerI), stateCount[2], stateCountTotal);
            if (!isNaN(centerJ))
            {
                var estimatedModuleSize =   stateCountTotal / 7.0;
                var found = false;
                var max = this.possibleCenters.length;
                for (var index = 0; index < max; index++)
                {
                    var center = this.possibleCenters[index];
                    // Look for about the same center and module size:
                    if (center.aboutEquals(estimatedModuleSize, centerI, centerJ))
                    {
                        center.incrementCount();
                        found = true;
                        break;
                    }
                }
                if (!found)
                {
                    var point = new FinderPattern(centerJ, centerI, estimatedModuleSize);
                    this.possibleCenters.push(point);
                    if (this.resultPointCallback != null)
                    {
                        this.resultPointCallback.foundPossibleResultPoint(point);
                    }
                }
                return true;
            }
        }
        return false;
    }

    this.selectBestPatterns=function()
    {

        var startSize = this.possibleCenters.length;
        if (startSize < 3)
        {
            // Couldn't find enough finder patterns
            throw new Error("QR Error: Couldn't find enough finder patterns (found " + startSize + ")");
        }

        // Filter outlier possibilities whose module size is too different
        if (startSize > 3)
        {
            // But we can only afford to do so if we have at least 4 possibilities to choose from
            var totalModuleSize = 0.0;
            var square = 0.0;
            for (var i = 0; i < startSize; i++)
            {
                //totalModuleSize +=  this.possibleCenters[i].getEstimatedModuleSize();
                var	centerValue=this.possibleCenters[i].getEstimatedModuleSize();
                totalModuleSize += centerValue;
                square += (centerValue * centerValue);
            }
            var average = totalModuleSize /  startSize;
            this.possibleCenters.sort(function(center1,center2) {
                var dA=Math.abs(center2.getEstimatedModuleSize() - average);
                var dB=Math.abs(center1.getEstimatedModuleSize() - average);
                if (dA < dB) {
                    return (-1);
                } else if (dA == dB) {
                    return 0;
                } else {
                    return 1;
                }
            });

            var stdDev = Math.sqrt(square / startSize - average * average);
            var limit = Math.max(0.2 * average, stdDev);
            //for (var i = 0; i < this.possibleCenters.length && this.possibleCenters.length > 3; i++)
            for (var i = this.possibleCenters.length - 1; i >= 0 ; i--)
            {
                var pattern =  this.possibleCenters[i];
                //if (Math.abs(pattern.getEstimatedModuleSize() - average) > 0.2 * average)
                if (Math.abs(pattern.getEstimatedModuleSize() - average) > limit)
                {
                    //this.possibleCenters.remove(i);
                    this.possibleCenters.splice(i,1);
                    //i--;
                }
            }
        }

        if (this.possibleCenters.length > 3)
        {
            // Throw away all but those first size candidate points we found.
            this.possibleCenters.sort(function(a, b){
                if (a.count > b.count){return -1;}
                if (a.count < b.count){return 1;}
                return 0;
            });
        }

        return new Array( this.possibleCenters[0],  this.possibleCenters[1],  this.possibleCenters[2]);
    }

    this.findRowSkip=function()
    {
        var max = this.possibleCenters.length;
        if (max <= 1)
        {
            return 0;
        }
        var firstConfirmedCenter = null;
        for (var i = 0; i < max; i++)
        {
            var center =  this.possibleCenters[i];
            if (center.getCount() >= CENTER_QUORUM)
            {
                if (firstConfirmedCenter == null)
                {
                    firstConfirmedCenter = center;
                }
                else
                {
                    // We have two confirmed centers
                    // How far down can we skip before resuming looking for the next
                    // pattern? In the worst case, only the difference between the
                    // difference in the x / y coordinates of the two centers.
                    // This is the case where you find top left last.
                    this.hasSkipped = true;
                    return Math.floor ((Math.abs(firstConfirmedCenter.getX() - center.getX()) - Math.abs(firstConfirmedCenter.getY() - center.getY())) / 2);
                }
            }
        }
        return 0;
    }

    this.haveMultiplyConfirmedCenters=function()
    {
        var confirmedCount = 0;
        var totalModuleSize = 0.0;
        var max = this.possibleCenters.length;
        for (var i = 0; i < max; i++)
        {
            var pattern =  this.possibleCenters[i];
            if (pattern.getCount() >= CENTER_QUORUM)
            {
                confirmedCount++;
                totalModuleSize += pattern.getEstimatedModuleSize();
            }
        }
        if (confirmedCount < 3)
        {
            return false;
        }
        // OK, we have at least 3 confirmed centers, but, it's possible that one is a "false positive"
        // and that we need to keep looking. We detect this by asking if the estimated module sizes
        // vary too much. We arbitrarily say that when the total deviation from average exceeds
        // 5% of the total module size estimates, it's too much.
        var average = totalModuleSize / max;
        var totalDeviation = 0.0;
        for (var i = 0; i < max; i++)
        {
            pattern = this.possibleCenters[i];
            totalDeviation += Math.abs(pattern.getEstimatedModuleSize() - average);
        }
        return totalDeviation <= 0.05 * totalModuleSize;
    }

    this.findFinderPattern = function(image){
        var tryHarder = false;
        this.image=image;
        var maxI = qrcode.height;
        var maxJ = qrcode.width;
        // Let's assume that the maximum version QR Code we support takes up 1/4 the height of the
        // image, and then account for the center being 3 modules in size. This gives the smallest
        // number of pixels the center could be, so skip this often. When trying harder, look for all
        // QR versions regardless of how dense they are.
        var iSkip = Math.floor((3 * maxI) / (4 * MAX_MODULES));
        if (iSkip < MIN_SKIP || tryHarder)
        {
            iSkip = MIN_SKIP;
        }

        var done = false;
        var stateCount = new Array(5);
        for (var i = iSkip - 1; i < maxI && !done; i += iSkip)
        {
            // Get a row of black/white values
            stateCount[0] = 0;
            stateCount[1] = 0;
            stateCount[2] = 0;
            stateCount[3] = 0;
            stateCount[4] = 0;
            var currentState = 0;
            for (var j = 0; j < maxJ; j++)
            {
                if (image[j+i*qrcode.width] )
                {
                    // Black pixel
                    if ((currentState & 1) == 1)
                    {
                        // Counting white pixels
                        currentState++;
                    }
                    stateCount[currentState]++;
                }
                else
                {
                    // White pixel
                    if ((currentState & 1) == 0)
                    {
                        // Counting black pixels
                        if (currentState == 4)
                        {
                            // A winner?
                            if (this.foundPatternCross(stateCount))
                            {
                                // Yes
                                var confirmed = this.handlePossibleCenter(stateCount, i, j);
                                if (confirmed)
                                {
                                    // Start examining every other line. Checking each line turned out to be too
                                    // expensive and didn't improve performance.
                                    iSkip = 2;
                                    if (this.hasSkipped)
                                    {
                                        done = this.haveMultiplyConfirmedCenters();
                                    }
                                    else
                                    {
                                        var rowSkip = this.findRowSkip();
                                        if (rowSkip > stateCount[2])
                                        {
                                            // Skip rows between row of lower confirmed center
                                            // and top of presumed third confirmed center
                                            // but back up a bit to get a full chance of detecting
                                            // it, entire width of center of finder pattern

                                            // Skip by rowSkip, but back off by stateCount[2] (size of last center
                                            // of pattern we saw) to be conservative, and also back off by iSkip which
                                            // is about to be re-added
                                            i += rowSkip - stateCount[2] - iSkip;
                                            j = maxJ - 1;
                                        }
                                    }
                                }
                                else
                                {
                                    // Advance to next black pixel
                                    do
                                    {
                                        j++;
                                    }
                                    while (j < maxJ && !image[j + i*qrcode.width]);
                                    j--; // back up to that last white pixel
                                }
                                // Clear state to start looking again
                                currentState = 0;
                                stateCount[0] = 0;
                                stateCount[1] = 0;
                                stateCount[2] = 0;
                                stateCount[3] = 0;
                                stateCount[4] = 0;
                            }
                            else
                            {
                                // No, shift counts back by two
                                stateCount[0] = stateCount[2];
                                stateCount[1] = stateCount[3];
                                stateCount[2] = stateCount[4];
                                stateCount[3] = 1;
                                stateCount[4] = 0;
                                currentState = 3;
                            }
                        }
                        else
                        {
                            stateCount[++currentState]++;
                        }
                    }
                    else
                    {
                        // Counting white pixels
                        stateCount[currentState]++;
                    }
                }
            }
            if (this.foundPatternCross(stateCount))
            {
                var confirmed = this.handlePossibleCenter(stateCount, i, maxJ);
                if (confirmed)
                {
                    iSkip = stateCount[0];
                    if (this.hasSkipped)
                    {
                        // Found a third one
                        done = this.haveMultiplyConfirmedCenters();
                    }
                }
            }
        }

        var patternInfo = this.selectBestPatterns();
        qrcode.orderBestPatterns(patternInfo);

        return new FinderPatternInfo(patternInfo);
    };
}
/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


function AlignmentPattern(posX, posY,  estimatedModuleSize)
{
    this.x=posX;
    this.y=posY;
    this.count = 1;
    this.estimatedModuleSize = estimatedModuleSize;

    this.getEstimatedModuleSize = function() {
        return this.estimatedModuleSize;
    };
    this.getCount = function() {
        return this.count;
    };
    this.getX = function() {
        return Math.floor(this.x);
    };
    this.getY = function() {
        return Math.floor(this.y);
    };
    this.incrementCount = function()
    {
        this.count++;
    }
    this.aboutEquals=function( moduleSize,  i,  j)
    {
        if (Math.abs(i - this.y) <= moduleSize && Math.abs(j - this.x) <= moduleSize)
        {
            var moduleSizeDiff = Math.abs(moduleSize - this.estimatedModuleSize);
            return moduleSizeDiff <= 1.0 || moduleSizeDiff / this.estimatedModuleSize <= 1.0;
        }
        return false;
    }

}

function AlignmentPatternFinder( image,  startX,  startY,  width,  height,  moduleSize,  resultPointCallback)
{
    this.image = image;
    this.possibleCenters = new Array();
    this.startX = startX;
    this.startY = startY;
    this.width = width;
    this.height = height;
    this.moduleSize = moduleSize;
    this.crossCheckStateCount = new Array(0,0,0);
    this.resultPointCallback = resultPointCallback;

    this.centerFromEnd=function(stateCount,  end)
    {
        return  (end - stateCount[2]) - stateCount[1] / 2.0;
    }
    this.foundPatternCross = function(stateCount)
    {
        var moduleSize = this.moduleSize;
        var maxVariance = moduleSize / 2.0;
        for (var i = 0; i < 3; i++)
        {
            if (Math.abs(moduleSize - stateCount[i]) >= maxVariance)
            {
                return false;
            }
        }
        return true;
    }

    this.crossCheckVertical=function( startI,  centerJ,  maxCount,  originalStateCountTotal)
    {
        var image = this.image;

        var maxI = qrcode.height;
        var stateCount = this.crossCheckStateCount;
        stateCount[0] = 0;
        stateCount[1] = 0;
        stateCount[2] = 0;

        // Start counting up from center
        var i = startI;
        while (i >= 0 && image[centerJ + i*qrcode.width] && stateCount[1] <= maxCount)
        {
            stateCount[1]++;
            i--;
        }
        // If already too many modules in this state or ran off the edge:
        if (i < 0 || stateCount[1] > maxCount)
        {
            return NaN;
        }
        while (i >= 0 && !image[centerJ + i*qrcode.width] && stateCount[0] <= maxCount)
        {
            stateCount[0]++;
            i--;
        }
        if (stateCount[0] > maxCount)
        {
            return NaN;
        }

        // Now also count down from center
        i = startI + 1;
        while (i < maxI && image[centerJ + i*qrcode.width] && stateCount[1] <= maxCount)
        {
            stateCount[1]++;
            i++;
        }
        if (i == maxI || stateCount[1] > maxCount)
        {
            return NaN;
        }
        while (i < maxI && !image[centerJ + i*qrcode.width] && stateCount[2] <= maxCount)
        {
            stateCount[2]++;
            i++;
        }
        if (stateCount[2] > maxCount)
        {
            return NaN;
        }

        var stateCountTotal = stateCount[0] + stateCount[1] + stateCount[2];
        if (5 * Math.abs(stateCountTotal - originalStateCountTotal) >= 2 * originalStateCountTotal)
        {
            return NaN;
        }

        return this.foundPatternCross(stateCount)?this.centerFromEnd(stateCount, i):NaN;
    }

    this.handlePossibleCenter=function( stateCount,  i,  j)
    {
        var stateCountTotal = stateCount[0] + stateCount[1] + stateCount[2];
        var centerJ = this.centerFromEnd(stateCount, j);
        var centerI = this.crossCheckVertical(i, Math.floor (centerJ), 2 * stateCount[1], stateCountTotal);
        if (!isNaN(centerI))
        {
            var estimatedModuleSize = (stateCount[0] + stateCount[1] + stateCount[2]) / 3.0;
            var max = this.possibleCenters.length;
            for (var index = 0; index < max; index++)
            {
                var center =  this.possibleCenters[index];
                // Look for about the same center and module size:
                if (center.aboutEquals(estimatedModuleSize, centerI, centerJ))
                {
                    return new AlignmentPattern(centerJ, centerI, estimatedModuleSize);
                }
            }
            // Hadn't found this before; save it
            var point = new AlignmentPattern(centerJ, centerI, estimatedModuleSize);
            this.possibleCenters.push(point);
            if (this.resultPointCallback != null)
            {
                this.resultPointCallback.foundPossibleResultPoint(point);
            }
        }
        return null;
    }

    this.find = function()
    {
        var startX = this.startX;
        var height = this.height;
        var maxJ = startX + width;
        var middleI = startY + (height >> 1);
        // We are looking for black/white/black modules in 1:1:1 ratio;
        // this tracks the number of black/white/black modules seen so far
        var stateCount = new Array(0,0,0);
        for (var iGen = 0; iGen < height; iGen++)
        {
            // Search from middle outwards
            var i = middleI + ((iGen & 0x01) == 0?((iGen + 1) >> 1):- ((iGen + 1) >> 1));
            stateCount[0] = 0;
            stateCount[1] = 0;
            stateCount[2] = 0;
            var j = startX;
            // Burn off leading white pixels before anything else; if we start in the middle of
            // a white run, it doesn't make sense to count its length, since we don't know if the
            // white run continued to the left of the start point
            while (j < maxJ && !image[j + qrcode.width* i])
            {
                j++;
            }
            var currentState = 0;
            while (j < maxJ)
            {
                if (image[j + i*qrcode.width])
                {
                    // Black pixel
                    if (currentState == 1)
                    {
                        // Counting black pixels
                        stateCount[currentState]++;
                    }
                    else
                    {
                        // Counting white pixels
                        if (currentState == 2)
                        {
                            // A winner?
                            if (this.foundPatternCross(stateCount))
                            {
                                // Yes
                                var confirmed = this.handlePossibleCenter(stateCount, i, j);
                                if (confirmed != null)
                                {
                                    return confirmed;
                                }
                            }
                            stateCount[0] = stateCount[2];
                            stateCount[1] = 1;
                            stateCount[2] = 0;
                            currentState = 1;
                        }
                        else
                        {
                            stateCount[++currentState]++;
                        }
                    }
                }
                else
                {
                    // White pixel
                    if (currentState == 1)
                    {
                        // Counting black pixels
                        currentState++;
                    }
                    stateCount[currentState]++;
                }
                j++;
            }
            if (this.foundPatternCross(stateCount))
            {
                var confirmed = this.handlePossibleCenter(stateCount, i, maxJ);
                if (confirmed != null)
                {
                    return confirmed;
                }
            }
        }

        // Hmm, nothing we saw was observed and confirmed twice. If we had
        // any guess at all, return it.
        if (!(this.possibleCenters.length == 0))
        {
            return  this.possibleCenters[0];
        }

        throw new Error("QR Error: Couldn't find enough alignment patterns");
    }

}
/*
  Ported to JavaScript by Lazar Laszlo 2011

  lazarsoft@gmail.com, www.lazarsoft.info

*/

/*
*
* Copyright 2007 ZXing authors
*
* Licensed under the Apache License, Version 2.0 (the "License");
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


function QRCodeDataBlockReader(blocks,  version,  numErrorCorrectionCode)
{
    this.blockPointer = 0;
    this.bitPointer = 7;
    this.dataLength = 0;
    this.blocks = blocks;
    this.numErrorCorrectionCode = numErrorCorrectionCode;
    if (version <= 9)
        this.dataLengthMode = 0;
    else if (version >= 10 && version <= 26)
        this.dataLengthMode = 1;
    else if (version >= 27 && version <= 40)
        this.dataLengthMode = 2;

    this.getNextBits = function( numBits)
    {
        var bits = 0;
        if (numBits < this.bitPointer + 1)
        {
            // next word fits into current data block
            var mask = 0;
            for (var i = 0; i < numBits; i++)
            {
                mask += (1 << i);
            }
            mask <<= (this.bitPointer - numBits + 1);

            bits = (this.blocks[this.blockPointer] & mask) >> (this.bitPointer - numBits + 1);
            this.bitPointer -= numBits;
            return bits;
        }
        else if (numBits < this.bitPointer + 1 + 8)
        {
            // next word crosses 2 data blocks
            var mask1 = 0;
            for (var i = 0; i < this.bitPointer + 1; i++)
            {
                mask1 += (1 << i);
            }
            bits = (this.blocks[this.blockPointer] & mask1) << (numBits - (this.bitPointer + 1));
            this.blockPointer++;
            bits += ((this.blocks[this.blockPointer]) >> (8 - (numBits - (this.bitPointer + 1))));

            this.bitPointer = this.bitPointer - numBits % 8;
            if (this.bitPointer < 0)
            {
                this.bitPointer = 8 + this.bitPointer;
            }
            return bits;
        }
        else if (numBits < this.bitPointer + 1 + 16)
        {
            // next word crosses 3 data blocks
            var mask1 = 0; // mask of first block
            var mask3 = 0; // mask of 3rd block
            //bitPointer + 1 : number of bits of the 1st block
            //8 : number of the 2nd block (note that use already 8bits because next word uses 3 data blocks)
            //numBits - (bitPointer + 1 + 8) : number of bits of the 3rd block
            for (var i = 0; i < this.bitPointer + 1; i++)
            {
                mask1 += (1 << i);
            }
            var bitsFirstBlock = (this.blocks[this.blockPointer] & mask1) << (numBits - (this.bitPointer + 1));
            this.blockPointer++;

            var bitsSecondBlock = this.blocks[this.blockPointer] << (numBits - (this.bitPointer + 1 + 8));
            this.blockPointer++;

            for (var i = 0; i < numBits - (this.bitPointer + 1 + 8); i++)
            {
                mask3 += (1 << i);
            }
            mask3 <<= 8 - (numBits - (this.bitPointer + 1 + 8));
            var bitsThirdBlock = (this.blocks[this.blockPointer] & mask3) >> (8 - (numBits - (this.bitPointer + 1 + 8)));

            bits = bitsFirstBlock + bitsSecondBlock + bitsThirdBlock;
            this.bitPointer = this.bitPointer - (numBits - 8) % 8;
            if (this.bitPointer < 0)
            {
                this.bitPointer = 8 + this.bitPointer;
            }
            return bits;
        }
        else
        {
            return 0;
        }
    }
    this.NextMode=function()
    {
        if ((this.blockPointer > this.blocks.length - this.numErrorCorrectionCode - 2))
            return 0;
        else
            return this.getNextBits(4);
    }
    this.getDataLength=function( modeIndicator)
    {
        var index = 0;
        while (true)
        {
            if ((modeIndicator >> index) == 1)
                break;
            index++;
        }

        return this.getNextBits(qrcode.sizeOfDataLengthInfo[this.dataLengthMode][index]);
    }
    this.getRomanAndFigureString=function( dataLength)
    {
        var length = dataLength;
        var intData = 0;
        var strData = "";
        var tableRomanAndFigure = new Array('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', ' ', '$', '%', '*', '+', '-', '.', '/', ':');
        do
        {
            if (length > 1)
            {
                intData = this.getNextBits(11);
                var firstLetter = Math.floor(intData / 45);
                var secondLetter = intData % 45;
                strData += tableRomanAndFigure[firstLetter];
                strData += tableRomanAndFigure[secondLetter];
                length -= 2;
            }
            else if (length == 1)
            {
                intData = this.getNextBits(6);
                strData += tableRomanAndFigure[intData];
                length -= 1;
            }
        }
        while (length > 0);

        return strData;
    }
    this.getFigureString=function( dataLength)
    {
        var length = dataLength;
        var intData = 0;
        var strData = "";
        do
        {
            if (length >= 3)
            {
                intData = this.getNextBits(10);
                if (intData < 100)
                    strData += "0";
                if (intData < 10)
                    strData += "0";
                length -= 3;
            }
            else if (length == 2)
            {
                intData = this.getNextBits(7);
                if (intData < 10)
                    strData += "0";
                length -= 2;
            }
            else if (length == 1)
            {
                intData = this.getNextBits(4);
                length -= 1;
            }
            strData += intData;
        }
        while (length > 0);

        return strData;
    }
    this.get8bitByteArray=function( dataLength)
    {
        var length = dataLength;
        var intData = 0;
        var output = new Array();

        do
        {
            intData = this.getNextBits(8);
            output.push( intData);
            length--;
        }
        while (length > 0);
        return output;
    }
    this.getKanjiString=function( dataLength)
    {
        var length = dataLength;
        var intData = 0;
        var unicodeString = "";
        do
        {
            intData = this.getNextBits(13);
            var lowerByte = intData % 0xC0;
            var higherByte = intData / 0xC0;

            var tempWord = (higherByte << 8) + lowerByte;
            var shiftjisWord = 0;
            if (tempWord + 0x8140 <= 0x9FFC)
            {
                // between 8140 - 9FFC on Shift_JIS character set
                shiftjisWord = tempWord + 0x8140;
            }
            else
            {
                // between E040 - EBBF on Shift_JIS character set
                shiftjisWord = tempWord + 0xC140;
            }

            //var tempByte = new Array(0,0);
            //tempByte[0] = (sbyte) (shiftjisWord >> 8);
            //tempByte[1] = (sbyte) (shiftjisWord & 0xFF);
            //unicodeString += new String(SystemUtils.ToCharArray(SystemUtils.ToByteArray(tempByte)));
            unicodeString += String.fromCharCode(shiftjisWord);
            length--;
        }
        while (length > 0);


        return unicodeString;
    }

    this.parseECIValue = function ()
    {
        var intData = 0;
        var firstByte = this.getNextBits(8);
        if ((firstByte & 0x80) == 0) {
            intData = firstByte & 0x7F;
        }
        if ((firstByte & 0xC0) == 0x80) {
            // two bytes
            var secondByte = this.getNextBits(8);
            intData = ((firstByte & 0x3F) << 8) | secondByte;
        }
        if ((firstByte & 0xE0) == 0xC0) {
            // three bytes
            var secondThirdBytes = this.getNextBits(8);;
            intData = ((firstByte & 0x1F) << 16) | secondThirdBytes;
        }
        return intData;
    }

    this.getDataByte = function()
    {
        var output = new Array();
        var MODE_NUMBER = 1;
        var MODE_ROMAN_AND_NUMBER = 2;
        var MODE_8BIT_BYTE = 4;
        var MODE_ECI = 7;
        var MODE_KANJI = 8;
        do
        {
            var mode = this.NextMode();
            //canvas.println("mode: " + mode);
            if (mode == 0)
            {
                if (output.length > 0)
                    break;
                else
                    throw new Error("QR Error: Empty data block");
            }
            if (mode != MODE_NUMBER && mode != MODE_ROMAN_AND_NUMBER && mode != MODE_8BIT_BYTE && mode != MODE_KANJI && mode != MODE_ECI)
            {
                throw new Error("QR Error: Invalid mode: " + mode + " in (block:" + this.blockPointer + " bit:" + this.bitPointer + ")");
            }

            if(mode == MODE_ECI)
            {
                var temp_sbyteArray3 = this.parseECIValue();
                //output.push(temp_sbyteArray3);
            }
            else
            {

                var dataLength = this.getDataLength(mode);
                if (dataLength < 1)
                    throw new Error("QR Error: Invalid data length: " + dataLength);
                switch (mode)
                {

                    case MODE_NUMBER:
                        var temp_str = this.getFigureString(dataLength);
                        var ta = new Array(temp_str.length);
                        for(var j=0;j<temp_str.length;j++)
                            ta[j]=temp_str.charCodeAt(j);
                        output.push(ta);
                        break;

                    case MODE_ROMAN_AND_NUMBER:
                        var temp_str = this.getRomanAndFigureString(dataLength);
                        var ta = new Array(temp_str.length);
                        for(var j=0;j<temp_str.length;j++)
                            ta[j]=temp_str.charCodeAt(j);
                        output.push(ta );
                        break;

                    case MODE_8BIT_BYTE:
                        var temp_sbyteArray3 = this.get8bitByteArray(dataLength);
                        output.push(temp_sbyteArray3);
                        break;

                    case MODE_KANJI:
                        var temp_str = this.getKanjiString(dataLength);
                        output.push(temp_str);
                        break;
                }
            }
        }
        while (true);
        return output;
    };
}

global.LazloQrReaderLib = qrcode;
