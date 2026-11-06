"""torch.autograd en miniatura: grad() y backward()."""
import numpy as np
import torch
from torch import Tensor


def grad(outputs, inputs, grad_outputs=None, retain_graph=None, create_graph=False, allow_unused=False):
    single = isinstance(inputs, Tensor)
    ins = [inputs] if single else list(inputs)
    outs = [outputs] if isinstance(outputs, Tensor) else list(outputs)
    gos = [grad_outputs] if isinstance(grad_outputs, Tensor) else (list(grad_outputs) if grad_outputs is not None else [None] * len(outs))
    wanted = set(id(t) for t in ins)
    total = {}
    for o, go in zip(outs, gos):
        if not o.requires_grad:
            raise RuntimeError('element 0 of tensors does not require grad and does not have a grad_fn')
        if go is None:
            if o._a.size != 1:
                raise RuntimeError('grad can be implicitly created only for scalar outputs')
            g0 = np.ones_like(o._a)
        else:
            g0 = np.asarray(go._a, dtype=np.float64)
        found = torch._backprop(o, g0, False, wanted)
        for k, v in found.items():
            total[k] = v if k not in total else total[k] + v
    res = []
    for t in ins:
        g = total.get(id(t))
        if g is None:
            if not allow_unused:
                raise RuntimeError('One of the differentiated Tensors appears to not have been used in the graph. Set allow_unused=True if this is the desired behavior.')
            res.append(None)
        else:
            res.append(Tensor._wrap(g, t._dtype))
    return tuple(res)


def backward(tensors, grad_tensors=None, retain_graph=None, create_graph=False):
    ts = [tensors] if isinstance(tensors, Tensor) else list(tensors)
    gs = [grad_tensors] if isinstance(grad_tensors, Tensor) else (list(grad_tensors) if grad_tensors is not None else [None] * len(ts))
    for t, g in zip(ts, gs):
        t.backward(g)


class Variable(Tensor):
    def __new__(cls, data, requires_grad=False):
        t = Tensor(data, requires_grad=requires_grad)
        return t


no_grad = torch.no_grad
enable_grad = torch.enable_grad
set_grad_enabled = torch.set_grad_enabled
