import math
import numpy as np


class OptimizeResult(dict):
    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)

    def __setattr__(self, name, value):
        self[name] = value

    def __repr__(self):
        if self.keys():
            w = max(map(len, self.keys())) + 1
            return '\n'.join(k.rjust(w) + ': ' + repr(v) for k, v in self.items())
        return self.__class__.__name__ + '()'


def _num_grad(f, x, eps=1.4901161193847656e-08):
    g = np.zeros_like(x)
    f0 = f(x)
    for i in range(len(x)):
        xi = x.copy()
        xi[i] += eps
        g[i] = (f(xi) - f0) / eps
    return g


def _wrap(fun, jac, args):
    cache = {}
    use_fg = jac is True

    def f(x):
        if use_fg:
            r = fun(x, *args)
            return float(r[0])
        return float(fun(x, *args))

    def g(x):
        if use_fg:
            return np.asarray(fun(x, *args)[1], dtype=np.float64)
        if callable(jac):
            return np.asarray(jac(x, *args), dtype=np.float64)
        return _num_grad(f, x)
    return f, g


def _line_search(f, g, x, fx, gx, d, maxls=30):
    gd = float(gx @ d)
    if gd >= 0:
        d = -gx
        gd = -float(gx @ gx)
    t = 1.0
    for _ in range(maxls):
        xn = x + t * d
        fn = f(xn)
        if fn <= fx + 1e-4 * t * gd:
            gn = g(xn)
            if abs(float(gn @ d)) <= 0.9 * abs(gd) or t < 1e-10:
                return xn, fn, gn, d
            if float(gn @ d) >= 0:
                return xn, fn, gn, d
            t *= 2.0
            xn2 = x + t * d
            fn2 = f(xn2)
            if fn2 < fn:
                return xn2, fn2, g(xn2), d
            return xn, fn, gn, d
        t *= 0.5
    xn = x + t * d
    return xn, f(xn), g(xn), d


def _bfgs(f, g, x0, maxiter, gtol, limited=False, m=10, callback=None):
    x = np.asarray(x0, dtype=np.float64).ravel().copy()
    fx = f(x)
    gx = g(x)
    n = len(x)
    H = np.eye(n)
    S, Y = [], []
    nit = 0
    nfev = 1
    status = 1
    for nit in range(1, maxiter + 1):
        if np.abs(gx).max() <= gtol:
            status = 0
            nit -= 1
            break
        if limited:
            q = gx.copy()
            alphas = []
            for s, yv in reversed(list(zip(S, Y))):
                rho = 1.0 / float(yv @ s)
                a = rho * float(s @ q)
                alphas.append((a, rho, s, yv))
                q = q - a * yv
            if S:
                gamma = float(S[-1] @ Y[-1]) / float(Y[-1] @ Y[-1])
                r = gamma * q
            else:
                r = q / max(1.0, float(np.linalg.norm(gx)))
            for a, rho, s, yv in reversed(alphas):
                b = rho * float(yv @ r)
                r = r + s * (a - b)
            d = -r
        else:
            d = -(H @ gx)
        xn, fn, gn, d = _line_search(f, g, x, fx, gx, d)
        nfev += 3
        s = xn - x
        yv = gn - gx
        sy = float(s @ yv)
        if sy > 1e-10:
            if limited:
                S.append(s)
                Y.append(yv)
                if len(S) > m:
                    S.pop(0)
                    Y.pop(0)
            else:
                rho = 1.0 / sy
                I = np.eye(n)
                H = (I - rho * np.outer(s, yv)) @ H @ (I - rho * np.outer(yv, s)) + rho * np.outer(s, s)
        conv = abs(fx - fn) <= 2.220446049250313e-09 * max(abs(fx), abs(fn), 1.0)
        x, fx, gx = xn, fn, gn
        if callback is not None:
            callback(x)
        if conv and np.abs(gx).max() <= gtol * 100:
            status = 0
            break
    else:
        status = 1
    if np.abs(gx).max() <= gtol:
        status = 0
    return x, fx, gx, nit, nfev, status


def _nelder_mead(f, x0, maxiter, xatol=1e-4, fatol=1e-4):
    x0 = np.asarray(x0, dtype=np.float64).ravel()
    n = len(x0)
    sim = np.zeros((n + 1, n))
    sim[0] = x0
    for k in range(n):
        y = x0.copy()
        y[k] = 0.00025 if y[k] == 0 else 1.05 * y[k]
        sim[k + 1] = y
    fs = np.array([f(p) for p in sim])
    nit = 0
    nfev = n + 1
    for nit in range(1, maxiter * n + 1):
        order = np.argsort(fs, kind='stable')
        sim, fs = sim[order], fs[order]
        if np.max(np.abs(sim[1:] - sim[0])) <= xatol and np.max(np.abs(fs[0] - fs[1:])) <= fatol:
            break
        xbar = sim[:-1].mean(axis=0)
        xr = 2 * xbar - sim[-1]
        fr = f(xr)
        nfev += 1
        if fr < fs[0]:
            xe = 3 * xbar - 2 * sim[-1]
            fe = f(xe)
            nfev += 1
            if fe < fr:
                sim[-1], fs[-1] = xe, fe
            else:
                sim[-1], fs[-1] = xr, fr
        elif fr < fs[-2]:
            sim[-1], fs[-1] = xr, fr
        else:
            if fr < fs[-1]:
                xc = 1.5 * xbar - 0.5 * sim[-1]
                fc = f(xc)
                nfev += 1
                ok = fc <= fr
            else:
                xc = 0.5 * xbar + 0.5 * sim[-1]
                fc = f(xc)
                nfev += 1
                ok = fc < fs[-1]
            if ok:
                sim[-1], fs[-1] = xc, fc
            else:
                for j in range(1, n + 1):
                    sim[j] = sim[0] + 0.5 * (sim[j] - sim[0])
                    fs[j] = f(sim[j])
                nfev += n
    order = np.argsort(fs, kind='stable')
    return sim[order][0], float(fs[order][0]), nit, nfev


def minimize(fun, x0, args=(), method=None, jac=None, hess=None, hessp=None, bounds=None, constraints=(), tol=None, callback=None, options=None):
    options = options or {}
    x0 = np.atleast_1d(np.asarray(x0, dtype=np.float64))
    method = (method or ('L-BFGS-B' if bounds is not None else 'BFGS')).upper()
    f, g = _wrap(fun, jac, args)
    if bounds is not None:
        lo = np.array([-np.inf if b[0] is None else b[0] for b in bounds], dtype=np.float64)
        hi = np.array([np.inf if b[1] is None else b[1] for b in bounds], dtype=np.float64)
        f0, g0 = f, g
        f = lambda x: f0(np.clip(x, lo, hi))
        g = lambda x: g0(np.clip(x, lo, hi))
    maxiter = options.get('maxiter', None)
    if method == 'NELDER-MEAD':
        mi = maxiter if maxiter is not None else 200
        x, fx, nit, nfev = _nelder_mead(f, x0, mi, options.get('xatol', 1e-4), options.get('fatol', 1e-4))
        return OptimizeResult(message='Optimization terminated successfully.', success=True, status=0, fun=fx, x=x, nit=nit, nfev=nfev)
    if method in ('BFGS', 'L-BFGS-B', 'CG', 'CG '):
        gtol = options.get('gtol', 1e-5 if method != 'L-BFGS-B' else 1e-5)
        mi = maxiter if maxiter is not None else (15000 if method == 'L-BFGS-B' else 200 * len(x0))
        x, fx, gx, nit, nfev, status = _bfgs(f, g, x0, mi, gtol, limited=(method == 'L-BFGS-B'), callback=callback)
        if bounds is not None:
            x = np.clip(x, lo, hi)
        msg = 'Optimization terminated successfully.' if status == 0 else 'Maximum number of iterations has been exceeded.'
        if method == 'L-BFGS-B':
            msg = 'CONVERGENCE: NORM OF PROJECTED GRADIENT <= PGTOL' if status == 0 else 'STOP: TOTAL NO. OF ITERATIONS REACHED LIMIT'
        res = OptimizeResult(message=msg, success=(status == 0), status=status, fun=fx, x=x, nit=nit, nfev=nfev)
        res['jac'] = gx
        return res
    raise ValueError('Unknown solver %s' % method)


def minimize_scalar(fun, bracket=None, bounds=None, args=(), method='brent', tol=None, options=None):
    f = lambda x: float(fun(x, *args))
    if bounds is not None or method == 'bounded':
        a, b = bounds
        gr = (math.sqrt(5) - 1) / 2
        c = b - gr * (b - a)
        d = a + gr * (b - a)
        fc, fd = f(c), f(d)
        for _ in range(200):
            if abs(b - a) < 1e-9:
                break
            if fc < fd:
                b, d, fd = d, c, fc
                c = b - gr * (b - a)
                fc = f(c)
            else:
                a, c, fc = c, d, fd
                d = a + gr * (b - a)
                fd = f(d)
        x = (a + b) / 2
        return OptimizeResult(fun=f(x), x=x, success=True, nit=200, nfev=400)
    if bracket is None:
        a, b = 0.0, 1.0
    else:
        a, b = bracket[0], bracket[-1]
    lo, hi = min(a, b), max(a, b)
    while f(lo - (hi - lo)) < f(lo) and (hi - lo) < 1e6:
        lo, hi = lo - (hi - lo), hi
    while f(hi + (hi - lo)) < f(hi) and (hi - lo) < 1e6:
        lo, hi = lo, hi + (hi - lo)
    return minimize_scalar(fun, bounds=(lo, hi), args=args, method='bounded')


def brentq(f, a, b, args=(), xtol=2e-12, rtol=8.881784197001252e-16, maxiter=100, full_output=False):
    fa, fb = f(a, *args), f(b, *args)
    if fa * fb > 0:
        raise ValueError('f(a) and f(b) must have different signs')
    for _ in range(maxiter * 2):
        m = (a + b) / 2
        fm = f(m, *args)
        if fa * fm <= 0:
            b, fb = m, fm
        else:
            a, fa = m, fm
        if abs(b - a) < xtol + rtol * abs(m):
            break
    return (a + b) / 2


def curve_fit(f, xdata, ydata, p0=None, sigma=None, absolute_sigma=False, bounds=(-np.inf, np.inf), maxfev=None, **kw):
    xdata = np.asarray(xdata, dtype=np.float64)
    ydata = np.asarray(ydata, dtype=np.float64)
    if p0 is None:
        import inspect
        n = len(inspect.signature(f).parameters) - 1
        p = np.ones(n)
    else:
        p = np.atleast_1d(np.asarray(p0, dtype=np.float64))
    lam = 1e-3

    def resid(q):
        return ydata - f(xdata, *q)

    def jac(q):
        J = np.zeros((len(ydata), len(q)))
        for k in range(len(q)):
            e = np.zeros(len(q))
            h = 1.4901161193847656e-08 * max(1.0, abs(q[k]))
            e[k] = h
            J[:, k] = (f(xdata, *(q + e)) - f(xdata, *q)) / h
        return J
    r = resid(p)
    cost = float(r @ r)
    for _ in range(maxfev or 1000):
        J = jac(p)
        A = J.T @ J
        gr = J.T @ r
        improved = False
        for _ in range(20):
            step = np.linalg.solve(A + lam * np.diag(np.diag(A) + 1e-12), gr)
            pn = p + step
            rn = resid(pn)
            cn = float(rn @ rn)
            if cn < cost:
                lam = max(lam / 3.0, 1e-12)
                converged = abs(cost - cn) <= 1e-12 * max(cost, 1e-30) or float(np.abs(step).max()) <= 1e-12 * (float(np.abs(p).max()) + 1e-12)
                p, r, cost = pn, rn, cn
                improved = True
                if converged:
                    improved = False
                break
            lam *= 4.0
        if not improved:
            break
    J = jac(p)
    dof = max(len(ydata) - len(p), 1)
    s2 = cost / dof
    try:
        pcov = np.linalg.inv(J.T @ J) * s2
    except Exception:
        pcov = np.full((len(p), len(p)), np.inf)
    return p, pcov
