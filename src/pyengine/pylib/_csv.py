"""Implementación en Python del módulo C `_csv` (reader, writer, dialectos)."""
__version__ = "1.0"

QUOTE_MINIMAL, QUOTE_ALL, QUOTE_NONNUMERIC, QUOTE_NONE, QUOTE_STRINGS, QUOTE_NOTNULL = range(6)


class Error(Exception):
    pass


_dialects = {}
_field_limit = 131072


def field_size_limit(*args):
    global _field_limit
    old = _field_limit
    if args:
        _field_limit = args[0]
    return old


class Dialect:
    _valid = True
    delimiter = ','
    quotechar = '"'
    escapechar = None
    doublequote = True
    skipinitialspace = False
    lineterminator = '\r\n'
    quoting = QUOTE_MINIMAL
    strict = False

    def __init__(self, dialect=None, **kwargs):
        d = {}
        if dialect is not None:
            if isinstance(dialect, str):
                dialect = get_dialect(dialect)
            for a in ('delimiter', 'doublequote', 'escapechar', 'lineterminator', 'quotechar', 'quoting',
                      'skipinitialspace', 'strict'):
                if hasattr(dialect, a):
                    d[a] = getattr(dialect, a)
        d.update(kwargs)
        for a in ('delimiter', 'doublequote', 'escapechar', 'lineterminator', 'quotechar', 'quoting',
                  'skipinitialspace', 'strict'):
            setattr(self, a, d.get(a, getattr(type(self), a)))
        if not isinstance(self.delimiter, str) or len(self.delimiter) != 1:
            if not isinstance(self.delimiter, str):
                raise TypeError('"delimiter" must be a unicode character, not ' + type(self.delimiter).__name__)
            raise TypeError('"delimiter" must be a 1-character string')
        if self.quotechar is not None and (not isinstance(self.quotechar, str) or len(self.quotechar) != 1):
            if self.quoting != QUOTE_NONE or self.quotechar is not None:
                raise TypeError('"quotechar" must be a 1-character string')
        if self.quoting != QUOTE_NONE and self.quotechar is None:
            raise TypeError("quotechar must be set if quoting enabled")
        if not isinstance(self.lineterminator, str):
            raise TypeError('"lineterminator" must be a string')


def register_dialect(name, dialect=None, **kwargs):
    if not isinstance(name, str):
        raise TypeError("dialect name must be a string")
    _dialects[name] = Dialect(dialect, **kwargs)


def unregister_dialect(name):
    try:
        del _dialects[name]
    except KeyError:
        raise Error("unknown dialect") from None


def get_dialect(name):
    try:
        return _dialects[name]
    except KeyError:
        raise Error("unknown dialect") from None


def list_dialects():
    return list(_dialects)


class reader:
    def __init__(self, iterable, dialect='excel', **kwargs):
        self._it = iter(iterable)
        self.dialect = Dialect(dialect, **kwargs)
        self.line_num = 0

    def __iter__(self):
        return self

    def __next__(self):
        d = self.dialect
        fields = []
        field = []
        in_quotes = False
        state = 'START'   # START, IN_FIELD, IN_QUOTED, QUOTE_IN_QUOTED, ESCAPED
        escaped_from = None
        was_quoted = False
        first = True
        while True:
            try:
                line = next(self._it)
            except StopIteration:
                if not first:
                    if state == 'IN_QUOTED' and d.strict:
                        raise Error("unexpected end of data")
                    break
                raise
            first = False
            self.line_num += 1
            if not isinstance(line, str):
                raise Error("iterator should return strings, not %s (the file should be opened in text mode)" % type(line).__name__)
            i = 0
            n = len(line)
            while i < n:
                c = line[i]
                if state == 'START':
                    if c in '\r\n':
                        break
                    if c == d.quotechar and d.quoting != QUOTE_NONE:
                        state = 'IN_QUOTED'
                        was_quoted = True
                    elif c == d.delimiter:
                        fields.append(self._finish(field, was_quoted))
                        field = []
                        was_quoted = False
                    elif c == d.escapechar:
                        state = 'ESCAPED'
                        escaped_from = 'IN_FIELD'
                    elif c == ' ' and d.skipinitialspace:
                        pass
                    else:
                        field.append(c)
                        state = 'IN_FIELD'
                elif state == 'IN_FIELD':
                    if c in '\r\n':
                        break
                    if c == d.delimiter:
                        fields.append(self._finish(field, was_quoted))
                        field = []
                        was_quoted = False
                        state = 'START'
                    elif c == d.escapechar:
                        state = 'ESCAPED'
                        escaped_from = 'IN_FIELD'
                    else:
                        field.append(c)
                elif state == 'IN_QUOTED':
                    if c == d.escapechar and d.escapechar is not None:
                        state = 'ESCAPED'
                        escaped_from = 'IN_QUOTED'
                    elif c == d.quotechar and d.quoting != QUOTE_NONE:
                        if d.doublequote:
                            state = 'QUOTE_IN_QUOTED'
                        else:
                            state = 'IN_FIELD'
                    else:
                        field.append(c)
                elif state == 'QUOTE_IN_QUOTED':
                    if c == d.quotechar:
                        field.append(c)
                        state = 'IN_QUOTED'
                    elif c == d.delimiter:
                        fields.append(self._finish(field, was_quoted))
                        field = []
                        was_quoted = False
                        state = 'START'
                    elif c in '\r\n':
                        break
                    elif not d.strict:
                        field.append(c)
                        state = 'IN_FIELD'
                    else:
                        raise Error("'%c' expected after '%c'" % (d.delimiter, d.quotechar))
                elif state == 'ESCAPED':
                    field.append(c)
                    state = escaped_from
                i += 1
            if state == 'IN_QUOTED' or (state == 'ESCAPED' and escaped_from == 'IN_QUOTED'):
                if state == 'ESCAPED':
                    field.append('\n')
                    state = 'IN_QUOTED'
                else:
                    field.append('\n')
                continue
            break
        if state == 'START' and not fields and not field and not was_quoted:
            return []
        fields.append(self._finish(field, was_quoted))
        return fields

    def _finish(self, field, was_quoted):
        s = ''.join(field)
        if len(s) > _field_limit:
            raise Error("field larger than field limit (%d)" % _field_limit)
        if self.dialect.quoting == QUOTE_NONNUMERIC and not was_quoted and s != '':
            return float(s)
        if self.dialect.quoting == QUOTE_NOTNULL and not was_quoted and s == '':
            return None
        return s


class writer:
    def __init__(self, fileobj, dialect='excel', **kwargs):
        self._write = fileobj.write
        self.dialect = Dialect(dialect, **kwargs)

    def _quote(self, field, first, nrow):
        d = self.dialect
        if field is None:
            s = ''
            quoted = d.quoting == QUOTE_NOTNULL or (d.quoting == QUOTE_ALL)
            if d.quoting == QUOTE_NOTNULL:
                quoted = False
        else:
            s = field if isinstance(field, str) else str(field)
            quoted = False
        if d.quoting == QUOTE_ALL:
            quoted = True
        elif d.quoting == QUOTE_STRINGS and isinstance(field, str):
            quoted = True
        elif d.quoting == QUOTE_NONNUMERIC and not isinstance(field, (int, float)):
            quoted = True
        elif d.quoting == QUOTE_NOTNULL and field is not None:
            quoted = True
        out = []
        need = False
        for c in s:
            if c == d.delimiter or c == d.escapechar or c == d.quotechar or c in '\r\n' or (d.lineterminator and c in d.lineterminator):
                if d.quoting == QUOTE_NONE:
                    if d.escapechar is None:
                        raise Error("need to escape, but no escapechar set")
                    out.append(d.escapechar)
                    out.append(c)
                    continue
                if c == d.quotechar:
                    if d.doublequote:
                        out.append(d.quotechar)
                    elif d.escapechar is not None:
                        out.append(d.escapechar)
                    else:
                        raise Error("need to escape, but no escapechar set")
                need = True
            out.append(c)
        text = ''.join(out)
        if s == '' and nrow == 1 and first and d.quoting != QUOTE_NONE:
            need = True
        if (need or quoted) and d.quoting != QUOTE_NONE:
            text = d.quotechar + text + d.quotechar
        return text

    def writerow(self, row):
        try:
            fields = list(row)
        except TypeError:
            raise Error("iterable expected, not %s" % type(row).__name__) from None
        parts = [self._quote(f, i == 0, len(fields)) for i, f in enumerate(fields)]
        return self._write(self.dialect.delimiter.join(parts) + self.dialect.lineterminator)

    def writerows(self, rows):
        for r in rows:
            self.writerow(r)


class _excel(Dialect):
    pass


register_dialect('excel', _excel)
