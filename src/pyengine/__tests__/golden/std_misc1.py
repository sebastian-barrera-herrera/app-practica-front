import copy, heapq, bisect, string, textwrap, operator, statistics, fractions, decimal
a = [[1, 2], [3]]
b = copy.copy(a); c = copy.deepcopy(a)
a[0].append(9); print(a, b, c, b[0] is a[0], c[0] is a[0])
class N:
    def __init__(self): self.x = [1]; self.y = {"k": 2}
n = N(); m = copy.deepcopy(n); m.x.append(2); print(n.x, m.x, copy.copy(n).x is n.x)
h = []
for v in [5, 1, 8, 3]: heapq.heappush(h, v)
print(heapq.heappop(h), h, heapq.nsmallest(2, [5, 1, 8, 3]), heapq.nlargest(2, [5, 1, 8, 3]), heapq.heapify(x := [4, 2, 9]), x, heapq.merge([1, 4], [2, 3]).__class__.__name__, list(heapq.merge([1, 4], [2, 3])))
s = [1, 3, 5, 7]
print(bisect.bisect(s, 4), bisect.bisect_left(s, 5), bisect.bisect_right(s, 5), bisect.insort(s, 4), s)
print(string.ascii_lowercase, string.digits, string.punctuation, string.capwords("hola mundo"), string.Template("$a y ${b}").substitute(a=1, b=2), string.hexdigits)
print(textwrap.fill("uno dos tres cuatro cinco seis siete", 15), textwrap.dedent("  a\n   b"), textwrap.shorten("hola mundo cruel", 12), textwrap.indent("a\nb", "> "), textwrap.wrap("abcdefghij", 4))
print(operator.add(1, 2), operator.itemgetter(1)([5, 6]), operator.attrgetter("real")(3), sorted([(1, "b"), (2, "a")], key=operator.itemgetter(1)), operator.mul(3, 4), operator.methodcaller("upper")("a"))
print(statistics.mean([1, 2, 3, 4]), statistics.median([3, 1, 2]), statistics.mode([1, 2, 2, 3]), statistics.stdev([2, 4, 4, 4, 5, 5, 7, 9]), statistics.pvariance([1, 2, 3]), statistics.median([1, 2, 3, 4]), statistics.fmean([1, 2]), statistics.quantiles([1, 2, 3, 4, 5], n=4))
F = fractions.Fraction
print(F(1, 3) + F(1, 6), F(3, 4) * 2, F("0.25"), F(5, 10), float(F(1, 4)), F(7, 2).limit_denominator(2), F(1, 3) < F(1, 2))
D = decimal.Decimal
print(D("0.1") + D("0.2"), D("1.10") * 3, D(1) / D(3), round(D("2.675"), 2), D("10").sqrt(), decimal.getcontext().prec, D("1e3"), D("3.14159").quantize(D("0.01")))
