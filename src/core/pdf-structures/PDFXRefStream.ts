import add from 'lodash/add';
import dropRight from 'lodash/dropRight';
import flatten from 'lodash/flatten';
import last from 'lodash/last';
import max from 'lodash/max';
import padStart from 'lodash/padStart';

import { PDFObjectIndex } from 'core/pdf-document';
import {
  PDFArray,
  PDFDictionary,
  PDFIndirectObject,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFStream,
} from 'core/pdf-objects';
import { addStringToBuffer, digits, or } from 'utils';
import { isInstance, validate, validateArr } from 'utils/validate';

class PDFXRefStream extends PDFStream {
  static create = (index: PDFObjectIndex) =>
    new PDFXRefStream(
      new PDFDictionary(
        { Type: PDFName.from('XRef'), Filter: PDFName.from('ASCIIHexDecode') },
        index,
      ),
    );

  private entries: Array<[number, number, number]> = [];

  constructor(dictionary: PDFDictionary) {
    super(dictionary);
  }

  addFreeObjectEntry = (nextFreeObjectNum: number, generationNum: number) => {
    this.entries.push([0, nextFreeObjectNum, generationNum]);
  };

  addUncompressedObjectEntry = (byteOffset: number, generationNum: number) => {
    this.entries.push([1, byteOffset, generationNum]);
  };

  addCompressedObjectEntry = (objectStreamNum: number, index: number) => {
    this.entries.push([2, objectStreamNum, index]);
  };

  bytesSize = (): number => {
    this.updateDictionary();
    return (
      this.dictionary.bytesSize() +
      1 + // "\n"
      7 + // "stream\n"
      this.entriesToString().length +
      10 // \nendstream
    );
  };

  copyBytesInto = (buffer: Uint8Array): Uint8Array => {
    this.updateDictionary();
    this.validateDictionary();

    let remaining = this.dictionary.copyBytesInto(buffer);
    remaining = addStringToBuffer('\nstream\n', remaining);
    remaining = addStringToBuffer(this.entriesToString(), remaining);
    remaining = addStringToBuffer('\nendstream', remaining);
    return remaining;
  };

  private entriesToString = (): string => {
    const entryWidths = this.maxEntryByteWidths().map((w) => w * 2);
    return this.entries
      .map(([first, second, third]) =>
        [
          padStart(first.toString(16).toUpperCase(), entryWidths[0], '0'),
          padStart(second.toString(16).toUpperCase(), entryWidths[1], '0'),
          padStart(third.toString(16).toUpperCase(), entryWidths[2], '0'),
        ].join(' '),
      )
      .join('\n');
  };

  private maxEntryByteWidths = (): [number, number, number] => [
    Math.ceil(max(this.entries.map(([x]) => x))!.toString(2).length / 8),
    Math.ceil(max(this.entries.map(([, x]) => x))!.toString(2).length / 8),
    Math.ceil(max(this.entries.map(([, , x]) => x))!.toString(2).length / 8),
  ];

  private updateDictionary = () => {
    this.dictionary.set(
      PDFName.from('W'),
      PDFArray.fromArray(
        this.maxEntryByteWidths().map(PDFNumber.fromNumber),
        this.dictionary.index,
      ),
    );
    this.dictionary.set(
      PDFName.from('Length'),
      PDFNumber.fromNumber(this.entriesToString().length),
    );
  };
}

export default PDFXRefStream;
