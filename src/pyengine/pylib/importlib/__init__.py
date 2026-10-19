"""importlib (versión reducida)."""
import sys
import _imp_support


def import_module(name, package=None):
    if name.startswith('.'):
        if not package:
            raise TypeError("the 'package' argument is required to perform a relative import for " + repr(name))
        level = 0
        for character in name:
            if character != '.':
                break
            level += 1
        base = package.rsplit('.', level - 1)[0]
        name = base + '.' + name[level:] if name[level:] else base
    __import__(name)
    return sys.modules[name]


def reload(module):
    return _imp_support.reload(module)


def invalidate_caches():
    pass
