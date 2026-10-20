"""linecache: líneas de código fuente del programa (main.py, <stdin>…) y de archivos del sistema virtual."""
import sys

__all__ = ["getline", "clearcache", "checkcache", "lazycache"]

cache = {}


def clearcache():
    cache.clear()


def getlines(filename, module_globals=None):
    src = sys._getsource(filename)
    if src is not None:
        return src
    if filename in cache:
        return cache[filename][2]
    try:
        with open(filename, 'r', encoding='utf-8') as fp:
            lines = fp.readlines()
    except (OSError, UnicodeDecodeError):
        return []
    if lines and not lines[-1].endswith('\n'):
        lines[-1] += '\n'
    cache[filename] = (len(''.join(lines)), None, lines, filename)
    return lines


def getline(filename, lineno, module_globals=None):
    lines = getlines(filename, module_globals)
    if 1 <= lineno <= len(lines):
        return lines[lineno - 1]
    return ''


def checkcache(filename=None):
    pass


def updatecache(filename, module_globals=None):
    return getlines(filename, module_globals)


def lazycache(filename, module_globals):
    return False


def _getlines_from_code(code):
    return getlines(code.co_filename)


def _getline_from_code(code, lineno):
    lines = _getlines_from_code(code)
    if 1 <= lineno <= len(lines):
        return lines[lineno - 1]
    return ''


def _register_code(code, string, name):
    pass
