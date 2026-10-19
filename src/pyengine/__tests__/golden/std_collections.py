from collections import Counter, defaultdict, deque, namedtuple, OrderedDict, ChainMap
c = Counter("abracadabra")
print(c, c.most_common(2), c["a"], c["z"], sum(c.values()), sorted(c.elements())[:5], Counter(a=1) + Counter(a=2, b=1))
d = defaultdict(list)
for k, v in [("a", 1), ("b", 2), ("a", 3)]: d[k].append(v)
print(d, dict(d), d["zz"], len(d), defaultdict(int, x=1))
dq = deque([1, 2, 3], maxlen=4)
dq.append(4); dq.append(5); dq.appendleft(0); dq.rotate(1)
print(dq, dq.popleft(), dq.pop(), list(dq), len(dq), dq.maxlen, deque("abc"), dq[0], 3 in dq)
P = namedtuple("P", "x y")
p = P(1, y=2)
print(p, p.x, p[1], p._asdict(), p._replace(x=9), P._fields, tuple(p), P._make([5, 6]), p == (1, 2))
x, y = p
print(x, y, isinstance(p, tuple), P.__name__)
od = OrderedDict(a=1, b=2)
od.move_to_end("a"); od["c"] = 3
print(od, list(od), od.popitem(last=False), od)
cm = ChainMap({"a": 1}, {"a": 2, "b": 3})
print(cm["a"], cm["b"], dict(cm), list(cm), len(cm))
Point = namedtuple("Point", ["x", "y", "z"], defaults=[0])
print(Point(1, 2), Point._field_defaults)
import collections.abc as abc
print(isinstance([], abc.Sequence), isinstance({}, abc.Mapping), isinstance(iter([]), abc.Iterator), isinstance(5, abc.Hashable), issubclass(list, abc.MutableSequence))
