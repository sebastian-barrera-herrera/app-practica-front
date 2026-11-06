import torch, numpy as np
from torch import nn, optim
import torch.nn.functional as F
from torch.utils.data import TensorDataset, DataLoader

torch.manual_seed(42)
model = nn.Sequential(nn.Linear(4, 8), nn.ReLU(), nn.Linear(8, 3))
print(model)
print(sum(p.numel() for p in model.parameters()))
for n, p in model.named_parameters():
    print(n, tuple(p.shape), p.requires_grad)
print(list(model.state_dict().keys()))

# datos: 3 clases separables
X = torch.randn(150, 4)
w = torch.tensor([[1., -1., 0.5, 0.], [0., 1., -1., 0.5], [-1., 0., 1., 1.]])
y = (X @ w.T).argmax(dim=1)
ds = TensorDataset(X, y)
dl = DataLoader(ds, batch_size=32, shuffle=True)
opt = optim.Adam(model.parameters(), lr=0.05)
loss_fn = nn.CrossEntropyLoss()
for ep in range(30):
    tot = 0.0
    for xb, yb in dl:
        opt.zero_grad()
        loss = loss_fn(model(xb), yb)
        loss.backward()
        opt.step()
        tot += loss.item() * len(xb)
    last = tot / 150
model.eval()
with torch.no_grad():
    acc = (model(X).argmax(1) == y).float().mean().item()
print('acc', acc > 0.95, last < 0.1)

# SGD con momentum, regresión lineal
lin = nn.Linear(1, 1)
opt = optim.SGD(lin.parameters(), lr=0.1, momentum=0.9)
xs = torch.linspace(-1, 1, 20).reshape(-1, 1)
ys = 3 * xs + 0.5
for _ in range(200):
    opt.zero_grad()
    l = F.mse_loss(lin(xs), ys)
    l.backward()
    opt.step()
print(round(lin.weight.item(), 3), round(lin.bias.item(), 3))

# CNN pequeña
cnn = nn.Sequential(nn.Conv2d(1, 4, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2), nn.Flatten(), nn.Linear(4 * 4 * 4, 10))
print(cnn)
out = cnn(torch.randn(2, 1, 8, 8))
print(out.shape)
out.sum().backward()
print(cnn[0].weight.grad.shape)

# LSTM
lstm = nn.LSTM(3, 5, batch_first=True)
o, (h, c) = lstm(torch.randn(2, 7, 3))
print(o.shape, h.shape, c.shape)
o.sum().backward()
print(lstm.weight_ih_l0.grad.shape)
gru = nn.GRU(3, 5, batch_first=True, num_layers=2)
o, h = gru(torch.randn(2, 7, 3))
print(o.shape, h.shape)
rnn = nn.RNN(3, 5)
o, h = rnn(torch.randn(7, 2, 3))
print(o.shape, h.shape)

# Embedding / LayerNorm / BatchNorm / Dropout
emb = nn.Embedding(10, 4)
print(emb(torch.tensor([[1, 2, 3], [4, 5, 6]])).shape)
ln = nn.LayerNorm(4)
z = ln(torch.randn(3, 4))
print(z.mean(dim=-1).abs().max().item() < 1e-6)
bn = nn.BatchNorm1d(4)
z = bn(torch.randn(16, 4) * 3 + 2)
print(round(z.mean(dim=0).abs().max().item(), 6) < 1e-6, bn.running_mean.shape)
bn.eval()
print(bn(torch.randn(2, 4)).shape)
dp = nn.Dropout(0.5)
dp.train()
z = dp(torch.ones(1000))
print(abs(z.mean().item() - 1) < 0.2, set(z.unique().tolist()) <= {0.0, 2.0})
dp.eval()
print(dp(torch.ones(3)))

# MHA
mha = nn.MultiheadAttention(8, 2, batch_first=True)
q = torch.randn(2, 5, 8)
a, wts = mha(q, q, q)
print(a.shape, wts.shape)

# lr scheduler
opt = optim.SGD(lin.parameters(), lr=1.0)
sch = optim.lr_scheduler.StepLR(opt, step_size=2, gamma=0.1)
lrs = []
for _ in range(5):
    lrs.append(opt.param_groups[0]['lr'])
    opt.step()
    sch.step()
print([round(v, 4) for v in lrs])
# autograd.grad
x = torch.tensor(3.0, requires_grad=True)
y = x ** 3
g, = torch.autograd.grad(y, x)
print(g)
# state dict roundtrip
sd = model.state_dict()
m2 = nn.Sequential(nn.Linear(4, 8), nn.ReLU(), nn.Linear(8, 3))
print(m2.load_state_dict(sd))
print(torch.allclose(m2(X), model(X)))
