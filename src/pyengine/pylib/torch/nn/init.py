import math
import numpy as np
import torch


def _fans(shape):
    if len(shape) < 2:
        return shape[0], shape[0]
    rf = 1
    for s in shape[2:]:
        rf *= s
    return shape[1] * rf, shape[0] * rf


def uniform_(t, a=0.0, b=1.0):
    return t.uniform_(a, b)


def normal_(t, mean=0.0, std=1.0):
    return t.normal_(mean, std)


def constant_(t, val):
    with torch.no_grad():
        return t.fill_(val)


def zeros_(t):
    return constant_(t, 0.0)


def ones_(t):
    return constant_(t, 1.0)


def xavier_uniform_(t, gain=1.0):
    fi, fo = _fans(t.shape)
    a = gain * math.sqrt(6.0 / (fi + fo))
    with torch.no_grad():
        return t.uniform_(-a, a)


def xavier_normal_(t, gain=1.0):
    fi, fo = _fans(t.shape)
    with torch.no_grad():
        return t.normal_(0.0, gain * math.sqrt(2.0 / (fi + fo)))


def kaiming_uniform_(t, a=0, mode='fan_in', nonlinearity='leaky_relu'):
    fi, fo = _fans(t.shape)
    fan = fi if mode == 'fan_in' else fo
    gain = math.sqrt(2.0 / (1 + a * a)) if nonlinearity in ('relu', 'leaky_relu') else 1.0
    bound = gain * math.sqrt(3.0 / fan)
    with torch.no_grad():
        return t.uniform_(-bound, bound)


def kaiming_normal_(t, a=0, mode='fan_in', nonlinearity='leaky_relu'):
    fi, fo = _fans(t.shape)
    fan = fi if mode == 'fan_in' else fo
    gain = math.sqrt(2.0 / (1 + a * a)) if nonlinearity in ('relu', 'leaky_relu') else 1.0
    with torch.no_grad():
        return t.normal_(0.0, gain / math.sqrt(fan))
