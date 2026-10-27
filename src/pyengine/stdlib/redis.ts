/**
 * Cliente `redis` mínimo: habla con los grupos de replicación de ElastiCache del simulador (a través de `_aws`).
 * Solo funciona dentro de una función Lambda; allí aplica las mismas reglas de red que en AWS (VPC, grupo de seguridad, TLS y token).
 * En AWS real el paquete `redis` hay que empaquetarlo con la función (o usar una capa): aquí ya viene incluido.
 */
import { registerPy } from './registry';

const REDIS_EXC = `
class RedisError(Exception):
    pass

class ConnectionError(RedisError):
    pass

class TimeoutError(RedisError):
    pass

class AuthenticationError(ConnectionError):
    pass

class ResponseError(RedisError):
    pass

class DataError(RedisError):
    pass
`;

const REDIS = `
import json as _json
import time as _time
import _aws
from redis import exceptions
from redis.exceptions import RedisError, ConnectionError, TimeoutError, AuthenticationError, ResponseError, DataError


def _call(service, op, params):
    import os
    return _json.loads(_aws.call(service, op, _json.dumps(params), os.environ.get('AWS_REGION', 'us-east-1')))


def _s(v):
    if isinstance(v, (bytes, bytearray)):
        return v.decode('utf-8')
    if isinstance(v, bool):
        return '1' if v else '0'
    if isinstance(v, float):
        return repr(v)
    return str(v)


class Redis:
    def __init__(self, host='localhost', port=6379, db=0, password=None, ssl=False, decode_responses=False, socket_timeout=None, socket_connect_timeout=None, username=None, **kw):
        self.host = host
        self.port = int(port)
        self.password = password
        self.ssl = bool(ssl)
        self.decode_responses = decode_responses
        self.connect_timeout = socket_connect_timeout or socket_timeout
        self._store = None

    @classmethod
    def from_url(cls, url, **kw):
        ssl = url.startswith('rediss://')
        rest = url.split('://', 1)[1]
        password = None
        if '@' in rest:
            cred, rest = rest.rsplit('@', 1)
            password = cred.split(':', 1)[1] if ':' in cred else cred
        hostport = rest.split('/')[0]
        host, _, port = hostport.partition(':')
        return cls(host=host, port=int(port or 6379), password=password, ssl=ssl, **kw)

    def _fail(self, res):
        err = res['__error']
        if res.get('__delay'):
            _time.sleep(res['__delay'] / 1000)
        code = err.get('Code')
        msg = err.get('Message', '')
        if code == 'Timeout':
            raise TimeoutError('Timeout connecting to server')
        if code == 'AuthenticationError':
            raise AuthenticationError(msg)
        if code == 'ResponseError':
            raise ResponseError(msg)
        raise ConnectionError(msg)

    def _connect(self):
        if self._store is not None:
            return
        res = _call('__net', 'connect', {'host': self.host, 'port': self.port, 'ssl': self.ssl, 'password': self.password, 'timeout': self.connect_timeout})
        if '__error' in res:
            self._fail(res)
        self._store = res['store']

    def _cmd(self, name, *args):
        self._connect()
        res = _call('__cache', name, {'store': self._store, 'args': list(args), 'now': int(_time.time() * 1000)})
        if '__error' in res:
            self._fail(res)
        return res.get('r')

    def _out(self, v):
        if v is None or isinstance(v, (bool, int)):
            return v
        if isinstance(v, str):
            return v if self.decode_responses else v.encode('utf-8')
        if isinstance(v, list):
            return [self._out(x) for x in v]
        if isinstance(v, dict):
            return {self._out(k): self._out(x) for k, x in v.items()}
        return v

    def ping(self):
        return self._cmd('ping')

    def set(self, name, value, ex=None, px=None, nx=False, xx=False, keepttl=False):
        if hasattr(ex, 'total_seconds'):
            ex = int(ex.total_seconds())
        return self._cmd('set', _s(name), _s(value), {'ex': ex, 'px': px, 'nx': nx, 'xx': xx, 'keepttl': keepttl})

    def setex(self, name, time, value):
        if hasattr(time, 'total_seconds'):
            time = int(time.total_seconds())
        return self._cmd('set', _s(name), _s(value), {'ex': int(time)})

    def setnx(self, name, value):
        return bool(self._cmd('set', _s(name), _s(value), {'nx': True}))

    def get(self, name):
        return self._out(self._cmd('get', _s(name)))

    def mget(self, keys, *args):
        ks = list(keys) if isinstance(keys, (list, tuple)) else [keys]
        return self._out(self._cmd('mget', *[_s(k) for k in ks + list(args)]))

    def mset(self, mapping):
        for k, v in mapping.items():
            self.set(k, v)
        return True

    def delete(self, *names):
        return self._cmd('delete', *[_s(n) for n in names])

    def exists(self, *names):
        return self._cmd('exists', *[_s(n) for n in names])

    def expire(self, name, time):
        return self._cmd('expire', _s(name), int(time))

    def persist(self, name):
        return self._cmd('persist', _s(name))

    def ttl(self, name):
        return self._cmd('ttl', _s(name))

    def incr(self, name, amount=1):
        return self._cmd('incrby', _s(name), int(amount))

    incrby = incr

    def decr(self, name, amount=1):
        return self._cmd('incrby', _s(name), -int(amount))

    def hset(self, name, key=None, value=None, mapping=None):
        m = dict(mapping or {})
        if key is not None:
            m[key] = value
        return self._cmd('hset', _s(name), {_s(k): _s(v) for k, v in m.items()})

    def hget(self, name, key):
        return self._out(self._cmd('hget', _s(name), _s(key)))

    def hgetall(self, name):
        return self._out(self._cmd('hgetall', _s(name)))

    def hdel(self, name, *keys):
        return self._cmd('hdel', _s(name), *[_s(k) for k in keys])

    def lpush(self, name, *values):
        return self._cmd('push', _s(name), 'left', *[_s(v) for v in values])

    def rpush(self, name, *values):
        return self._cmd('push', _s(name), 'right', *[_s(v) for v in values])

    def lpop(self, name):
        return self._out(self._cmd('pop', _s(name), 'left'))

    def rpop(self, name):
        return self._out(self._cmd('pop', _s(name), 'right'))

    def lrange(self, name, start, end):
        return self._out(self._cmd('lrange', _s(name), int(start), int(end)))

    def llen(self, name):
        return self._cmd('llen', _s(name))

    def sadd(self, name, *values):
        return self._cmd('sadd', _s(name), *[_s(v) for v in values])

    def smembers(self, name):
        return set(self._out(self._cmd('smembers', _s(name))))

    def sismember(self, name, value):
        return self._cmd('sismember', _s(name), _s(value))

    def keys(self, pattern='*'):
        return self._out(self._cmd('keys', _s(pattern)))

    def type(self, name):
        return self._out(self._cmd('type', _s(name)))

    def dbsize(self):
        return self._cmd('dbsize')

    def flushall(self):
        return self._cmd('flushall')

    flushdb = flushall

    def close(self):
        self._store = None

    def pipeline(self, transaction=True):
        return _Pipeline(self)


class _Pipeline:
    def __init__(self, r):
        self._r = r
        self._ops = []

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        fn = getattr(self._r, name)

        def queue(*a, **k):
            self._ops.append((fn, a, k))
            return self

        return queue

    def execute(self):
        out = [fn(*a, **k) for fn, a, k in self._ops]
        self._ops = []
        return out

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


StrictRedis = Redis


def from_url(url, **kw):
    return Redis.from_url(url, **kw)
`;

registerPy('redis', () => REDIS, true);
registerPy('redis.exceptions', () => REDIS_EXC);
