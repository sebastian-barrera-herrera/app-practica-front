import doctest, pickle, shlex, configparser, ipaddress, html, platform, io
from urllib.parse import urlparse, parse_qs, urlencode, quote, unquote, urljoin
from html.parser import HTMLParser

def add(a, b):
    """
    >>> add(1, 2)
    3
    >>> add("a", "b")
    'ab'
    >>> add(1, 2)
    4
    """
    return a + b

print(doctest.testmod())

class P:
    def __init__(self, x, y):
        self.x, self.y = x, y
    def __eq__(self, o):
        return (self.x, self.y) == (o.x, o.y)
data = {"a": [1, 2.5, (3, "x")], "b": {1, 2}, "c": None, "p": P(1, 2), "bytes": b"\x00\x01", "big": 2**100, "f": frozenset([1])}
for proto in (0, 2, 4, 5):
    s = pickle.dumps(data, protocol=proto)
    back = pickle.loads(s)
    print(proto, back == data, len(s) > 10)
print(pickle.dumps([1, 2, 3], protocol=0), pickle.dumps("hola", protocol=4))
print(pickle.loads(pickle.dumps(P(3, 4))).x)

print(shlex.split('a "b c" d\\ e \'f g\''), shlex.quote("it's"), shlex.join(["a b", "c"]))
cp = configparser.ConfigParser()
cp.read_string("[main]\nname = dojo\nn = 3\n[other]\nk: v\n")
print(cp.sections(), cp["main"]["name"], cp.getint("main", "n"), dict(cp["other"]))
buf = io.StringIO()
cp.write(buf)
print(repr(buf.getvalue()))
ip = ipaddress.ip_address("192.168.1.10")
net = ipaddress.ip_network("192.168.1.0/28")
print(ip, ip.is_private, ip in net, net.num_addresses, list(net.hosts())[:2], ipaddress.ip_address("::1").version)
u = urlparse("https://user@example.com:8080/a/b?x=1&y=2#frag")
print(u, u.netloc, parse_qs(u.query), urlencode({"a": 1, "b": "x y"}), quote("a b/ñ"), unquote("%C3%B1"), urljoin("http://a/b/c", "../d"))
print(html.escape("<a href='x'>&</a>"), html.unescape("&lt;&amp;&#65;&eacute;"))
class H(HTMLParser):
    def handle_starttag(self, tag, attrs): print("start", tag, attrs)
    def handle_endtag(self, tag): print("end", tag)
    def handle_data(self, d): print("data", repr(d))
H().feed("<p class='a'>hi <b>there</b></p>")
print(platform.system())
