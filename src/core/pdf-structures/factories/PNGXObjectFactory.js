/* @flow */
import PNG from 'png-js';
import pako from 'pako';

import PDFDocument from 'core/pdf-document/PDFDocument';
import {
  PDFDictionary,
  PDFName,
  PDFArray,
  PDFNumber,
  PDFRawStream,
  PDFIndirectReference,
} from 'core/pdf-objects';
import { validate, isInstance } from 'utils/validate';

const { Buffer } = require('buffer/');

/**
A note of thanks to the developers of https://github.com/devongovett/pdfkit, as
this class borrows heavily from:
https://github.com/devongovett/pdfkit/blob/e71edab0dd4657b5a767804ba86c94c58d01fbca/lib/image/png.coffee
*/
class PNGXObjectFactory {
  image: PNG;
  width: number;
  height: number;
  imgData: Uint8Array;
  alphaChannel: Uint8Array;

  xObjDict: PDFDictionary;
  document: PDFDocument;

  constructor(data: Uint8Array) {
    validate(
      data,
      isInstance(Uint8Array),
      '"data" must be an instance of Uint8Array',
    );

    // This has to work in browser & Node JS environments. And, unfortunately,
    // the "png.js" package makes use of Node "Buffer" objects, instead of
    // standard JS typed arrays, so for now we'll just use the "buffer" package
    // to convert the "data" to a "Buffer" object that "png.js" can work with.
    const dataBuffer = Buffer.from(data);

    this.image = new PNG(dataBuffer);
    this.width = this.image.width;
    this.height = this.image.height;
    this.imgData = this.image.imgData;
  }

  static for = (data: Uint8Array) => new PNGXObjectFactory(data);

  embedImageIn = (
    document: PDFDocument,
  ): PDFIndirectReference<PDFRawStream> => {
    this.document = document;
    this.xObjDict = PDFDictionary.from({
      Type: PDFName.from('XObject'),
      Subtype: PDFName.from('Image'),
      BitsPerComponent: PDFNumber.fromNumber(this.image.bits),
      Width: PDFNumber.fromNumber(this.width),
      Height: PDFNumber.fromNumber(this.height),
      Filter: PDFName.from('FlateDecode'),
    });

    if (!this.image.hasAlphaChannel) {
      const params = PDFDictionary.from({
        Predictor: PDFNumber.fromNumber(15),
        Colors: PDFNumber.fromNumber(this.image.colors),
        BitsPerComponent: PDFNumber.fromNumber(this.image.bits),
        Columns: PDFNumber.fromNumber(this.width),
      });
      this.xObjDict.set('DecodeParms', params);
    }

    if (this.image.palette.length === 0) {
      this.xObjDict.set('ColorSpace', PDFName.from(this.image.colorSpace));
    } else {
      const paletteStream = document.register(
        PDFRawStream.from(
          PDFDictionary.from({
            Length: PDFNumber.fromNumber(this.image.palette.length),
          }),
          new Uint8Array(this.image.palette),
        ),
      );
      this.xObjDict.set(
        'ColorSpace',
        PDFArray.fromArray([
          PDFName.from('Indexed'),
          PDFName.from('DeviceRGB'),
          PDFNumber.fromNumber(this.image.palette.length / 3 - 1),
          paletteStream,
        ]),
      );
    }

    // TODO: Handle the following two transparency types. They don't seem to be
    // fully handled in https://github.com/devongovett/pdfkit/blob/e71edab0dd4657b5a767804ba86c94c58d01fbca/lib/image/png.coffee
    // if (this.image.transparency.grayscale)
    // if (this.image.transparency.rgb)

    /* eslint-disable prettier/prettier */
    return (
        this.image.transparency.indexed ? this.loadIndexedAlphaChannel()
      : this.image.hasAlphaChannel      ? this.splitAlphaChannel()
      : this.finalize()
    );
    /* eslint-enable prettier/prettier */
  };

  finalize = () => {
    if (this.alphaChannel) {
      const alphaStreamDict = PDFDictionary.from({
        Type: PDFName.from('XObject'),
        Subtype: PDFName.from('Image'),
        Height: PDFNumber.fromNumber(this.height),
        Width: PDFNumber.fromNumber(this.width),
        BitsPerComponent: PDFNumber.fromNumber(8),
        Filter: PDFName.from('FlateDecode'),
        ColorSpace: PDFName.from('DeviceGray'),
        Decode: PDFArray.fromArray([
          PDFNumber.fromNumber(0),
          PDFNumber.fromNumber(1),
        ]),
        Length: PDFNumber.fromNumber(this.alphaChannel.length),
      });
      const smaskStream = this.document.register(
        PDFRawStream.from(alphaStreamDict, pako.deflate(this.alphaChannel)),
      );
      this.xObjDict.set('SMask', smaskStream);
    }

    this.xObjDict.set('Length', PDFNumber.fromNumber(this.imgData.length));
    const xObj = this.document.register(
      PDFRawStream.from(this.xObjDict, this.imgData),
    );
    return xObj;
  };

  splitAlphaChannel = () => {
    const pixels = this.image.decodePixelsSync();
    const colorByteSize = this.image.colors * this.image.bits / 8;
    const pixelCount = this.image.width * this.image.height;
    this.imgData = new Uint8Array(pixelCount * colorByteSize);
    this.alphaChannel = new Uint8Array(pixelCount);
    let i = 0;
    let p = 0;
    let a = 0;
    while (i < pixels.length) {
      this.imgData[p++] = pixels[i++];
      this.imgData[p++] = pixels[i++];
      this.imgData[p++] = pixels[i++];
      this.alphaChannel[a++] = pixels[i++];
    }
    this.imgData = pako.deflate(this.imgData);
    return this.finalize();
  };

  loadIndexedAlphaChannel = () => {
    const transparency = this.image.transparency.indexed;
    const pixels = this.image.decodePixelsSync();
    this.alphaChannel = new Uint8Array(this.width * this.height);
    pixels.forEach((pixel, idx) => {
      this.alphaChannel[idx] = transparency[pixel];
    });
    return this.finalize();
  };
}

export default PNGXObjectFactory;