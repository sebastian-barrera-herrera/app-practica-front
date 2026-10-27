/**
 * `flask` mínimo para las aplicaciones de los contenedores del simulador de AWS.
 *
 * No abre ningún puerto: `app.run()` imprime el mismo mensaje que Flask (con la dirección en la que escucha) y el motor de contenedores
 * atiende después cada petición volviendo a ejecutar el programa con la variable `__MINIWEB_REQ`, que hace que `run()` (o `__dispatch__()`)
 * despache esa petición y escriba la respuesta en una línea marcada.
 */
import { registerPy } from './registry';

const FLASK = `
import os as _os
import re as _re
import json as _json

MARK = '@@MINIWEB@@'
_STATUS = {200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 422: 'Unprocessable Entity', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable'}


class HTTPException(Exception):
    def __init__(self, code=500, description=None):
        self.code = code
        self.description = description or _STATUS.get(code, 'Error')
        super().__init__('%d %s: %s' % (code, _STATUS.get(code, 'Error'), self.description))


def abort(code, description=None):
    raise HTTPException(code, description)


class Request:
    def __init__(self):
        self.method = 'GET'
        self.path = '/'
        self.args = {}
        self.headers = {}
        self.data = b''
        self.form = {}

    def get_json(self, silent=False, force=False):
        try:
            text = self.data.decode() if isinstance(self.data, bytes) else self.data
            return _json.loads(text)
        except Exception:
            if silent:
                return None
            raise HTTPException(400, 'The browser (or proxy) sent a request that this server could not understand.')

    @property
    def json(self):
        return self.get_json()

    def get_data(self, as_text=False):
        return self.data.decode() if as_text and isinstance(self.data, bytes) else self.data


request = Request()


class Response:
    def __init__(self, response='', status=200, headers=None, mimetype=None, content_type=None):
        self.data = response
        self.status_code = status
        self.headers = dict(headers or {})
        ctype = content_type or mimetype
        if ctype:
            self.headers['Content-Type'] = ctype
        elif 'Content-Type' not in self.headers:
            self.headers['Content-Type'] = 'text/html; charset=utf-8'

    @property
    def mimetype(self):
        return self.headers.get('Content-Type', '').split(';')[0]


def jsonify(*args, **kwargs):
    if args and kwargs:
        raise TypeError('jsonify() behavior undefined when passed both args and kwargs')
    data = args[0] if len(args) == 1 else (list(args) if args else kwargs)
    return Response(_json.dumps(data, separators=(',', ':')) + '\\n', 200, mimetype='application/json')


def make_response(*args):
    return _to_response(args[0] if len(args) == 1 else args)


def _to_response(rv):
    status = None
    headers = None
    if isinstance(rv, tuple):
        if len(rv) == 3:
            rv, status, headers = rv
        elif len(rv) == 2:
            rv, second = rv
            if isinstance(second, dict):
                headers = second
            else:
                status = second
        else:
            raise TypeError('The view function did not return a valid response tuple.')
    if rv is None:
        raise TypeError('The view function did not return a valid response. The function either returned None or ended without a return statement.')
    if isinstance(rv, Response):
        resp = rv
    elif isinstance(rv, (dict, list)):
        resp = jsonify(rv)
    elif isinstance(rv, (str, bytes)):
        resp = Response(rv)
    else:
        raise TypeError('The view function did not return a valid response. The return type must be a string, dict, list, tuple with headers or status, Response instance, or WSGI callable, but it was a %s.' % type(rv).__name__)
    if status is not None:
        resp.status_code = status
    if headers:
        resp.headers.update(headers)
    return resp


def _compile(rule):
    names = []
    out = ''
    pos = 0
    for m in _re.finditer(r'<(?:(int|float|string|path|uuid):)?([a-zA-Z_][a-zA-Z0-9_]*)>', rule):
        out += _re.escape(rule[pos:m.start()])
        conv = m.group(1) or 'string'
        names.append((m.group(2), conv))
        if conv == 'int':
            out += '([0-9]+)'
        elif conv == 'float':
            out += '([0-9]+\\\\.[0-9]+)'
        elif conv == 'path':
            out += '(.+)'
        elif conv == 'uuid':
            out += '([0-9a-fA-F-]{36})'
        else:
            out += '([^/]+)'
        pos = m.end()
    out += _re.escape(rule[pos:])
    return _re.compile('^' + out + '$'), names


class Flask:
    def __init__(self, import_name, static_folder='static', template_folder='templates'):
        self.import_name = import_name
        self.config = {}
        self.url_map = []
        self.error_handlers = {}
        self.before_funcs = []
        self.after_funcs = []

    def route(self, rule, methods=None, **options):
        def deco(f):
            self.add_url_rule(rule, getattr(f, '__name__', 'view'), f, methods=methods)
            return f
        return deco

    def get(self, rule, **options):
        return self.route(rule, methods=['GET'])

    def post(self, rule, **options):
        return self.route(rule, methods=['POST'])

    def put(self, rule, **options):
        return self.route(rule, methods=['PUT'])

    def delete(self, rule, **options):
        return self.route(rule, methods=['DELETE'])

    def add_url_rule(self, rule, endpoint=None, view_func=None, methods=None, **options):
        rx, names = _compile(rule)
        allowed = [m.upper() for m in (methods or ['GET'])]
        if 'GET' in allowed and 'HEAD' not in allowed:
            allowed.append('HEAD')
        self.url_map.append((rule, rx, names, allowed, view_func))

    def errorhandler(self, code):
        def deco(f):
            self.error_handlers[code] = f
            return f
        return deco

    def before_request(self, f):
        self.before_funcs.append(f)
        return f

    def after_request(self, f):
        self.after_funcs.append(f)
        return f

    def _handle(self, req):
        request.method = req.get('method', 'GET').upper()
        path, _, query = req.get('path', '/').partition('?')
        request.path = path
        request.args = {}
        for part in query.split('&'):
            if part:
                k, _, v = part.partition('=')
                request.args[k] = v
        request.headers = dict(req.get('headers') or {})
        body = req.get('body') or ''
        request.data = body.encode() if isinstance(body, str) else body
        matched = False
        for rule, rx, names, allowed, view in self.url_map:
            m = rx.match(path)
            if not m:
                continue
            matched = True
            if request.method not in allowed:
                continue
            kwargs = {}
            for i, (name, conv) in enumerate(names):
                v = m.group(i + 1)
                kwargs[name] = int(v) if conv == 'int' else float(v) if conv == 'float' else v
            for f in self.before_funcs:
                r = f()
                if r is not None:
                    return _to_response(r)
            return _to_response(view(**kwargs))
        raise HTTPException(405 if matched else 404, 'The method is not allowed for the requested URL.' if matched else 'The requested URL was not found on the server. If you entered the URL manually please check your spelling and try again.')

    def _dispatch(self, req):
        try:
            try:
                resp = self._handle(req)
            except HTTPException as e:
                h = self.error_handlers.get(e.code)
                if h is not None:
                    resp = _to_response(h(e))
                else:
                    title = _STATUS.get(e.code, 'Error')
                    body = '<!doctype html>\\n<html lang=en>\\n<title>%d %s</title>\\n<h1>%s</h1>\\n<p>%s</p>\\n' % (e.code, title, title, e.description)
                    resp = Response(body, e.code)
            for f in self.after_funcs:
                resp = f(resp) or resp
            status = resp.status_code
            out = {'status': status, 'headers': resp.headers, 'body': resp.data.decode() if isinstance(resp.data, bytes) else resp.data}
        except Exception as e:
            print('[ERROR] Exception on %s [%s]' % (request.path, request.method))
            print('Traceback (most recent call last):')
            print('%s: %s' % (type(e).__name__, e))
            h = self.error_handlers.get(500)
            out = {'status': 500, 'headers': {'Content-Type': 'text/html; charset=utf-8'}, 'body': '<!doctype html>\\n<html lang=en>\\n<title>500 Internal Server Error</title>\\n<h1>Internal Server Error</h1>\\n<p>The server encountered an internal error and was unable to complete your request. Either the server is overloaded or there is an error in the application.</p>\\n'}
        print(MARK + _json.dumps(out))

    def __dispatch__(self):
        self._dispatch(_json.loads(_os.environ['__MINIWEB_REQ']))

    def run(self, host=None, port=None, debug=None, **options):
        if _os.environ.get('__MINIWEB_REQ'):
            self.__dispatch__()
            return
        host = host or '127.0.0.1'
        port = int(port or 5000)
        print(" * Serving Flask app '%s'" % self.import_name)
        print(' * Debug mode: %s' % ('on' if debug else 'off'))
        print('WARNING: This is a development server. Do not use it in a production deployment. Use a production WSGI server instead.')
        if host == '0.0.0.0':
            print(' * Running on all addresses (0.0.0.0)')
            print(' * Running on http://127.0.0.1:%d' % port)
            print(' * Running on http://172.17.0.2:%d' % port)
        else:
            print(' * Running on http://%s:%d' % (host, port))
        print('Press CTRL+C to quit')
`;

registerPy('flask', () => FLASK);
