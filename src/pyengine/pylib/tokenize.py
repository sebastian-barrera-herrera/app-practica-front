"""tokenize (stub)."""
import io
from collections import namedtuple

TokenInfo = namedtuple('TokenInfo', 'type string start end line')


class TokenError(Exception):
    pass


def generate_tokens(readline):
    raise NotImplementedError("tokenize no está disponible en este intérprete")


def detect_encoding(readline):
    return 'utf-8', []


def open(filename):
    return io.open(filename, 'r', encoding='utf-8')
