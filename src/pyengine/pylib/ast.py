"""ast (stub): el intérprete no expone el árbol sintáctico como objetos de Python."""


def parse(*args, **kwargs):
    raise NotImplementedError("El módulo ast no está disponible en este intérprete")


def literal_eval(node_or_string):
    if isinstance(node_or_string, str):
        import re
        s = node_or_string.strip()
        _safe = re.compile(r"^[\s\d\.\,\-\+eE\[\]\{\}\(\)\:'\"A-Za-z_TrueFalseNone]*$")
        if not _safe.match(s):
            raise ValueError(f'malformed node or string: {node_or_string!r}')
        try:
            return eval(s, {"__builtins__": {}}, {"True": True, "False": False, "None": None})
        except Exception:
            raise ValueError(f'malformed node or string: {node_or_string!r}') from None
    raise ValueError(f'malformed node or string: {node_or_string!r}')
