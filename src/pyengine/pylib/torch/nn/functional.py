import math
import numpy as np
import torch
from torch import Tensor, _as_np, _rng


def relu(x, inplace=False):
    return x.relu()


def leaky_relu(x, negative_slope=0.01, inplace=False):
    return x.leaky_relu(negative_slope)


def sigmoid(x):
    return x.sigmoid()


def tanh(x):
    return x.tanh()


def gelu(x, approximate='none'):
    return x.gelu(approximate)


def softplus(x):
    return x.softplus()


def silu(x):
    return x * x.sigmoid()


def elu(x, alpha=1.0):
    return torch.where(x > 0, x, alpha * (x.exp() - 1))


def softmax(x, dim=-1):
    return torch.softmax(x, dim)


def log_softmax(x, dim=-1):
    return torch.log_softmax(x, dim)


def linear(x, weight, bias=None):
    torch._check_mm(x, weight.T, 'addmm')
    out = x @ weight.T
    return out + bias if bias is not None else out


def dropout(x, p=0.5, training=True, inplace=False):
    if not training or p == 0:
        return x
    keep = (_rng.uniform(0, 1, x._a.shape) >= p).astype(np.float64) / (1.0 - p)
    return x * torch.tensor(keep)


def _reduce(loss, reduction):
    if reduction == 'mean':
        return loss.mean()
    if reduction == 'sum':
        return loss.sum()
    return loss


def mse_loss(input, target, reduction='mean'):
    d = input - target
    return _reduce(d * d, reduction)


def l1_loss(input, target, reduction='mean'):
    return _reduce((input - target).abs(), reduction)


def smooth_l1_loss(input, target, beta=1.0, reduction='mean'):
    d = (input - target).abs()
    loss = torch.where(d < beta, 0.5 * d * d / beta, d - 0.5 * beta)
    return _reduce(loss, reduction)


huber_loss = smooth_l1_loss


def nll_loss(input, target, weight=None, reduction='mean'):
    t = _as_np(target).astype(np.int64)
    if input._a.ndim >= 2 and t.size:
        k = input._a.shape[1]
        bad = t[(t < 0) | (t >= k)]
        if bad.size:
            raise IndexError('Target %d is out of bounds.' % int(bad[0]))
    idx = torch.tensor(t.reshape(-1, 1)) if input._a.ndim == 2 else None
    if input._a.ndim == 2:
        picked = input.gather(1, idx).reshape(-1)
        loss = -picked
        if weight is not None:
            w = torch.tensor(_as_np(weight)[t])
            loss = loss * w
            if reduction == 'mean':
                return loss.sum() / w.sum()
        return _reduce(loss, reduction)
    picked = input[t]
    return _reduce(-picked, reduction)


def cross_entropy(input, target, weight=None, reduction='mean', label_smoothing=0.0):
    lp = torch.log_softmax(input, -1)
    t = target
    if t._dtype.is_floating_point and t._a.shape != input._a.shape:
        raise RuntimeError('expected target dtype to be Long or Byte, but got %s' % torch._DT_C[t._dtype.name])
    if t._dtype.is_floating_point:
        loss = -(lp * t).sum(-1)
        return _reduce(loss, reduction)
    if label_smoothing > 0:
        k = input.shape[-1]
        nll = nll_loss(lp, t, weight, 'none')
        smooth = -lp.sum(-1) / k
        return _reduce((1 - label_smoothing) * nll + label_smoothing * smooth, reduction)
    return nll_loss(lp, t, weight, reduction)


def binary_cross_entropy(input, target, weight=None, reduction='mean'):
    eps = 1e-12
    p = input.clamp(eps, 1 - eps)
    loss = -(target * p.log() + (1 - target) * (1 - p).log())
    return _reduce(loss, reduction)


def binary_cross_entropy_with_logits(input, target, weight=None, reduction='mean', pos_weight=None):
    loss = input.clamp(min=0) - input * target + (1 + (-input.abs()).exp()).log()
    if pos_weight is not None:
        lw = 1 + (pos_weight - 1) * target
        loss = (1 - target) * input + lw * ((1 + (-input.abs()).exp()).log() + (-input).clamp(min=0))
    return _reduce(loss, reduction)


def one_hot(t, num_classes=-1):
    a = _as_np(t).astype(np.int64)
    n = int(a.max()) + 1 if num_classes < 0 else num_classes
    out = np.zeros(a.shape + (n,), dtype=np.int64)
    np.put_along_axis(out, a[..., None], 1, axis=-1)
    return torch.tensor(out)


def normalize(x, p=2.0, dim=1, eps=1e-12):
    n = (x * x).sum(dim, keepdim=True).sqrt() if p == 2 else x.abs().sum(dim, keepdim=True)
    return x / n.clamp(min=eps)


def cosine_similarity(a, b, dim=1, eps=1e-8):
    return torch.cosine_similarity(a, b, dim, eps)


def embedding(idx, weight):
    i = _as_np(idx).astype(np.int64)
    if i.size and (i.max() >= weight._a.shape[0] or i.min() < 0):
        raise IndexError('index out of range in self')
    flat = weight.index_select(0, i.reshape(-1))
    return flat.reshape(list(i.shape) + [weight.shape[1]])


def layer_norm(x, normalized_shape, weight=None, bias=None, eps=1e-5):
    nd = len(normalized_shape) if isinstance(normalized_shape, (tuple, list)) else 1
    dims = tuple(range(-nd, 0))
    mu = x.mean(dims, keepdim=True)
    var = ((x - mu) ** 2).mean(dims, keepdim=True)
    y = (x - mu) / (var + eps).sqrt()
    if weight is not None:
        y = y * weight
    if bias is not None:
        y = y + bias
    if y._name is not None:
        y._name = 'NativeLayerNormBackward0'
    return y


def batch_norm(x, running_mean, running_var, weight=None, bias=None, training=False, momentum=0.1, eps=1e-5):
    axes = (0,) if x._a.ndim == 2 else (0, 2, 3)
    shape = [1, -1] + [1] * (x._a.ndim - 2)
    if training:
        mu = x.mean(axes, keepdim=True)
        var = ((x - mu) ** 2).mean(axes, keepdim=True)
        n = x._a.size // x._a.shape[1]
        if running_mean is not None:
            running_mean._a[...] = (1 - momentum) * running_mean._a + momentum * mu._a.reshape(-1)
            running_var._a[...] = (1 - momentum) * running_var._a + momentum * var._a.reshape(-1) * n / max(n - 1, 1)
        y = (x - mu) / (var + eps).sqrt()
    else:
        y = (x - running_mean.reshape(shape)) / (running_var.reshape(shape) + eps).sqrt()
    if weight is not None:
        y = y * weight.reshape(shape)
    if bias is not None:
        y = y + bias.reshape(shape)
    if y._name is not None:
        y._name = 'NativeBatchNormBackward0'
    return y


def scaled_dot_product_attention(q, k, v, attn_mask=None, dropout_p=0.0, is_causal=False, scale=None):
    d = q.shape[-1]
    s = (q @ k.transpose(-2, -1)) * (scale if scale is not None else 1.0 / math.sqrt(d))
    if is_causal:
        n, m = s.shape[-2], s.shape[-1]
        mask = np.triu(np.ones((n, m), dtype=np.bool_), 1)
        s = s.masked_fill(torch.tensor(mask), -1e30)
    if attn_mask is not None:
        am = _as_np(attn_mask)
        s = s.masked_fill(torch.tensor(~am.astype(np.bool_)), -1e30) if am.dtype == np.bool_ else s + attn_mask
    return softmax(s, -1) @ v


def pad(x, pad, mode='constant', value=0.0):
    nd = x._a.ndim
    widths = [(0, 0)] * nd
    for i in range(len(pad) // 2):
        widths[nd - 1 - i] = (pad[2 * i], pad[2 * i + 1])
    res = np.pad(x._a, widths, constant_values=value)

    def bwd(g):
        sl = tuple(slice(w[0], g.shape[d] - w[1]) for d, w in enumerate(widths))
        return (g[sl],)
    return Tensor._wrap(res, x._dtype, (x,), 'ConstantPadNdBackward0', bwd)


# ───────────────────────── convoluciones y pooling ─────────────────────────


def _pair(v):
    return (v, v) if isinstance(v, int) else tuple(v)


def _im2col(xp, kh, kw, sh, sw, oh, ow):
    n, c = xp.shape[0], xp.shape[1]
    cols = np.zeros((n, c, kh, kw, oh, ow))
    for i in range(kh):
        for j in range(kw):
            cols[:, :, i, j] = xp[:, :, i:i + sh * oh:sh, j:j + sw * ow:sw]
    return cols


def _col2im(gc, shape, kh, kw, sh, sw, oh, ow):
    gx = np.zeros(shape)
    for i in range(kh):
        for j in range(kw):
            gx[:, :, i:i + sh * oh:sh, j:j + sw * ow:sw] += gc[:, :, i, j]
    return gx


def conv2d(x, weight, bias=None, stride=1, padding=0):
    if x._a.ndim == 3:
        return conv2d(x.unsqueeze(0), weight, bias, stride, padding).squeeze(0)
    if x._a.ndim != 4:
        raise RuntimeError('Expected 3D (unbatched) or 4D (batched) input to conv2d, but got input of size: %s' % (list(x._a.shape),))
    if x._a.shape[1] != weight._a.shape[1]:
        raise RuntimeError('Given groups=1, weight of size %s, expected input%s to have %d channels, but got %d channels instead' % (list(weight._a.shape), list(x._a.shape), weight._a.shape[1], x._a.shape[1]))
    sh, sw = _pair(stride)
    ph, pw = _pair(padding)
    xa, wa = x._a, weight._a
    n, c, h, w = xa.shape
    o, _, kh, kw = wa.shape
    oh = (h + 2 * ph - kh) // sh + 1
    ow = (w + 2 * pw - kw) // sw + 1
    xp = np.pad(xa, ((0, 0), (0, 0), (ph, ph), (pw, pw))) if (ph or pw) else xa
    cols = _im2col(xp, kh, kw, sh, sw, oh, ow)
    cols2 = cols.reshape(n, c * kh * kw, oh * ow)
    w2 = wa.reshape(o, c * kh * kw)
    out = np.matmul(w2, cols2).reshape(n, o, oh, ow)
    if bias is not None:
        out = out + bias._a.reshape(1, o, 1, 1)
    parents = (x, weight) + ((bias,) if bias is not None else ())

    def bwd(g):
        g2 = g.reshape(n, o, oh * ow)
        gw = np.matmul(g2, np.swapaxes(cols2, 1, 2)).sum(axis=0).reshape(wa.shape)
        gc = np.matmul(w2.T, g2).reshape(n, c, kh, kw, oh, ow)
        gxp = _col2im(gc, xp.shape, kh, kw, sh, sw, oh, ow)
        gx = gxp[:, :, ph:ph + h, pw:pw + w] if (ph or pw) else gxp
        res = (gx, gw)
        if bias is not None:
            res = res + (g.sum(axis=(0, 2, 3)),)
        return res
    return Tensor._wrap(out, x._dtype, parents, 'ConvolutionBackward0', bwd)


def max_pool2d(x, kernel_size, stride=None, padding=0):
    kh, kw = _pair(kernel_size)
    sh, sw = _pair(stride if stride is not None else kernel_size)
    xa = x._a
    n, c, h, w = xa.shape
    oh = (h - kh) // sh + 1
    ow = (w - kw) // sw + 1
    cols = _im2col(xa, kh, kw, sh, sw, oh, ow).reshape(n, c, kh * kw, oh, ow)
    idx = cols.argmax(axis=2)
    out = np.take_along_axis(cols, idx[:, :, None], axis=2)[:, :, 0]

    def bwd(g):
        gc = np.zeros((n, c, kh * kw, oh, ow))
        np.put_along_axis(gc, idx[:, :, None], g[:, :, None], axis=2)
        return (_col2im(gc.reshape(n, c, kh, kw, oh, ow), xa.shape, kh, kw, sh, sw, oh, ow),)
    return Tensor._wrap(out, x._dtype, (x,), 'MaxPool2DWithIndicesBackward0', bwd)


def avg_pool2d(x, kernel_size, stride=None, padding=0):
    kh, kw = _pair(kernel_size)
    sh, sw = _pair(stride if stride is not None else kernel_size)
    xa = x._a
    n, c, h, w = xa.shape
    oh = (h - kh) // sh + 1
    ow = (w - kw) // sw + 1
    cols = _im2col(xa, kh, kw, sh, sw, oh, ow)
    out = cols.mean(axis=(2, 3))

    def bwd(g):
        gc = np.broadcast_to(g[:, :, None, None] / (kh * kw), (n, c, kh, kw, oh, ow))
        return (_col2im(gc, xa.shape, kh, kw, sh, sw, oh, ow),)
    return Tensor._wrap(out, x._dtype, (x,), 'AvgPool2DBackward0', bwd)


def adaptive_avg_pool2d(x, output_size=1):
    return x.mean((2, 3), keepdim=True)


max_pool1d = None
