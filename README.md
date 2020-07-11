## Qr library comparison

This repository compares performance of the qr scanner libraries github.com/zxing-js/library, github.com/cozmo/jsQR and github.com/LazarSoft/jsqrcode.

The test suite is forked from the zxing library.

The results are contained in `result.txt`.

For jsqrcode even an imrpoved version from https://github.com/nimiq/qr-scanner/tree/540030c81fdeef0cd053dd7d6a0012438755df2a is used. Still it performs the worst.

For the cozmo/jsQR scanner, two versions are tested: the original and an improved version from https://github.com/danimoh/jsQR.

To run the tests yourself, run `yarn test`.

I case you are searching for a QR scanning library for scanning from a device's camera: https://github.com/nimiq/qr-scanner which is built on top of the improved jsQR scanner might be for you.
