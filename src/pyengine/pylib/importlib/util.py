import sys
from importlib.machinery import ModuleSpec


def find_spec(name, package=None):
    if name in sys.modules:
        m = sys.modules[name]
        return getattr(m, '__spec__', None) or ModuleSpec(name, None, origin=getattr(m, '__file__', None))
    try:
        __import__(name)
    except ImportError:
        return None
    m = sys.modules[name]
    return ModuleSpec(name, None, origin=getattr(m, '__file__', None))


def spec_from_file_location(name, location=None, *, loader=None, submodule_search_locations=None):
    return ModuleSpec(name, loader, origin=location)


def module_from_spec(spec):
    import types
    m = types.ModuleType(spec.name)
    m.__spec__ = spec
    return m
