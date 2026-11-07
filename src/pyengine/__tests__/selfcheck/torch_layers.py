import torch, numpy as np
from torch import nn
import torch.nn.functional as F
torch.manual_seed(1)

def sig(z): return 1 / (1 + np.exp(-z))

# LSTM vs manual
lstm = nn.LSTM(3, 4, batch_first=True)
x = torch.randn(2, 5, 3)
o, (h, c) = lstm(x)
Wi, Wh = lstm.weight_ih_l0.detach().numpy(), lstm.weight_hh_l0.detach().numpy()
bi, bh = lstm.bias_ih_l0.detach().numpy(), lstm.bias_hh_l0.detach().numpy()
hh = np.zeros((2, 4)); cc = np.zeros((2, 4)); outs = []
xn = x.numpy()
for t in range(5):
    gates = xn[:, t] @ Wi.T + bi + hh @ Wh.T + bh
    i, f, g, oo = np.split(gates, 4, axis=1)
    cc = sig(f) * cc + sig(i) * np.tanh(g)
    hh = sig(oo) * np.tanh(cc)
    outs.append(hh)
print('lstm', np.allclose(np.stack(outs, 1), o.detach().numpy(), atol=1e-9))

# GRU vs manual
gru = nn.GRU(3, 4, batch_first=True)
o, h = gru(x)
Wi, Wh = gru.weight_ih_l0.detach().numpy(), gru.weight_hh_l0.detach().numpy()
bi, bh = gru.bias_ih_l0.detach().numpy(), gru.bias_hh_l0.detach().numpy()
hh = np.zeros((2, 4)); outs = []
for t in range(5):
    gi = xn[:, t] @ Wi.T + bi
    gh = hh @ Wh.T + bh
    ir, iz, inn = np.split(gi, 3, axis=1)
    hr, hz, hn = np.split(gh, 3, axis=1)
    r = sig(ir + hr); z = sig(iz + hz)
    n = np.tanh(inn + r * hn)
    hh = (1 - z) * n + z * hh
    outs.append(hh)
print('gru', np.allclose(np.stack(outs, 1), o.detach().numpy(), atol=1e-9))

# Conv2d naive
conv = nn.Conv2d(2, 3, 3, stride=2, padding=1)
xi = torch.randn(2, 2, 7, 7)
yo = conv(xi).detach().numpy()
W, b = conv.weight.detach().numpy(), conv.bias.detach().numpy()
xp = np.pad(xi.numpy(), ((0, 0), (0, 0), (1, 1), (1, 1)))
ref = np.zeros((2, 3, 4, 4))
for n in range(2):
    for oc in range(3):
        for i in range(4):
            for j in range(4):
                ref[n, oc, i, j] = (xp[n, :, i*2:i*2+3, j*2:j*2+3] * W[oc]).sum() + b[oc]
print('conv', np.allclose(ref, yo, atol=1e-9), yo.shape)

# BatchNorm2d
bn = nn.BatchNorm2d(3)
xb = torch.randn(4, 3, 5, 5) * 2 + 1
yb = bn(xb).detach().numpy()
xn2 = xb.numpy()
m = xn2.mean(axis=(0, 2, 3), keepdims=True); v = xn2.var(axis=(0, 2, 3), keepdims=True)
print('bn2d', np.allclose((xn2 - m) / np.sqrt(v + 1e-5), yb, atol=1e-9), bn.running_mean.shape)
print('num_batches', bn.num_batches_tracked)

# AdaptiveAvgPool, AvgPool
print(nn.AdaptiveAvgPool2d((1, 1))(xb).shape, nn.AvgPool2d(2)(xb).shape)

# LSTM finite-difference gradient on weight_hh (en float64: con float32 la derivada numérica no tiene precisión)
torch.set_default_dtype(torch.float64)
lstm2 = nn.LSTM(2, 3, batch_first=True)
x2 = torch.randn(1, 4, 2)
def loss():
    return (lstm2(x2)[0] ** 2).sum()
lstm2.zero_grad() if hasattr(lstm2, 'zero_grad') else None
l = loss(); l.backward()
g = lstm2.weight_hh_l0.grad.numpy().copy()
W = lstm2.weight_hh_l0
num = np.zeros_like(g)
for i in range(g.shape[0]):
    for j in range(g.shape[1]):
        old = W._a[i, j]
        W._a[i, j] = old + 1e-6; lp = loss().item()
        W._a[i, j] = old - 1e-6; lm = loss().item()
        W._a[i, j] = old
        num[i, j] = (lp - lm) / 2e-6
print('lstm grad', np.abs(num - g).max() < 1e-5)
torch.set_default_dtype(torch.float32)

# MHA vs manual
mha = nn.MultiheadAttention(8, 2, batch_first=True)
q = torch.randn(2, 5, 8)
a, w = mha(q, q, q)
print('mha rows sum to 1', np.allclose(w.detach().numpy().sum(-1), 1.0))
# repr
print(nn.Linear(3, 2))
print(nn.Dropout(0.3), nn.BatchNorm1d(4), nn.LayerNorm(8), nn.Embedding(5, 3), nn.LSTM(3, 4, num_layers=2, batch_first=True))
class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc1 = nn.Linear(2, 3)
        self.act = nn.Tanh()
        self.fc2 = nn.Linear(3, 1)
    def forward(self, x):
        return self.fc2(self.act(self.fc1(x)))
n = Net()
print(n)
print(n(torch.ones(1, 2)).shape)
print([k for k, _ in n.named_modules()])
print(len(list(n.children())))
