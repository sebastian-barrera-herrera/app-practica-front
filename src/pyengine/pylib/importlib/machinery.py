SOURCE_SUFFIXES = ['.py']
BYTECODE_SUFFIXES = ['.pyc']
DEBUG_BYTECODE_SUFFIXES = ['.pyc']
OPTIMIZED_BYTECODE_SUFFIXES = ['.pyc']
EXTENSION_SUFFIXES = []


def all_suffixes():
    return SOURCE_SUFFIXES + BYTECODE_SUFFIXES + EXTENSION_SUFFIXES


class ModuleSpec:
    def __init__(self, name, loader, *, origin=None, is_package=None):
        self.name = name
        self.loader = loader
        self.origin = origin
        self.submodule_search_locations = [] if is_package else None
        self.parent = name.rpartition('.')[0]
        self.cached = None
        self.has_location = origin is not None
