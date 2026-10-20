"""socket (reducido): no hay red en el simulador. Existen las constantes y las excepciones; conectar falla."""
import errno as _errno

AF_UNSPEC = 0
AF_UNIX = 1
AF_INET = 2
AF_INET6 = 10
SOCK_STREAM = 1
SOCK_DGRAM = 2
SOCK_RAW = 3
SOL_SOCKET = 1
SOL_TCP = 6
SO_REUSEADDR = 2
SO_REUSEPORT = 15
SO_KEEPALIVE = 9
SO_BROADCAST = 6
SO_RCVBUF = 8
SO_SNDBUF = 7
IPPROTO_TCP = 6
IPPROTO_UDP = 17
IPPROTO_IPV6 = 41
TCP_NODELAY = 1
SOMAXCONN = 4096
AI_PASSIVE = 1
AI_CANONNAME = 2
AI_NUMERICHOST = 4
NI_NUMERICHOST = 1
NI_NUMERICSERV = 2
SHUT_RD = 0
SHUT_WR = 1
SHUT_RDWR = 2
INADDR_ANY = 0
has_ipv6 = True

error = OSError
timeout = TimeoutError


class herror(OSError):
    pass


class gaierror(OSError):
    pass


def _unreachable():
    raise OSError(_errno.ENETUNREACH, 'Network is unreachable')


class socket:
    def __init__(self, family=AF_INET, type=SOCK_STREAM, proto=0, fileno=None):
        self.family = family
        self.type = type
        self.proto = proto
        self._closed = False
        self._timeout = None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def close(self):
        self._closed = True

    def settimeout(self, value):
        self._timeout = value

    def gettimeout(self):
        return self._timeout

    def setblocking(self, flag):
        self._timeout = None if flag else 0.0

    def setsockopt(self, *args):
        pass

    def getsockopt(self, *args):
        return 0

    def fileno(self):
        return -1 if self._closed else 3

    def connect(self, address):
        _unreachable()

    def connect_ex(self, address):
        return _errno.ENETUNREACH

    def bind(self, address):
        _unreachable()

    def listen(self, backlog=0):
        _unreachable()

    def accept(self):
        _unreachable()

    def send(self, data, flags=0):
        _unreachable()

    sendall = send

    def recv(self, bufsize, flags=0):
        _unreachable()

    def sendto(self, *args):
        _unreachable()

    def recvfrom(self, *args):
        _unreachable()

    def shutdown(self, how):
        pass


SocketType = socket


def gethostname():
    return 'dev-dojo'


def gethostbyname(host):
    if host in ('localhost', '127.0.0.1'):
        return '127.0.0.1'
    raise gaierror(-2, 'Name or service not known')


def getfqdn(name=''):
    return name or 'dev-dojo'


def getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    if host in ('localhost', '127.0.0.1', None):
        return [(AF_INET, type or SOCK_STREAM, proto, '', ('127.0.0.1', port or 0))]
    raise gaierror(-2, 'Name or service not known')


def create_connection(address, timeout=None, source_address=None):
    _unreachable()


def socketpair(*args):
    _unreachable()


def inet_aton(ip):
    parts = ip.split('.')
    if len(parts) != 4:
        raise OSError('illegal IP address string passed to inet_aton')
    return bytes(int(p) for p in parts)


def inet_ntoa(packed):
    return '.'.join(str(b) for b in packed)


def htons(x):
    return ((x & 0xff) << 8) | (x >> 8)


ntohs = htons


def htonl(x):
    return int.from_bytes(x.to_bytes(4, 'big'), 'little')


ntohl = htonl
