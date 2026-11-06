/**
 * `matplotlib.pyplot` en miniatura: guarda lo que dibuja el programa como una descripción JSON (series, ejes, etiquetas)
 * y, con `plt.show()`, la entrega a la app (`_dojo.figure`), que la dibuja con SVG bajo la salida del programa.
 * Cubre lo que se usa para aprender: plot, scatter, bar, hist, imshow, contourf, fill_between, pie, subplots, etiquetas.
 */
import { registerPy } from './registry';

const PYPLOT = String.raw`
import json as _json
import math as _math
import numpy as _np
import _dojo

_CYCLE = ['#4C9AFF', '#FF8A3D', '#2FBF71', '#E5484D', '#A78BFA', '#B08968', '#F472B6', '#9CA3AF', '#D4C13B', '#22D3EE']
_NAMED = {'b': '#4C9AFF', 'blue': '#4C9AFF', 'g': '#2FBF71', 'green': '#2FBF71', 'r': '#E5484D', 'red': '#E5484D', 'c': '#22D3EE', 'cyan': '#22D3EE',
          'm': '#F472B6', 'magenta': '#F472B6', 'y': '#D4C13B', 'yellow': '#D4C13B', 'k': '#111827', 'black': '#111827', 'w': '#FFFFFF', 'white': '#FFFFFF',
          'orange': '#FF8A3D', 'purple': '#A78BFA', 'gray': '#9CA3AF', 'grey': '#9CA3AF', 'brown': '#B08968', 'pink': '#F472B6',
          'tab:blue': '#4C9AFF', 'tab:orange': '#FF8A3D', 'tab:green': '#2FBF71', 'tab:red': '#E5484D', 'tab:purple': '#A78BFA', 'tab:gray': '#9CA3AF'}


def _num(v):
    f = float(v)
    if f != f or f in (float('inf'), float('-inf')):
        return None
    return round(f, 5)


def _nums(x):
    if x is None:
        return None
    a = _np.asarray(x)
    if a.ndim == 0:
        return [_num(a)]
    return [_num(v) for v in a.ravel().tolist()]


def _color(c):
    if c is None:
        return None
    if isinstance(c, str):
        return _NAMED.get(c, c)
    if isinstance(c, (tuple, list)) and len(c) in (3, 4):
        r, g, b = [int(round(float(v) * 255)) for v in c[:3]]
        return '#%02X%02X%02X' % (r, g, b)
    return None


def _parse_fmt(fmt):
    color = marker = None
    ls = '-'
    if fmt:
        i = 0
        if len(fmt) >= 1 and fmt[0] in 'bgrcmykw' and not fmt.startswith('--'):
            color = fmt[0]
            i = 1
        rest = fmt[i:]
        for m in 'o.,^vs*+xDd|_':
            if m in rest:
                marker = m
                rest = rest.replace(m, '')
                break
        if rest in ('--', '-.', ':', '-'):
            ls = rest
        elif marker and not rest:
            ls = ''
        elif fmt[0] in 'bgrcmykw' and len(fmt) > 1 and rest == '':
            ls = '-'
    return color, marker, ls


class Axes:
    def __init__(self, fig, row=0, col=0, nrows=1, ncols=1):
        self.fig = fig
        self.pos = (row, col, nrows, ncols)
        self.series = []
        self.title = ''
        self.xlabel = ''
        self.ylabel = ''
        self._xlim = None
        self._ylim = None
        self.grid_on = False
        self.legend_on = False
        self.equal = False
        self.off = False
        self.xscale = 'linear'
        self.yscale = 'linear'
        self.xticks = None
        self.xticklabels = None
        self.yticks = None
        self.yticklabels = None
        self._i = 0

    def _next_color(self):
        c = _CYCLE[self._i % len(_CYCLE)]
        self._i += 1
        return c

    def plot(self, *args, label=None, color=None, c=None, linewidth=None, lw=None, linestyle=None, ls=None, marker=None, alpha=None, markersize=None, ms=None, **kw):
        args = list(args)
        fmt = args.pop() if args and isinstance(args[-1], str) else ''
        if len(args) == 1:
            y = _nums(args[0])
            x = [float(i) for i in range(len(y))]
        elif len(args) >= 2:
            x, y = _nums(args[0]), _nums(args[1])
        else:
            return []
        fc, fm, fl = _parse_fmt(fmt)
        col = _color(color or c or fc) or self._next_color()
        self.series.append({'t': 'line', 'x': x, 'y': y, 'label': label, 'color': col, 'lw': linewidth or lw or 2, 'ls': linestyle or ls or fl,
                            'marker': marker or fm, 'alpha': alpha, 'ms': markersize or ms or 5})
        return [self.series[-1]]

    def scatter(self, x, y, s=None, c=None, color=None, marker=None, alpha=None, label=None, cmap=None, vmin=None, vmax=None, edgecolors=None, **kw):
        ser = {'t': 'scatter', 'x': _nums(x), 'y': _nums(y), 'label': label, 'alpha': alpha, 'marker': marker or 'o', 'cmap': cmap if isinstance(cmap, str) else getattr(cmap, 'name', None)}
        if s is not None:
            sv = _np.asarray(s)
            ser['s'] = _nums(sv) if sv.ndim else _num(sv)
        else:
            ser['s'] = 36
        if c is not None and not isinstance(c, str):
            ca = _np.asarray(c)
            if ca.ndim == 1 and ca.shape[0] == len(ser['x']) and ca.dtype != object:
                ser['c'] = _nums(ca)
                ser['vmin'] = _num(vmin) if vmin is not None else None
                ser['vmax'] = _num(vmax) if vmax is not None else None
                if ser['cmap'] is None:
                    ser['cmap'] = 'viridis'
            else:
                ser['color'] = _color(c)
        else:
            ser['color'] = _color(c or color) or self._next_color()
        self.series.append(ser)
        return ser

    def bar(self, x, height, width=0.8, color=None, label=None, alpha=None, bottom=None, tick_label=None, yerr=None, **kw):
        xs = list(x)
        labels = None
        if xs and isinstance(xs[0], str):
            labels = [str(v) for v in xs]
            xs = list(range(len(xs)))
        elif tick_label is not None:
            labels = [str(v) for v in tick_label]
        h = _nums(height)
        ser = {'t': 'bar', 'x': _nums(xs), 'h': h, 'w': float(width), 'label': label, 'alpha': alpha, 'color': _color(color) or self._next_color(), 'labels': labels, 'bottom': _nums(bottom) if bottom is not None else None}
        self.series.append(ser)
        return ser

    def barh(self, y, width, height=0.8, color=None, label=None, **kw):
        ys = list(y)
        labels = None
        if ys and isinstance(ys[0], str):
            labels = [str(v) for v in ys]
            ys = list(range(len(ys)))
        ser = {'t': 'barh', 'x': _nums(ys), 'h': _nums(width), 'w': float(height), 'label': label, 'color': _color(color) or self._next_color(), 'labels': labels}
        self.series.append(ser)
        return ser

    def hist(self, x, bins=10, range=None, density=False, color=None, label=None, alpha=None, histtype='bar', weights=None, **kw):
        a = _np.asarray(x, dtype=float).ravel()
        a = a[a == a]
        counts, edges = _np.histogram(a, bins=bins, range=range, density=density, weights=weights)
        ser = {'t': 'hist', 'edges': _nums(edges), 'h': _nums(counts), 'label': label, 'alpha': alpha if alpha is not None else 0.85, 'color': _color(color) or self._next_color()}
        self.series.append(ser)
        return counts, edges, ser

    def imshow(self, img, cmap=None, vmin=None, vmax=None, interpolation=None, aspect=None, extent=None, **kw):
        a = _np.asarray(img, dtype=float)
        if a.ndim == 3:
            a = a.mean(axis=2)
        ser = {'t': 'image', 'z': [[_num(v) for v in row] for row in a.tolist()], 'cmap': cmap if isinstance(cmap, str) else (getattr(cmap, 'name', None) or 'viridis'),
               'vmin': _num(vmin) if vmin is not None else None, 'vmax': _num(vmax) if vmax is not None else None, 'extent': [float(v) for v in extent] if extent else None}
        self.series.append(ser)
        self.equal = True
        return ser

    def contourf(self, *args, cmap=None, levels=None, alpha=None, **kw):
        if len(args) == 1:
            Z = _np.asarray(args[0], dtype=float)
            X = _np.arange(Z.shape[1], dtype=float)
            Y = _np.arange(Z.shape[0], dtype=float)
        else:
            X, Y, Z = _np.asarray(args[0], dtype=float), _np.asarray(args[1], dtype=float), _np.asarray(args[2], dtype=float)
            if X.ndim == 2:
                X = X[0, :]
            if Y.ndim == 2:
                Y = Y[:, 0]
        ser = {'t': 'mesh', 'xs': _nums(X), 'ys': _nums(Y), 'z': [[_num(v) for v in row] for row in Z.tolist()], 'cmap': cmap if isinstance(cmap, str) else (getattr(cmap, 'name', None) or 'viridis'), 'alpha': alpha if alpha is not None else 0.45}
        self.series.append(ser)
        return ser

    contour = contourf
    pcolormesh = contourf

    def fill_between(self, x, y1, y2=0, color=None, alpha=0.3, label=None, **kw):
        xs = _nums(x)
        y1s = _nums(y1)
        y2s = _nums(y2) if not isinstance(y2, (int, float)) else [float(y2)] * len(xs)
        self.series.append({'t': 'band', 'x': xs, 'y1': y1s, 'y2': y2s, 'color': _color(color) or self._next_color(), 'alpha': alpha, 'label': label})

    def axhline(self, y=0, color=None, linestyle='-', linewidth=1.5, label=None, **kw):
        self.series.append({'t': 'hline', 'y': float(y), 'color': _color(color) or '#9CA3AF', 'ls': linestyle, 'lw': linewidth, 'label': label})

    def axvline(self, x=0, color=None, linestyle='-', linewidth=1.5, label=None, **kw):
        self.series.append({'t': 'vline', 'x': float(x), 'color': _color(color) or '#9CA3AF', 'ls': linestyle, 'lw': linewidth, 'label': label})

    def text(self, x, y, s, color=None, fontsize=None, **kw):
        self.series.append({'t': 'text', 'x': float(x), 'y': float(y), 's': str(s), 'color': _color(color), 'fs': fontsize})

    def annotate(self, text, xy, xytext=None, color=None, **kw):
        p = xytext or xy
        self.text(p[0], p[1], text, color=color)

    def errorbar(self, x, y, yerr=None, xerr=None, fmt='', label=None, color=None, **kw):
        self.plot(x, y, fmt, label=label, color=color)
        if yerr is not None:
            ye = _np.asarray(yerr, dtype=float)
            ya = _np.asarray(y, dtype=float)
            self.series.append({'t': 'yerr', 'x': _nums(x), 'lo': _nums(ya - ye), 'hi': _nums(ya + ye), 'color': self.series[-1]['color']})

    def pie(self, x, labels=None, autopct=None, colors=None, startangle=0, **kw):
        vals = _nums(x)
        tot = sum(vals)
        cols = [_color(c) for c in colors] if colors else [_CYCLE[i % len(_CYCLE)] for i in range(len(vals))]
        self.series.append({'t': 'pie', 'v': vals, 'labels': [str(v) for v in labels] if labels else None, 'colors': cols, 'pct': bool(autopct), 'tot': tot})
        self.equal = True
        self.off = True

    def boxplot(self, data, labels=None, **kw):
        if not isinstance(data, (list, tuple)) or (data and not hasattr(data[0], '__len__')):
            data = [data]
        boxes = []
        for d in data:
            a = _np.sort(_np.asarray(d, dtype=float).ravel())
            q1, med, q3 = [float(v) for v in _np.percentile(a, [25, 50, 75])]
            iqr = q3 - q1
            lo = float(a[a >= q1 - 1.5 * iqr].min())
            hi = float(a[a <= q3 + 1.5 * iqr].max())
            out = [_num(v) for v in a[(a < lo) | (a > hi)].tolist()]
            boxes.append({'q1': _num(q1), 'med': _num(med), 'q3': _num(q3), 'lo': _num(lo), 'hi': _num(hi), 'out': out})
        self.series.append({'t': 'box', 'boxes': boxes, 'labels': [str(v) for v in labels] if labels else None, 'color': self._next_color()})

    def stem(self, x, y=None, **kw):
        if y is None:
            y = x
            x = list(range(len(y)))
        self.series.append({'t': 'stem', 'x': _nums(x), 'y': _nums(y), 'color': self._next_color()})

    def step(self, x, y, where='pre', **kw):
        self.plot(x, y, **kw)
        self.series[-1]['t'] = 'step'

    def semilogy(self, *a, **k):
        self.yscale = 'log'
        return self.plot(*a, **k)

    def semilogx(self, *a, **k):
        self.xscale = 'log'
        return self.plot(*a, **k)

    def loglog(self, *a, **k):
        self.xscale = self.yscale = 'log'
        return self.plot(*a, **k)

    # ---- decoración ----
    def set_title(self, t, **kw):
        self.title = str(t)

    def set_xlabel(self, t, **kw):
        self.xlabel = str(t)

    def set_ylabel(self, t, **kw):
        self.ylabel = str(t)

    def set_xlim(self, a=None, b=None, **kw):
        if isinstance(a, (tuple, list)):
            a, b = a
        self._xlim = [None if a is None else float(a), None if b is None else float(b)]

    def set_ylim(self, a=None, b=None, **kw):
        if isinstance(a, (tuple, list)):
            a, b = a
        self._ylim = [None if a is None else float(a), None if b is None else float(b)]

    def set_xticks(self, ticks, labels=None, **kw):
        self.xticks = _nums(ticks)
        if labels is not None:
            self.xticklabels = [str(v) for v in labels]

    def set_yticks(self, ticks, labels=None, **kw):
        self.yticks = _nums(ticks)
        if labels is not None:
            self.yticklabels = [str(v) for v in labels]

    def set_xticklabels(self, labels, **kw):
        self.xticklabels = [str(v) for v in labels]

    def set_yticklabels(self, labels, **kw):
        self.yticklabels = [str(v) for v in labels]

    def set_xscale(self, s):
        self.xscale = s

    def set_yscale(self, s):
        self.yscale = s

    def grid(self, visible=True, *a, **kw):
        self.grid_on = bool(visible) if visible is not None else True

    def legend(self, *a, **kw):
        self.legend_on = True

    def axis(self, arg=None, *a, **kw):
        if arg == 'equal' or arg == 'scaled' or arg == 'square':
            self.equal = True
        elif arg == 'off':
            self.off = True
        elif isinstance(arg, (list, tuple)) and len(arg) == 4:
            self._xlim = [float(arg[0]), float(arg[1])]
            self._ylim = [float(arg[2]), float(arg[3])]

    def invert_yaxis(self):
        self._ylim = self._ylim or [None, None]
        self._ylim.append('invert')

    def tick_params(self, *a, **kw):
        pass

    def set(self, **kw):
        for k, v in kw.items():
            getattr(self, 'set_' + k)(v)

    def spec(self):
        return {'pos': list(self.pos), 'title': self.title, 'xlabel': self.xlabel, 'ylabel': self.ylabel, 'xlim': self._xlim, 'ylim': self._ylim,
                'grid': self.grid_on, 'legend': self.legend_on, 'equal': self.equal, 'off': self.off, 'xscale': self.xscale, 'yscale': self.yscale,
                'xticks': self.xticks, 'xticklabels': self.xticklabels, 'yticks': self.yticks, 'yticklabels': self.yticklabels, 'series': self.series}


class AxesGrid:
    def __init__(self, rows, one_d=False):
        self._rows = rows
        self._one = one_d
        self.shape = (len(rows[0]),) if one_d else (len(rows), len(rows[0]) if rows else 0)

    def flatten(self):
        return [a for r in self._rows for a in r]

    ravel = flatten

    def __iter__(self):
        return iter(self._rows[0] if self._one else self._rows)

    def __len__(self):
        return len(self._rows[0]) if self._one else len(self._rows)

    def __getitem__(self, k):
        if self._one:
            return self._rows[0][k]
        if isinstance(k, tuple):
            r, c = k
            if isinstance(r, slice) or isinstance(c, slice):
                return [a for row in self._rows[r] for a in (row[c] if isinstance(c, slice) else [row[c]])]
            return self._rows[r][c]
        return self._rows[k]


class Figure:
    def __init__(self, figsize=(6.4, 4.8)):
        self.figsize = (float(figsize[0]), float(figsize[1]))
        self.axes = []
        self.suptitle_text = ''
        self.shown = False

    def add_subplot(self, nrows=1, ncols=1, index=1, **kw):
        if isinstance(nrows, int) and ncols == 1 and index == 1 and nrows >= 111:
            n = nrows
            nrows, ncols, index = n // 100, (n // 10) % 10, n % 10
        r, c = divmod(index - 1, ncols)
        for a in self.axes:
            if a.pos == (r, c, nrows, ncols):
                return a
        ax = Axes(self, r, c, nrows, ncols)
        self.axes.append(ax)
        return ax

    def suptitle(self, t, **kw):
        self.suptitle_text = str(t)

    def tight_layout(self, *a, **k):
        pass

    def colorbar(self, *a, **k):
        pass

    def savefig(self, *a, **k):
        pass

    def spec(self):
        return {'w': self.figsize[0], 'h': self.figsize[1], 'title': self.suptitle_text, 'axes': [a.spec() for a in self.axes if a.series or a.title]}

    def show(self):
        s = self.spec()
        if s['axes']:
            _dojo.figure(_json.dumps(s, separators=(',', ':')))
        self.shown = True


_figs = []
_cur = [None]


def figure(figsize=None, num=None, **kw):
    f = Figure(figsize or (6.4, 4.8))
    _figs.append(f)
    _cur[0] = f
    return f


def gcf():
    if _cur[0] is None:
        figure()
    return _cur[0]


def gca():
    f = gcf()
    if not f.axes:
        f.add_subplot(1, 1, 1)
    return f.axes[-1]


def subplot(nrows, ncols=1, index=1, **kw):
    return gcf().add_subplot(nrows, ncols, index)


def subplots(nrows=1, ncols=1, figsize=None, sharex=False, sharey=False, squeeze=True, **kw):
    f = figure(figsize or (6.4 * (1 if ncols == 1 else min(ncols, 3) * 0.75 + 0.25), 4.8 * (1 if nrows == 1 else min(nrows, 3) * 0.75 + 0.25)))
    rows = [[f.add_subplot(nrows, ncols, r * ncols + c + 1) for c in range(ncols)] for r in range(nrows)]
    if nrows == 1 and ncols == 1:
        return f, rows[0][0]
    if squeeze and (nrows == 1 or ncols == 1):
        return f, AxesGrid([[a for r in rows for a in r]], one_d=True)
    return f, AxesGrid(rows)


def _call(name):
    def fn(*a, **k):
        return getattr(gca(), name)(*a, **k)
    fn.__name__ = name
    return fn


plot = _call('plot')
scatter = _call('scatter')
bar = _call('bar')
barh = _call('barh')
hist = _call('hist')
imshow = _call('imshow')
contourf = _call('contourf')
contour = _call('contour')
pcolormesh = _call('pcolormesh')
fill_between = _call('fill_between')
axhline = _call('axhline')
axvline = _call('axvline')
text = _call('text')
annotate = _call('annotate')
errorbar = _call('errorbar')
pie = _call('pie')
boxplot = _call('boxplot')
stem = _call('stem')
step = _call('step')
semilogy = _call('semilogy')
semilogx = _call('semilogx')
loglog = _call('loglog')
legend = _call('legend')
grid = _call('grid')
axis = _call('axis')
tick_params = _call('tick_params')
invert_yaxis = _call('invert_yaxis')


def title(t, **kw):
    gca().set_title(t)


def xlabel(t, **kw):
    gca().set_xlabel(t)


def ylabel(t, **kw):
    gca().set_ylabel(t)


def xlim(a=None, b=None):
    gca().set_xlim(a, b)


def ylim(a=None, b=None):
    gca().set_ylim(a, b)


def xticks(ticks=None, labels=None, **kw):
    if ticks is not None:
        gca().set_xticks(ticks, labels)


def yticks(ticks=None, labels=None, **kw):
    if ticks is not None:
        gca().set_yticks(ticks, labels)


def xscale(s):
    gca().xscale = s


def yscale(s):
    gca().yscale = s


def suptitle(t, **kw):
    gcf().suptitle(t)


def tight_layout(*a, **k):
    pass


def colorbar(*a, **k):
    pass


def savefig(*a, **k):
    pass


def show(*a, **k):
    for f in list(_figs):
        if not f.shown:
            f.show()
    _figs.clear()
    _cur[0] = None


def close(*a, **k):
    _figs.clear()
    _cur[0] = None


def clf():
    _figs.clear()
    _cur[0] = None


cla = clf


class _Style:
    available = ['default', 'seaborn', 'ggplot', 'dark_background']

    def use(self, *a, **k):
        pass


style = _Style()
rcParams = {}


class _Cmap:
    def __init__(self, name):
        self.name = name

    def __call__(self, v):
        return (0.3, 0.5, 0.8, 1.0)


class _Cm:
    def __getattr__(self, name):
        return _Cmap(name)


cm = _Cm()


def get_cmap(name='viridis'):
    return _Cmap(name)
`;

registerPy('matplotlib', () => '', true);
registerPy('matplotlib.pyplot', () => PYPLOT);
registerPy('matplotlib.cm', () => "from matplotlib.pyplot import cm, get_cmap\n");
registerPy('matplotlib.colors', () => "class ListedColormap:\n    def __init__(self, colors, name='custom'):\n        self.colors = colors\n        self.name = 'tab10'\n");
