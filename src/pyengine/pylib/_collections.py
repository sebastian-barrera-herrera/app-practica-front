"""Implementación en Python de deque y defaultdict (los tipos en C de CPython)."""
from reprlib import recursive_repr as _recursive_repr
from operator import eq as _eq


class deque:
    """deque([iterable[, maxlen]]) --> deque object

    A list-like sequence optimized for data accesses near its endpoints."""

    def __init__(self, iterable=(), maxlen=None):
        if maxlen is not None:
            if not isinstance(maxlen, int):
                raise TypeError("an integer is required")
            if maxlen < 0:
                raise ValueError("maxlen must be non-negative")
        self._d = []
        self._maxlen = maxlen
        self.extend(iterable)

    @property
    def maxlen(self):
        return self._maxlen

    def _trim_left(self):
        if self._maxlen is not None and len(self._d) > self._maxlen:
            del self._d[:len(self._d) - self._maxlen]

    def _trim_right(self):
        if self._maxlen is not None and len(self._d) > self._maxlen:
            del self._d[self._maxlen:]

    def append(self, x):
        if self._maxlen == 0:
            return
        self._d.append(x)
        self._trim_left()

    def appendleft(self, x):
        if self._maxlen == 0:
            return
        self._d.insert(0, x)
        self._trim_right()

    def extend(self, iterable):
        if iterable is self:
            iterable = list(iterable)
        for x in iterable:
            self.append(x)

    def extendleft(self, iterable):
        if iterable is self:
            iterable = list(iterable)
        for x in iterable:
            self.appendleft(x)

    def pop(self):
        if not self._d:
            raise IndexError("pop from an empty deque")
        return self._d.pop()

    def popleft(self):
        if not self._d:
            raise IndexError("pop from an empty deque")
        return self._d.pop(0)

    def clear(self):
        self._d.clear()

    def copy(self):
        return self.__class__(self._d, self._maxlen)

    __copy__ = copy

    def count(self, x):
        n = 0
        for y in list(self._d):
            if y is x or y == x:
                n += 1
        return n

    def index(self, x, start=0, stop=None):
        n = len(self._d)
        if start < 0:
            start = max(0, start + n)
        if stop is None:
            stop = n
        elif stop < 0:
            stop = max(0, stop + n)
        for i in range(start, min(stop, n)):
            y = self._d[i]
            if y is x or y == x:
                return i
        raise ValueError(f"{x!r} is not in deque")

    def insert(self, i, x):
        if self._maxlen is not None and len(self._d) >= self._maxlen:
            raise IndexError("deque already at its maximum size")
        self._d.insert(i, x)

    def remove(self, value):
        for i, y in enumerate(self._d):
            if y is value or y == value:
                del self._d[i]
                return
        raise ValueError("deque.remove(x): x not in deque")

    def reverse(self):
        self._d.reverse()

    def rotate(self, n=1):
        d = self._d
        if not d:
            return
        n %= len(d)
        if n:
            self._d = d[-n:] + d[:-n]

    def __len__(self):
        return len(self._d)

    def __bool__(self):
        return bool(self._d)

    def __iter__(self):
        return iter(list(self._d))

    def __reversed__(self):
        return reversed(list(self._d))

    def __contains__(self, x):
        for y in list(self._d):
            if y is x or y == x:
                return True
        return False

    def __getitem__(self, i):
        if isinstance(i, slice):
            raise TypeError("sequence index must be integer, not 'slice'")
        try:
            return self._d[i]
        except IndexError:
            raise IndexError("deque index out of range") from None

    def __setitem__(self, i, x):
        try:
            self._d[i] = x
        except IndexError:
            raise IndexError("deque index out of range") from None

    def __delitem__(self, i):
        try:
            del self._d[i]
        except IndexError:
            raise IndexError("deque index out of range") from None

    def __add__(self, other):
        if not isinstance(other, deque):
            raise TypeError(f'can only concatenate deque (not "{type(other).__name__}") to deque')
        r = self.copy()
        r.extend(other)
        return r

    def __iadd__(self, other):
        self.extend(other)
        return self

    def __mul__(self, n):
        r = self.__class__(maxlen=self._maxlen)
        r.extend(self._d * n)
        return r

    __rmul__ = __mul__

    def __imul__(self, n):
        items = self._d * n
        self._d = []
        self.extend(items)
        return self

    def __eq__(self, other):
        if not isinstance(other, deque):
            return NotImplemented
        return self._d == other._d

    def __lt__(self, other):
        if not isinstance(other, deque):
            return NotImplemented
        return self._d < other._d

    def __le__(self, other):
        if not isinstance(other, deque):
            return NotImplemented
        return self._d <= other._d

    def __gt__(self, other):
        if not isinstance(other, deque):
            return NotImplemented
        return self._d > other._d

    def __ge__(self, other):
        if not isinstance(other, deque):
            return NotImplemented
        return self._d >= other._d

    __hash__ = None

    @_recursive_repr('[...]')
    def __repr__(self):
        if self._maxlen is None:
            return f"{type(self).__name__}({list(self._d)!r})"
        return f"{type(self).__name__}({list(self._d)!r}, maxlen={self._maxlen})"

    def __reduce__(self):
        return type(self), (list(self._d), self._maxlen)

    def __sizeof__(self):
        return 624 + 8 * len(self._d)

    def __class_getitem__(cls, item):
        from types import GenericAlias
        return GenericAlias(cls, item)


class defaultdict(dict):
    """defaultdict(default_factory=None, /, [...]) --> dict with default factory"""

    def __init__(self, default_factory=None, /, *args, **kwargs):
        if default_factory is not None and not callable(default_factory):
            raise TypeError("first argument must be callable or None")
        super().__init__(*args, **kwargs)
        self.default_factory = default_factory

    def __missing__(self, key):
        if self.default_factory is None:
            raise KeyError(key)
        value = self.default_factory()
        self[key] = value
        return value

    def __repr__(self):
        f = self.default_factory
        if f is None:
            fr = 'None'
        elif isinstance(f, type):
            fr = repr(f)
        else:
            fr = repr(f)
        return f"{type(self).__name__}({fr}, {dict.__repr__(self)})"

    def copy(self):
        return type(self)(self.default_factory, self)

    __copy__ = copy

    def __reduce__(self):
        return type(self), (self.default_factory,), None, None, iter(self.items())

    def __or__(self, other):
        if not isinstance(other, dict):
            return NotImplemented
        new = self.copy()
        new.update(other)
        return new

    def __ror__(self, other):
        if not isinstance(other, dict):
            return NotImplemented
        new = type(self)(self.default_factory, other)
        new.update(self)
        return new


def _count_elements(mapping, iterable):
    mapping_get = mapping.get
    for elem in iterable:
        mapping[elem] = mapping_get(elem, 0) + 1
