"""codecs (versión reducida)."""
from collections import namedtuple
import io as _io

BOM_UTF8 = b'\xef\xbb\xbf'
BOM_LE = BOM_UTF16_LE = b'\xff\xfe'
BOM_BE = BOM_UTF16_BE = b'\xfe\xff'
BOM_UTF16 = BOM_LE
BOM_UTF32_LE = b'\xff\xfe\x00\x00'
BOM_UTF32_BE = b'\x00\x00\xfe\xff'
BOM_UTF32 = BOM_UTF32_LE
BOM = BOM_UTF16

_NAMES = {'utf8': 'utf-8', 'utf_8': 'utf-8', 'u8': 'utf-8', 'utf': 'utf-8', 'ascii': 'ascii', 'us_ascii': 'ascii',
          'latin1': 'latin-1', 'latin_1': 'latin-1', 'iso8859_1': 'latin-1', 'iso_8859_1': 'latin-1', 'l1': 'latin-1',
          'cp1252': 'cp1252', 'windows_1252': 'cp1252'}

CodecInfo = namedtuple('CodecInfo', 'encode decode streamreader streamwriter incrementalencoder incrementaldecoder name')


def lookup(encoding):
    key = encoding.lower().replace('-', '_').replace(' ', '_')
    name = _NAMES.get(key)
    if name is None:
        raise LookupError("unknown encoding: " + encoding)
    return CodecInfo(lambda s, errors='strict': (s.encode(name, errors), len(s)),
                     lambda b, errors='strict': (bytes(b).decode(name, errors), len(b)),
                     None, None, None, None, name)


def encode(obj, encoding='utf-8', errors='strict'):
    return obj.encode(encoding, errors)


def decode(obj, encoding='utf-8', errors='strict'):
    return bytes(obj).decode(encoding, errors)


def getencoder(encoding):
    return lookup(encoding).encode


def getdecoder(encoding):
    return lookup(encoding).decode


def open(filename, mode='r', encoding=None, errors='strict', buffering=-1):
    return _io.open(filename, mode, encoding=encoding, errors=errors)


def register(search_function):
    pass


def register_error(name, handler):
    pass


def lookup_error(name):
    raise LookupError("unknown error handler name %r" % name)


def getincrementaldecoder(encoding):
    raise NotImplementedError


def getincrementalencoder(encoding):
    raise NotImplementedError
