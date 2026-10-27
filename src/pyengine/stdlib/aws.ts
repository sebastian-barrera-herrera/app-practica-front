/**
 * `boto3` y `botocore` mínimos para las funciones Lambda del simulador de AWS.
 *
 * El módulo nativo `_aws` llama a `awsBridge.call`, que rellena el motor de AWS mientras ejecuta una función Lambda.
 * Fuera de Lambda no hay credenciales: `boto3.client(...)` falla como en un portátil sin configurar.
 */
import type { Interp } from '../runtime/interp';
import type { PyModule } from '../runtime/objects';
import { mfn } from './helpers';
import { registerNative, registerPy } from './registry';

export const awsBridge: { call: ((service: string, op: string, params: string, region: string) => string) | null } = { call: null };

registerNative('_aws', (_I: Interp, m: PyModule) => {
  mfn(m, 'call', 'service, op, params, region, /', (service: string, op: string, params: string, region: string) => {
    if (!awsBridge.call) return JSON.stringify({ __error: { Code: 'NoCredentialsError', Message: 'Unable to locate credentials' } });
    return awsBridge.call(String(service), String(op), String(params), String(region));
  });
  mfn(m, 'available', '', () => awsBridge.call !== null);
});

const BOTOCORE_EXC = `
class BotoCoreError(Exception):
    pass

class NoCredentialsError(BotoCoreError):
    def __init__(self, **kw):
        super().__init__('Unable to locate credentials')

class EndpointConnectionError(BotoCoreError):
    def __init__(self, msg=''):
        super().__init__(msg)

class ParamValidationError(BotoCoreError):
    def __init__(self, report=''):
        super().__init__('Parameter validation failed:\\n' + str(report))

class ClientError(Exception):
    def __init__(self, error_response, operation_name):
        self.response = error_response
        self.operation_name = operation_name
        err = error_response.get('Error', {})
        super().__init__('An error occurred (%s) when calling the %s operation: %s' % (err.get('Code', 'Unknown'), operation_name, err.get('Message', '')))
`;

const BOTOCORE_CONFIG = `
class Config:
    def __init__(self, **kw):
        self.__dict__.update(kw)
`;

const BOTO3 = `
import json as _json
import _aws
from decimal import Decimal as _Decimal
from botocore.exceptions import ClientError, NoCredentialsError, ParamValidationError

__version__ = '1.35.0'

_CLI = {'s3': 's3api', 'cognito-idp': 'cognito-idp', 'stepfunctions': 'stepfunctions', 'states': 'stepfunctions', 'codedeploy': 'deploy'}


class StreamingBody:
    def __init__(self, data):
        self._d = data if isinstance(data, bytes) else str(data).encode('utf-8')

    def read(self, amt=None):
        d = self._d
        if amt is None or amt < 0:
            self._d = b''
            return d
        out, self._d = d[:amt], d[amt:]
        return out

    def iter_lines(self):
        for ln in self._d.decode('utf-8').splitlines():
            yield ln.encode('utf-8')

    def close(self):
        pass


def _default(o):
    if isinstance(o, _Decimal):
        return int(o) if o == int(o) else float(o)
    if isinstance(o, (bytes, bytearray)):
        return o.decode('utf-8')
    if isinstance(o, (set, frozenset)):
        return list(o)
    raise TypeError('Object of type %s is not JSON serializable' % type(o).__name__)


_excs = {}


def _exc_for(code):
    if code not in _excs:
        _excs[code] = type(code, (ClientError,), {})
    return _excs[code]


class _Exceptions:
    def __getattr__(self, code):
        if code.startswith('_'):
            raise AttributeError(code)
        return _exc_for(code)


class _Meta:
    def __init__(self, region):
        self.region_name = region


def _camel(name):
    return ''.join(w.capitalize() for w in name.split('_'))


class _Client:
    def __init__(self, service, region):
        self._service = service
        self._region = region
        self.meta = _Meta(region)
        self.exceptions = _Exceptions()

    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        service = _CLI.get(self._service, self._service)
        op = name.replace('_', '-')

        def call(**kwargs):
            params = {k: v for k, v in kwargs.items() if v is not None}
            res = _json.loads(_aws.call(service, op, _json.dumps(params, default=_default), self._region))
            if '__error' in res:
                err = res['__error']
                if res.get('__delay'):
                    import time as _t
                    _t.sleep(res['__delay'] / 1000)
                if err.get('Code') == 'EndpointConnectionError':
                    raise EndpointConnectionError(err.get('Message', ''))
                resp = {'Error': {'Code': err.get('Code', 'Unknown'), 'Message': err.get('Message', '')}, 'ResponseMetadata': {'HTTPStatusCode': err.get('Status', 400)}}
                if err.get('Code') == 'NoCredentialsError':
                    raise NoCredentialsError()
                if err.get('Code') == 'ParamValidationError':
                    raise ParamValidationError(err.get('Message', ''))
                raise _exc_for(err.get('Code', 'Unknown'))(resp, _camel(name))
            for k in ('Payload', 'Body'):
                if k in res and isinstance(res[k], str):
                    res[k] = StreamingBody(res[k])
            res.setdefault('ResponseMetadata', {'HTTPStatusCode': 200, 'RetryAttempts': 0})
            return res

        return call


def client(service_name, region_name=None, **kw):
    import os
    if not _aws.available():
        raise NoCredentialsError()
    return _Client(service_name, region_name or os.environ.get('AWS_REGION', 'us-east-1'))


# ───────── DynamoDB (recurso Table) ─────────

def _ser(v):
    if v is None:
        return {'NULL': True}
    if isinstance(v, bool):
        return {'BOOL': v}
    if isinstance(v, float):
        raise TypeError('Float types are not supported. Use Decimal types instead.')
    if isinstance(v, (int, _Decimal)):
        return {'N': str(v)}
    if isinstance(v, str):
        return {'S': v}
    if isinstance(v, (bytes, bytearray)):
        return {'B': v.decode('utf-8')}
    if isinstance(v, (set, frozenset)):
        items = list(v)
        if items and all(isinstance(x, str) for x in items):
            return {'SS': items}
        return {'NS': [str(x) for x in items]}
    if isinstance(v, (list, tuple)):
        return {'L': [_ser(x) for x in v]}
    if isinstance(v, dict):
        return {'M': {k: _ser(x) for k, x in v.items()}}
    raise TypeError('Unsupported type "%s": %r' % (type(v).__name__, v))


def _de(v):
    (t, x), = v.items()
    if t == 'S':
        return x
    if t == 'N':
        return _Decimal(x)
    if t == 'BOOL':
        return x
    if t == 'NULL':
        return None
    if t == 'L':
        return [_de(i) for i in x]
    if t == 'M':
        return {k: _de(i) for k, i in x.items()}
    if t == 'SS':
        return set(x)
    if t == 'NS':
        return set(_Decimal(i) for i in x)
    return x


def _item(d):
    return {k: _ser(v) for k, v in d.items()}


def _unitem(d):
    return {k: _de(v) for k, v in d.items()}


class _Table:
    def __init__(self, name, client):
        self.name = name
        self.table_name = name
        self._c = client

    def _call(self, op, **kw):
        return getattr(self._c, op)(TableName=self.name, **kw)

    def put_item(self, Item, **kw):
        _expr(kw)
        return self._call('put_item', Item=_item(Item), **kw)

    def get_item(self, Key, **kw):
        r = self._call('get_item', Key=_item(Key), **kw)
        if 'Item' in r:
            r['Item'] = _unitem(r['Item'])
        return r

    def delete_item(self, Key, **kw):
        _expr(kw)
        r = self._call('delete_item', Key=_item(Key), **kw)
        if 'Attributes' in r:
            r['Attributes'] = _unitem(r['Attributes'])
        return r

    def update_item(self, Key, **kw):
        _expr(kw)
        r = self._call('update_item', Key=_item(Key), **kw)
        if 'Attributes' in r:
            r['Attributes'] = _unitem(r['Attributes'])
        return r

    def scan(self, **kw):
        _expr(kw)
        r = self._call('scan', **kw)
        r['Items'] = [_unitem(i) for i in r.get('Items', [])]
        return r

    def query(self, **kw):
        _expr(kw)
        r = self._call('query', **kw)
        r['Items'] = [_unitem(i) for i in r.get('Items', [])]
        return r

    def batch_writer(self):
        return _Batch(self)


class _Batch:
    def __init__(self, table):
        self._t = table

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def put_item(self, Item):
        self._t.put_item(Item=Item)

    def delete_item(self, Key):
        self._t.delete_item(Key=Key)


def _expr(kw):
    names = dict(kw.get('ExpressionAttributeNames', {}))
    values = {k: _ser(v) for k, v in kw.get('ExpressionAttributeValues', {}).items()}
    for key in ('KeyConditionExpression', 'FilterExpression', 'ConditionExpression'):
        c = kw.get(key)
        if c is not None and not isinstance(c, str):
            kw[key] = c._expr
            names.update(c._names)
            values.update({k: _ser(v) for k, v in c._values.items()})
    if names:
        kw['ExpressionAttributeNames'] = names
    if values:
        kw['ExpressionAttributeValues'] = values


class _DynamoDB:
    def __init__(self, region):
        self._c = _Client('dynamodb', region)

    def Table(self, name):
        return _Table(name, self._c)


def resource(service_name, region_name=None, **kw):
    import os
    if not _aws.available():
        raise NoCredentialsError()
    if service_name != 'dynamodb':
        raise NotImplementedError('boto3.resource(%r) no está disponible en el simulador: usa boto3.client(%r)' % (service_name, service_name))
    return _DynamoDB(region_name or os.environ.get('AWS_REGION', 'us-east-1'))
`;

const DDB_CONDITIONS = `
_n = [0]


def _ph():
    _n[0] += 1
    return _n[0]


class ConditionBase:
    def __init__(self, expr, names, values):
        self._expr = expr
        self._names = names
        self._values = values

    def __and__(self, o):
        return ConditionBase('(%s AND %s)' % (self._expr, o._expr), {**self._names, **o._names}, {**self._values, **o._values})

    def __or__(self, o):
        return ConditionBase('(%s OR %s)' % (self._expr, o._expr), {**self._names, **o._names}, {**self._values, **o._values})

    def __invert__(self):
        return ConditionBase('(NOT %s)' % self._expr, self._names, self._values)


class _Attr:
    def __init__(self, name):
        self.name = name

    def _cmp(self, op, v):
        i = _ph()
        return ConditionBase('#c%d %s :c%d' % (i, op, i), {'#c%d' % i: self.name}, {':c%d' % i: v})

    def _fn(self, fn, *vals):
        i = _ph()
        vs = {}
        parts = ['#c%d' % i]
        for k, v in enumerate(vals):
            vs[':c%d_%d' % (i, k)] = v
            parts.append(':c%d_%d' % (i, k))
        return ConditionBase('%s(%s)' % (fn, ', '.join(parts)), {'#c%d' % i: self.name}, vs)

    def eq(self, v):
        return self._cmp('=', v)

    def ne(self, v):
        return self._cmp('<>', v)

    def lt(self, v):
        return self._cmp('<', v)

    def lte(self, v):
        return self._cmp('<=', v)

    def gt(self, v):
        return self._cmp('>', v)

    def gte(self, v):
        return self._cmp('>=', v)

    def begins_with(self, v):
        return self._fn('begins_with', v)

    def contains(self, v):
        return self._fn('contains', v)

    def between(self, lo, hi):
        i = _ph()
        return ConditionBase('#c%d BETWEEN :c%da AND :c%db' % (i, i, i), {'#c%d' % i: self.name}, {':c%da' % i: lo, ':c%db' % i: hi})

    def exists(self):
        i = _ph()
        return ConditionBase('attribute_exists(#c%d)' % i, {'#c%d' % i: self.name}, {})

    def not_exists(self):
        i = _ph()
        return ConditionBase('attribute_not_exists(#c%d)' % i, {'#c%d' % i: self.name}, {})


class Key(_Attr):
    pass


class Attr(_Attr):
    pass
`;

registerPy('botocore', () => '', true);
registerPy('botocore.exceptions', () => BOTOCORE_EXC);
registerPy('botocore.config', () => BOTOCORE_CONFIG);
registerPy('boto3', () => BOTO3, true);
registerPy('boto3.dynamodb', () => '', true);
registerPy('boto3.dynamodb.conditions', () => DDB_CONDITIONS);

// ───────── tiempo de ejecución de Lambda ─────────

const LAMBDA_RT = `
import time as _time


class LambdaContext:
    def __init__(self, function_name, function_version, invoked_function_arn, memory_limit_in_mb, aws_request_id, log_group_name, log_stream_name, deadline_ms):
        self.function_name = function_name
        self.function_version = function_version
        self.invoked_function_arn = invoked_function_arn
        self.memory_limit_in_mb = str(memory_limit_in_mb)
        self.aws_request_id = aws_request_id
        self.log_group_name = log_group_name
        self.log_stream_name = log_stream_name
        self.identity = None
        self.client_context = None
        self._deadline = deadline_ms

    def get_remaining_time_in_millis(self):
        return max(0, int(self._deadline - _time.time() * 1000))
`;
registerPy('_lambda_rt', () => LAMBDA_RT);

// ───────────────────────── AWS X-Ray SDK (versión mínima) ─────────────────────────

/** Lo que registra el SDK dentro de la función: subsegmentos, anotaciones y metadatos. Lambda lo recoge al terminar cada invocación. */
const XRAY_RT = `
import time as _t

patched = False
_roots = []
_stack = []
_annotations = {}
_metadata = {}


def patch_all():
    global patched
    patched = True


def patch(libraries=None, **kw):
    global patched
    patched = True


class Subsegment:
    def __init__(self, name, namespace='local'):
        self.name = name
        self.namespace = namespace
        self.start_time = _t.time()
        self.end_time = None
        self.annotations = {}
        self.metadata = {}
        self.fault = False
        self.error = False
        self.cause = None
        self.children = []

    def put_annotation(self, key, value):
        self.annotations[key] = value

    def put_metadata(self, key, value, namespace='default'):
        self.metadata.setdefault(namespace, {})[key] = value

    def add_exception(self, exception, stack=None, remote=False):
        self.fault = True
        self.cause = str(exception)

    def __enter__(self):
        return self

    def __exit__(self, et, ev, tb):
        if et is not None:
            self.add_exception(ev)
        xray_recorder.end_subsegment()
        return False


class _Segment:
    def put_annotation(self, key, value):
        _annotations[key] = value

    def put_metadata(self, key, value, namespace='default'):
        _metadata.setdefault(namespace, {})[key] = value


class Recorder:
    def begin_subsegment(self, name, namespace='local'):
        s = Subsegment(name, namespace)
        _stack.append(s)
        return s

    def end_subsegment(self, end_time=None):
        if not _stack:
            return
        s = _stack.pop()
        s.end_time = _t.time() if end_time is None else end_time
        (_stack[-1].children if _stack else _roots).append(s)

    def in_subsegment(self, name, **kw):
        return self.begin_subsegment(name)

    def capture(self, name=None):
        def deco(fn):
            label = name or fn.__name__

            def wrapper(*a, **k):
                s = self.begin_subsegment(label)
                try:
                    return fn(*a, **k)
                except BaseException as e:
                    s.add_exception(e)
                    raise
                finally:
                    self.end_subsegment()

            wrapper.__name__ = fn.__name__
            return wrapper

        return deco

    def put_annotation(self, key, value):
        if _stack:
            _stack[-1].put_annotation(key, value)
        else:
            _annotations[key] = value

    def put_metadata(self, key, value, namespace='default'):
        if _stack:
            _stack[-1].put_metadata(key, value, namespace)
        else:
            _metadata.setdefault(namespace, {})[key] = value

    def current_subsegment(self):
        return _stack[-1] if _stack else None

    def current_segment(self):
        return _Segment()


xray_recorder = Recorder()


def _ser(s):
    out = {'name': s.name, 'start_time': s.start_time, 'end_time': s.end_time if s.end_time is not None else _t.time()}
    if s.annotations:
        out['annotations'] = s.annotations
    if s.metadata:
        out['metadata'] = s.metadata
    if s.fault:
        out['fault'] = True
        out['cause'] = s.cause
    if s.namespace != 'local':
        out['namespace'] = s.namespace
    if s.children:
        out['subsegments'] = [_ser(c) for c in s.children]
    return out


def drain():
    while _stack:
        xray_recorder.end_subsegment()
    out = {'patched': patched, 'annotations': dict(_annotations), 'metadata': dict(_metadata), 'subs': [_ser(s) for s in _roots]}
    del _roots[:]
    _annotations.clear()
    _metadata.clear()
    return out
`;
registerPy('_xray_rt', () => XRAY_RT);
registerPy('aws_xray_sdk', () => '', true);
registerPy('aws_xray_sdk.core', () => 'from _xray_rt import xray_recorder, patch_all, patch\n');
