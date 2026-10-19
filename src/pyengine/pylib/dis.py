"""dis (mínimo): solo lo que necesita inspect."""
COMPILER_FLAG_NAMES = {
    1: "OPTIMIZED", 2: "NEWLOCALS", 4: "VARARGS", 8: "VARKEYWORDS", 16: "NESTED", 32: "GENERATOR", 64: "NOFREE",
    128: "COROUTINE", 256: "ITERABLE_COROUTINE", 512: "ASYNC_GENERATOR",
}


def dis(*args, **kwargs):
    raise NotImplementedError("dis no está disponible: este intérprete no usa bytecode")


def show_code(*args, **kwargs):
    dis()


def get_instructions(*args, **kwargs):
    dis()
