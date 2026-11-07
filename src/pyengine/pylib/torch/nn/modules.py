import math
import numpy as np
import torch
from torch import Tensor, _rng
from torch.nn import functional as F
from torch.nn.parameter import Parameter
from collections import OrderedDict


class _IncompatibleKeys:
    def __init__(self, missing_keys, unexpected_keys):
        self.missing_keys = missing_keys
        self.unexpected_keys = unexpected_keys

    def __repr__(self):
        if not self.missing_keys and not self.unexpected_keys:
            return '<All keys matched successfully>'
        return '_IncompatibleKeys(missing_keys=%r, unexpected_keys=%r)' % (self.missing_keys, self.unexpected_keys)


class Module:
    def __init__(self):
        d = self.__dict__
        d['_parameters'] = OrderedDict()
        d['_modules'] = OrderedDict()
        d['_buffers'] = OrderedDict()
        d['training'] = True

    def __setattr__(self, name, value):
        d = self.__dict__
        if '_parameters' not in d:
            raise AttributeError("cannot assign module before Module.__init__() call")
        if isinstance(value, Parameter):
            d['_modules'].pop(name, None)
            d['_parameters'][name] = value
        elif isinstance(value, Module):
            d['_parameters'].pop(name, None)
            d['_modules'][name] = value
        elif name in d['_parameters'] and value is None:
            d['_parameters'][name] = None
        elif name in d['_buffers']:
            d['_buffers'][name] = value
        else:
            d[name] = value

    def __getattr__(self, name):
        d = self.__dict__
        for store in ('_parameters', '_modules', '_buffers'):
            if store in d and name in d[store]:
                return d[store][name]
        raise AttributeError("'%s' object has no attribute '%s'" % (type(self).__name__, name))

    def __delattr__(self, name):
        d = self.__dict__
        for store in ('_parameters', '_modules', '_buffers'):
            if name in d[store]:
                del d[store][name]
                return
        del d[name]

    def register_buffer(self, name, tensor, persistent=True):
        self.__dict__['_buffers'][name] = tensor

    def register_parameter(self, name, param):
        self.__dict__['_parameters'][name] = param

    def add_module(self, name, module):
        self.__dict__['_modules'][name] = module

    register_module = add_module

    def forward(self, *a, **k):
        raise NotImplementedError('Module [%s] is missing the required "forward" function' % type(self).__name__)

    def __call__(self, *a, **k):
        return self.forward(*a, **k)

    def parameters(self, recurse=True):
        for _, p in self.named_parameters(recurse=recurse):
            yield p

    def named_parameters(self, prefix='', recurse=True):
        seen = set()
        for n, p in self._parameters.items():
            if p is not None and id(p) not in seen:
                seen.add(id(p))
                yield (prefix + n, p)
        if recurse:
            for mn, m in self._modules.items():
                for n, p in m.named_parameters(prefix + mn + '.'):
                    if id(p) not in seen:
                        seen.add(id(p))
                        yield (n, p)

    def buffers(self):
        for _, b in self.named_buffers():
            yield b

    def named_buffers(self, prefix=''):
        for n, b in self._buffers.items():
            if b is not None:
                yield (prefix + n, b)
        for mn, m in self._modules.items():
            for item in m.named_buffers(prefix + mn + '.'):
                yield item

    def children(self):
        for m in self._modules.values():
            yield m

    def named_children(self):
        for n, m in self._modules.items():
            yield (n, m)

    def modules(self):
        yield self
        for m in self._modules.values():
            for sub in m.modules():
                yield sub

    def named_modules(self, prefix=''):
        yield (prefix, self)
        for n, m in self._modules.items():
            for item in m.named_modules(prefix + ('.' if prefix else '') + n):
                yield item

    def train(self, mode=True):
        self.__dict__['training'] = mode
        for m in self._modules.values():
            m.train(mode)
        return self

    def eval(self):
        return self.train(False)

    def zero_grad(self, set_to_none=True):
        for p in self.parameters():
            if set_to_none:
                p.grad = None
            elif p.grad is not None:
                p.grad._a[...] = 0

    def requires_grad_(self, flag=True):
        for p in self.parameters():
            p.requires_grad = flag
        return self

    def apply(self, fn):
        for m in self.children():
            m.apply(fn)
        fn(self)
        return self

    def to(self, *a, **k):
        return self

    def cpu(self):
        return self

    def float(self):
        return self

    def double(self):
        return self

    def state_dict(self):
        out = OrderedDict()
        for n, p in self.named_parameters():
            out[n] = p.detach().clone()
        for n, b in self.named_buffers():
            out[n] = b.detach().clone()
        return out

    def load_state_dict(self, state, strict=True):
        own = dict(self.named_parameters())
        own.update(dict(self.named_buffers()))
        unexpected = [k for k in state if k not in own]
        missing = [k for k in own if k not in state]
        if strict:
            msgs = []
            if unexpected:
                msgs.append('Unexpected key(s) in state_dict: %s.' % ', '.join('"%s"' % k for k in unexpected))
            if missing:
                msgs.append('Missing key(s) in state_dict: %s.' % ', '.join('"%s"' % k for k in missing))
            if msgs:
                raise RuntimeError('Error(s) in loading state_dict for %s:\n\t%s' % (type(self).__name__, '\n\t'.join(msgs)))
        for k, v in state.items():
            if k in own:
                if tuple(own[k]._a.shape) != tuple(v._a.shape):
                    raise RuntimeError('Error(s) in loading state_dict for %s:\n\tsize mismatch for %s: copying a param with shape %s from checkpoint, the shape in current model is %s.' % (type(self).__name__, k, tuple(v._a.shape), tuple(own[k]._a.shape)))
                own[k]._a[...] = v._a
        return _IncompatibleKeys(missing, unexpected)

    def extra_repr(self):
        return ''

    def __repr__(self):
        extra = self.extra_repr()
        if not self._modules:
            return '%s(%s)' % (type(self).__name__, extra)
        lines = []
        for n, m in self._modules.items():
            sub = repr(m).split('\n')
            lines.append('  (%s): %s' % (n, '\n  '.join(sub)))
        head = type(self).__name__ + '('
        return head + ('\n' + extra if extra else '') + '\n' + '\n'.join(lines) + '\n)'


class Identity(Module):
    def forward(self, x):
        return x


class Linear(Module):
    def __init__(self, in_features, out_features, bias=True):
        super().__init__()
        self.in_features = in_features
        self.out_features = out_features
        b = 1.0 / math.sqrt(in_features)
        self.weight = Parameter(_rng.uniform(-b, b, (out_features, in_features)))
        self.bias = Parameter(_rng.uniform(-b, b, (out_features,))) if bias else None

    def forward(self, x):
        torch._check_mm(x, self.weight.T, 'addmm')
        out = x @ self.weight.T
        if self.bias is None:
            return out
        res = out + self.bias
        if x._a.ndim == 2 and res._name is not None:
            res._name = 'AddmmBackward0'
        return res

    def extra_repr(self):
        return 'in_features=%d, out_features=%d, bias=%s' % (self.in_features, self.out_features, self.bias is not None)


class Bilinear(Module):
    pass


class Sequential(Module):
    def __init__(self, *args):
        super().__init__()
        if len(args) == 1 and isinstance(args[0], OrderedDict):
            for k, m in args[0].items():
                self.add_module(k, m)
        else:
            for i, m in enumerate(args):
                self.add_module(str(i), m)

    def forward(self, x):
        for m in self._modules.values():
            x = m(x)
        return x

    def __getitem__(self, i):
        mods = list(self._modules.values())
        if isinstance(i, slice):
            return Sequential(*mods[i])
        return mods[i]

    def __len__(self):
        return len(self._modules)

    def __iter__(self):
        return iter(self._modules.values())

    def append(self, m):
        self.add_module(str(len(self._modules)), m)
        return self


class ModuleList(Module):
    def __init__(self, modules=None):
        super().__init__()
        for m in (modules or []):
            self.append(m)

    def append(self, m):
        self.add_module(str(len(self._modules)), m)
        return self

    def __getitem__(self, i):
        return list(self._modules.values())[i]

    def __len__(self):
        return len(self._modules)

    def __iter__(self):
        return iter(self._modules.values())


class ModuleDict(Module):
    def __init__(self, modules=None):
        super().__init__()
        for k, m in (modules or {}).items():
            self.add_module(k, m)

    def __getitem__(self, k):
        return self._modules[k]


class ParameterList(Module):
    def __init__(self, params=None):
        super().__init__()
        for i, p in enumerate(params or []):
            self.register_parameter(str(i), p)

    def __getitem__(self, i):
        return list(self._parameters.values())[i]

    def __iter__(self):
        return iter(self._parameters.values())


def _act(name, fn, extra=''):
    class A(Module):
        def forward(self, x):
            return fn(x)

        def extra_repr(self):
            return extra
    A.__name__ = name
    return A


ReLU = _act('ReLU', F.relu)
Sigmoid = _act('Sigmoid', F.sigmoid)
Tanh = _act('Tanh', F.tanh)
GELU = _act('GELU', F.gelu)
SiLU = _act('SiLU', F.silu)
Softplus = _act('Softplus', F.softplus)
ELU = _act('ELU', F.elu)


class LeakyReLU(Module):
    def __init__(self, negative_slope=0.01):
        super().__init__()
        self.negative_slope = negative_slope

    def forward(self, x):
        return F.leaky_relu(x, self.negative_slope)

    def extra_repr(self):
        return 'negative_slope=%s' % self.negative_slope


class Softmax(Module):
    def __init__(self, dim=None):
        super().__init__()
        self.dim = dim

    def forward(self, x):
        return F.softmax(x, -1 if self.dim is None else self.dim)

    def extra_repr(self):
        return 'dim=%s' % self.dim


class LogSoftmax(Softmax):
    def forward(self, x):
        return F.log_softmax(x, -1 if self.dim is None else self.dim)


class Dropout(Module):
    def __init__(self, p=0.5, inplace=False):
        super().__init__()
        self.p = p

    def forward(self, x):
        return F.dropout(x, self.p, self.training)

    def extra_repr(self):
        return 'p=%s, inplace=False' % self.p


Dropout2d = Dropout


class Flatten(Module):
    def __init__(self, start_dim=1, end_dim=-1):
        super().__init__()
        self.start_dim = start_dim
        self.end_dim = end_dim

    def forward(self, x):
        return x.flatten(self.start_dim, self.end_dim)

    def extra_repr(self):
        return 'start_dim=%d, end_dim=%d' % (self.start_dim, self.end_dim)


class Unflatten(Module):
    def __init__(self, dim, unflattened_size):
        super().__init__()
        self.dim = dim
        self.size = unflattened_size

    def forward(self, x):
        d = self.dim % x._a.ndim
        return x.reshape(list(x.shape[:d]) + list(self.size) + list(x.shape[d + 1:]))


class Embedding(Module):
    def __init__(self, num_embeddings, embedding_dim, padding_idx=None):
        super().__init__()
        self.num_embeddings = num_embeddings
        self.embedding_dim = embedding_dim
        self.weight = Parameter(_rng.standard_normal((num_embeddings, embedding_dim)))

    def forward(self, idx):
        return F.embedding(idx, self.weight)

    def extra_repr(self):
        return '%d, %d' % (self.num_embeddings, self.embedding_dim)


class LayerNorm(Module):
    def __init__(self, normalized_shape, eps=1e-5, elementwise_affine=True):
        super().__init__()
        self.normalized_shape = (normalized_shape,) if isinstance(normalized_shape, int) else tuple(normalized_shape)
        self.eps = eps
        if elementwise_affine:
            self.weight = Parameter(np.ones(self.normalized_shape))
            self.bias = Parameter(np.zeros(self.normalized_shape))
        else:
            self.weight = None
            self.bias = None

    def forward(self, x):
        return F.layer_norm(x, self.normalized_shape, self.weight, self.bias, self.eps)

    def extra_repr(self):
        return '%s, eps=%s, elementwise_affine=%s' % (self.normalized_shape, self.eps, self.weight is not None)


class _BatchNorm(Module):
    def __init__(self, num_features, eps=1e-5, momentum=0.1, affine=True, track_running_stats=True):
        super().__init__()
        self.num_features = num_features
        self.eps = eps
        self.momentum = momentum
        self.weight = Parameter(np.ones(num_features)) if affine else None
        self.bias = Parameter(np.zeros(num_features)) if affine else None
        self.register_buffer('running_mean', torch.zeros(num_features))
        self.register_buffer('running_var', torch.ones(num_features))
        self.register_buffer('num_batches_tracked', torch.tensor(0))

    def forward(self, x):
        if self.training:
            self.num_batches_tracked.add_(1)
        return F.batch_norm(x, self.running_mean, self.running_var, self.weight, self.bias, self.training, self.momentum, self.eps)

    def extra_repr(self):
        return '%d, eps=%s, momentum=%s, affine=%s, track_running_stats=True' % (self.num_features, self.eps, self.momentum, self.weight is not None)


class BatchNorm1d(_BatchNorm):
    pass


class BatchNorm2d(_BatchNorm):
    pass


class Conv2d(Module):
    def __init__(self, in_channels, out_channels, kernel_size, stride=1, padding=0, bias=True):
        super().__init__()
        self.in_channels = in_channels
        self.out_channels = out_channels
        self.kernel_size = F._pair(kernel_size)
        self.stride = F._pair(stride)
        self.padding = F._pair(padding)
        fan_in = in_channels * self.kernel_size[0] * self.kernel_size[1]
        b = 1.0 / math.sqrt(fan_in)
        self.weight = Parameter(_rng.uniform(-b, b, (out_channels, in_channels) + self.kernel_size))
        self.bias = Parameter(_rng.uniform(-b, b, (out_channels,))) if bias else None

    def forward(self, x):
        return F.conv2d(x, self.weight, self.bias, self.stride, self.padding)

    def extra_repr(self):
        s = '%d, %d, kernel_size=%s, stride=%s' % (self.in_channels, self.out_channels, self.kernel_size, self.stride)
        if self.padding != (0, 0):
            s += ', padding=%s' % (self.padding,)
        if self.bias is None:
            s += ', bias=False'
        return s


class MaxPool2d(Module):
    def __init__(self, kernel_size, stride=None, padding=0):
        super().__init__()
        self.kernel_size = kernel_size
        self.stride = stride if stride is not None else kernel_size
        self.padding = padding

    def forward(self, x):
        return F.max_pool2d(x, self.kernel_size, self.stride)

    def extra_repr(self):
        return 'kernel_size=%s, stride=%s, padding=%s, dilation=1, ceil_mode=False' % (self.kernel_size, self.stride, self.padding)


class AvgPool2d(MaxPool2d):
    def forward(self, x):
        return F.avg_pool2d(x, self.kernel_size, self.stride)


class AdaptiveAvgPool2d(Module):
    def __init__(self, output_size=1):
        super().__init__()
        self.output_size = output_size

    def forward(self, x):
        return F.adaptive_avg_pool2d(x, self.output_size)


# ───────────────────────── pérdidas ─────────────────────────


class _Loss(Module):
    def __init__(self, reduction='mean', **kw):
        super().__init__()
        self.reduction = reduction
        self.kw = kw


class MSELoss(_Loss):
    def forward(self, input, target):
        return F.mse_loss(input, target, self.reduction)


class L1Loss(_Loss):
    def forward(self, input, target):
        return F.l1_loss(input, target, self.reduction)


class SmoothL1Loss(_Loss):
    def forward(self, input, target):
        return F.smooth_l1_loss(input, target, reduction=self.reduction)


HuberLoss = SmoothL1Loss


class CrossEntropyLoss(_Loss):
    def __init__(self, weight=None, reduction='mean', label_smoothing=0.0):
        super().__init__(reduction)
        self.weight = weight
        self.label_smoothing = label_smoothing

    def forward(self, input, target):
        return F.cross_entropy(input, target, self.weight, self.reduction, self.label_smoothing)


class NLLLoss(_Loss):
    def forward(self, input, target):
        return F.nll_loss(input, target, reduction=self.reduction)


class BCELoss(_Loss):
    def forward(self, input, target):
        return F.binary_cross_entropy(input, target, reduction=self.reduction)


class BCEWithLogitsLoss(_Loss):
    def __init__(self, weight=None, reduction='mean', pos_weight=None):
        super().__init__(reduction)
        self.pos_weight = pos_weight

    def forward(self, input, target):
        return F.binary_cross_entropy_with_logits(input, target, reduction=self.reduction, pos_weight=self.pos_weight)


# ───────────────────────── redes recurrentes ─────────────────────────


class _RNNBase(Module):
    mult = 1

    def __init__(self, input_size, hidden_size, num_layers=1, bias=True, batch_first=False, dropout=0.0, bidirectional=False):
        super().__init__()
        self.input_size = input_size
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.bias = bias
        self.batch_first = batch_first
        self.dropout = dropout
        self.bidirectional = bidirectional
        b = 1.0 / math.sqrt(hidden_size)
        m = self.mult
        dirs = 2 if bidirectional else 1
        for l in range(num_layers):
            ins = input_size if l == 0 else hidden_size * dirs
            for d in range(dirs):
                sfx = '_l%d%s' % (l, '_reverse' if d else '')
                self.register_parameter('weight_ih' + sfx, Parameter(_rng.uniform(-b, b, (m * hidden_size, ins))))
                self.register_parameter('weight_hh' + sfx, Parameter(_rng.uniform(-b, b, (m * hidden_size, hidden_size))))
                if bias:
                    self.register_parameter('bias_ih' + sfx, Parameter(_rng.uniform(-b, b, (m * hidden_size,))))
                    self.register_parameter('bias_hh' + sfx, Parameter(_rng.uniform(-b, b, (m * hidden_size,))))

    def extra_repr(self):
        s = '%d, %d' % (self.input_size, self.hidden_size)
        if self.num_layers != 1:
            s += ', num_layers=%d' % self.num_layers
        if not self.bias:
            s += ', bias=False'
        if self.batch_first:
            s += ', batch_first=True'
        if self.dropout:
            s += ', dropout=%s' % self.dropout
        if self.bidirectional:
            s += ', bidirectional=True'
        return s

    def _run(self, x, state, cell):
        unbatched = x._a.ndim == 2
        if unbatched:
            x = x.unsqueeze(1)
        elif self.batch_first:
            x = x.transpose(0, 1)
        t_len, bsz = x.shape[0], x.shape[1]
        dirs = 2 if self.bidirectional else 1
        zero_b = torch.zeros(self.mult * self.hidden_size)
        outputs = x
        finals = []
        for l in range(self.num_layers):
            outs = []
            for d in range(dirs):
                sfx = '_l%d%s' % (l, '_reverse' if d else '')
                wih = self._parameters['weight_ih' + sfx]
                whh = self._parameters['weight_hh' + sfx]
                bih = self._parameters['bias_ih' + sfx] if self.bias else zero_b
                bhh = self._parameters['bias_hh' + sfx] if self.bias else zero_b
                st = self._init_state(state, l * dirs + d, bsz, unbatched)
                seq = [None] * t_len
                for t in (range(t_len - 1, -1, -1) if d else range(t_len)):
                    st = cell(outputs[t], st, wih, whh, bih, bhh)
                    seq[t] = st[0] if isinstance(st, tuple) else st
                outs.append(torch.stack(seq, 0))
                finals.append(st)
            outputs = torch.cat(outs, -1) if dirs == 2 else outs[0]
            if self.dropout and self.training and l < self.num_layers - 1:
                outputs = F.dropout(outputs, self.dropout, True)
        if unbatched:
            outputs = outputs.squeeze(1)
        elif self.batch_first:
            outputs = outputs.transpose(0, 1)
        return outputs, finals, unbatched

    def _h0(self, state, i, bsz, unbatched):
        h = state[i]
        return h.unsqueeze(0) if unbatched else h


class RNN(_RNNBase):
    def __init__(self, input_size, hidden_size, num_layers=1, nonlinearity='tanh', bias=True, batch_first=False, dropout=0.0, bidirectional=False):
        super().__init__(input_size, hidden_size, num_layers, bias, batch_first, dropout, bidirectional)
        self.nonlinearity = nonlinearity

    def _init_state(self, state, i, bsz, unbatched):
        return self._h0(state, i, bsz, unbatched) if state is not None else torch.zeros(bsz, self.hidden_size)

    def forward(self, x, h0=None):
        act = (lambda v: v.tanh()) if self.nonlinearity == 'tanh' else (lambda v: v.relu())
        cell = lambda xt, h, wih, whh, bih, bhh: act(xt @ wih.T + bih + h @ whh.T + bhh)
        out, fin, unb = self._run(x, h0, cell)
        h = torch.stack(fin, 0)
        return out, (h.squeeze(1) if unb else h)


class GRU(_RNNBase):
    mult = 3

    def _init_state(self, state, i, bsz, unbatched):
        return self._h0(state, i, bsz, unbatched) if state is not None else torch.zeros(bsz, self.hidden_size)

    def forward(self, x, h0=None):
        H = self.hidden_size

        def cell(xt, h, wih, whh, bih, bhh):
            gi = xt @ wih.T + bih
            gh = h @ whh.T + bhh
            r = (gi[:, :H] + gh[:, :H]).sigmoid()
            z = (gi[:, H:2 * H] + gh[:, H:2 * H]).sigmoid()
            n = (gi[:, 2 * H:] + r * gh[:, 2 * H:]).tanh()
            return (1 - z) * n + z * h
        out, fin, unb = self._run(x, h0, cell)
        h = torch.stack(fin, 0)
        return out, (h.squeeze(1) if unb else h)


class LSTM(_RNNBase):
    mult = 4

    def _init_state(self, state, i, bsz, unbatched):
        if state is not None:
            return (self._h0(state[0], i, bsz, unbatched), self._h0(state[1], i, bsz, unbatched))
        return (torch.zeros(bsz, self.hidden_size), torch.zeros(bsz, self.hidden_size))

    def forward(self, x, state=None):
        H = self.hidden_size

        def cell(xt, st, wih, whh, bih, bhh):
            h, c = st
            g = xt @ wih.T + bih + h @ whh.T + bhh
            i = g[:, :H].sigmoid()
            f = g[:, H:2 * H].sigmoid()
            gg = g[:, 2 * H:3 * H].tanh()
            o = g[:, 3 * H:].sigmoid()
            c2 = f * c + i * gg
            return (o * c2.tanh(), c2)
        out, fin, unb = self._run(x, state, cell)
        hn = torch.stack([f[0] for f in fin], 0)
        cn = torch.stack([f[1] for f in fin], 0)
        return out, ((hn.squeeze(1), cn.squeeze(1)) if unb else (hn, cn))


class MultiheadAttention(Module):
    def __init__(self, embed_dim, num_heads, batch_first=False):
        super().__init__()
        self.embed_dim = embed_dim
        self.num_heads = num_heads
        self.batch_first = batch_first
        self.q_proj = Linear(embed_dim, embed_dim)
        self.k_proj = Linear(embed_dim, embed_dim)
        self.v_proj = Linear(embed_dim, embed_dim)
        self.out_proj = Linear(embed_dim, embed_dim)

    def forward(self, q, k, v, attn_mask=None, need_weights=True, is_causal=False):
        if not self.batch_first:
            q, k, v = q.transpose(0, 1), k.transpose(0, 1), v.transpose(0, 1)
        b, tq, e = q.shape
        h = self.num_heads
        d = e // h

        def split(x, t):
            return x.reshape(b, t, h, d).transpose(1, 2)
        Q, K, V = split(self.q_proj(q), tq), split(self.k_proj(k), k.shape[1]), split(self.v_proj(v), v.shape[1])
        s = (Q @ K.transpose(-2, -1)) * (1.0 / math.sqrt(d))
        if is_causal:
            mask = np.triu(np.ones((tq, k.shape[1]), dtype=np.bool_), 1)
            s = s.masked_fill(torch.tensor(mask), -1e30)
        w = F.softmax(s, -1)
        o = (w @ V).transpose(1, 2).reshape(b, tq, e)
        o = self.out_proj(o)
        if not self.batch_first:
            o = o.transpose(0, 1)
        return o, w.mean(1)
