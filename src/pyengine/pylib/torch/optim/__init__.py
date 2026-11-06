import math
import numpy as np
import torch
from torch import Tensor
from torch.optim import lr_scheduler


class Optimizer:
    def __init__(self, params, defaults):
        self.defaults = defaults
        params = list(params)
        if params and isinstance(params[0], dict):
            self.param_groups = []
            for g in params:
                grp = dict(defaults)
                grp.update(g)
                grp['params'] = list(grp['params'])
                self.param_groups.append(grp)
        else:
            grp = dict(defaults)
            grp['params'] = params
            self.param_groups = [grp]
        self.state = {}

    def zero_grad(self, set_to_none=True):
        for g in self.param_groups:
            for p in g['params']:
                if set_to_none:
                    p.grad = None
                elif p.grad is not None:
                    p.grad._a[...] = 0

    def _st(self, p):
        return self.state.setdefault(id(p), {})

    def add_param_group(self, g):
        grp = dict(self.defaults)
        grp.update(g)
        grp['params'] = list(grp['params'])
        self.param_groups.append(grp)

    def state_dict(self):
        return {'param_groups': [{k: v for k, v in g.items() if k != 'params'} for g in self.param_groups]}

    def step(self, closure=None):
        loss = None
        if closure is not None:
            with torch.enable_grad():
                loss = closure()
        for g in self.param_groups:
            for p in g['params']:
                if p.grad is not None:
                    self._update(p, p.grad._a, g, self._st(p))
        return loss


class SGD(Optimizer):
    def __init__(self, params, lr=0.001, momentum=0, dampening=0, weight_decay=0, nesterov=False):
        super().__init__(params, dict(lr=lr, momentum=momentum, dampening=dampening, weight_decay=weight_decay, nesterov=nesterov))

    def _update(self, p, g, grp, st):
        if grp['weight_decay']:
            g = g + grp['weight_decay'] * p._a
        if grp['momentum']:
            if 'buf' not in st:
                st['buf'] = g.copy()
            else:
                st['buf'] = grp['momentum'] * st['buf'] + (1 - grp['dampening']) * g
            g = g + grp['momentum'] * st['buf'] if grp['nesterov'] else st['buf']
        p._a[...] = p._a - grp['lr'] * g


class Adam(Optimizer):
    decoupled = False

    def __init__(self, params, lr=0.001, betas=(0.9, 0.999), eps=1e-8, weight_decay=0, amsgrad=False):
        super().__init__(params, dict(lr=lr, betas=betas, eps=eps, weight_decay=weight_decay, amsgrad=amsgrad))

    def _update(self, p, g, grp, st):
        b1, b2 = grp['betas']
        if not st:
            st['step'] = 0
            st['m'] = np.zeros_like(p._a)
            st['v'] = np.zeros_like(p._a)
        st['step'] += 1
        t = st['step']
        if grp['weight_decay']:
            if self.decoupled:
                p._a[...] = p._a * (1 - grp['lr'] * grp['weight_decay'])
            else:
                g = g + grp['weight_decay'] * p._a
        st['m'] = b1 * st['m'] + (1 - b1) * g
        st['v'] = b2 * st['v'] + (1 - b2) * g * g
        bc1 = 1 - b1 ** t
        bc2 = 1 - b2 ** t
        denom = np.sqrt(st['v']) / math.sqrt(bc2) + grp['eps']
        p._a[...] = p._a - (grp['lr'] / bc1) * st['m'] / denom


class AdamW(Adam):
    decoupled = True

    def __init__(self, params, lr=0.001, betas=(0.9, 0.999), eps=1e-8, weight_decay=0.01, amsgrad=False):
        super().__init__(params, lr, betas, eps, weight_decay, amsgrad)


class RMSprop(Optimizer):
    def __init__(self, params, lr=0.01, alpha=0.99, eps=1e-8, weight_decay=0, momentum=0):
        super().__init__(params, dict(lr=lr, alpha=alpha, eps=eps, weight_decay=weight_decay, momentum=momentum))

    def _update(self, p, g, grp, st):
        if grp['weight_decay']:
            g = g + grp['weight_decay'] * p._a
        if not st:
            st['sq'] = np.zeros_like(p._a)
            st['buf'] = np.zeros_like(p._a)
        st['sq'] = grp['alpha'] * st['sq'] + (1 - grp['alpha']) * g * g
        avg = np.sqrt(st['sq']) + grp['eps']
        if grp['momentum'] > 0:
            st['buf'] = grp['momentum'] * st['buf'] + g / avg
            p._a[...] = p._a - grp['lr'] * st['buf']
        else:
            p._a[...] = p._a - grp['lr'] * g / avg


class Adagrad(Optimizer):
    def __init__(self, params, lr=0.01, lr_decay=0, weight_decay=0, eps=1e-10):
        super().__init__(params, dict(lr=lr, lr_decay=lr_decay, weight_decay=weight_decay, eps=eps))

    def _update(self, p, g, grp, st):
        if grp['weight_decay']:
            g = g + grp['weight_decay'] * p._a
        if not st:
            st['sum'] = np.zeros_like(p._a)
            st['step'] = 0
        st['step'] += 1
        st['sum'] = st['sum'] + g * g
        p._a[...] = p._a - grp['lr'] / (1 + (st['step'] - 1) * grp['lr_decay']) * g / (np.sqrt(st['sum']) + grp['eps'])
