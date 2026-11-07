import torch
from torch import nn, optim
import torch.nn.functional as F
from torch.utils.data import TensorDataset, DataLoader

def sec(name):
    print('##', name)

def T(f):
    try:
        r = f()
        print(r)
    except Exception as e:
        print(type(e).__name__, str(e).splitlines()[0])

sec('creacion')
a = torch.tensor([[1., 2., 3.], [4., 5., 6.]])
try:
    print(a, a.shape, a.dtype, a.ndim, a.numel(), a.size(), a.size(1))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(torch.zeros(2, 3), torch.ones(2), torch.full((2, 2), 7.0), torch.eye(3))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(torch.arange(5), torch.arange(1, 10, 3), torch.arange(0, 1, 0.25), torch.linspace(0, 1, 5))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(torch.tensor([1, 2, 3]), torch.tensor([True, False]), torch.tensor(3.5), torch.tensor([[1, 2], [3, 4]]).dtype)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(torch.tensor([1.5, 2.5], dtype=torch.float64), torch.tensor([1, 2], dtype=torch.float32), torch.zeros(2, dtype=torch.int64))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(torch.tensor([0.1, 0.2, 0.3]), torch.tensor([1e-5, 1.0]), torch.tensor([1000000.0, 2.0]), torch.tensor([0.123456789]))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(torch.tensor([[[1., 2.], [3., 4.]], [[5., 6.], [7., 8.]]]))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(torch.zeros(2, 3).shape, torch.zeros((2, 3)).shape, torch.zeros_like(a), torch.ones_like(a).dtype)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
sec('operaciones')
b = torch.tensor([10., 20., 30.])
try:
    print(a + b, a * 2, a ** 2, a / 2, a - 1, 2 - a, -a, a // 2 if False else 0)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(a @ a.T, a.T.shape, a.t().shape, torch.matmul(a, b), a.sum(), a.sum(dim=0), a.sum(dim=1, keepdim=True), a.mean(), a.mean(dim=0))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(a.max(), a.min(), a.max(dim=1), a.argmax(), a.argmax(dim=1), a.std(), a.var(dim=0), a.prod())
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(a[0], a[:, 1], a[1, -1], a[a > 3], a[:, :2], a[[0, 1], [2, 0]], a[0, 1].item(), a[None].shape)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(a.reshape(3, 2), a.view(-1), a.flatten(), a.unsqueeze(0).shape, a.unsqueeze(-1).shape, a.squeeze().shape, a.permute(1, 0).shape, a.transpose(0, 1).shape)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(torch.cat([a, a]).shape, torch.cat([a, a], dim=1).shape, torch.stack([a, a]).shape, torch.where(a > 3, a, torch.zeros_like(a)), a.clamp(2, 5))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(torch.sqrt(torch.tensor([4., 9.])), torch.exp(torch.tensor([0., 1.])), torch.log(torch.tensor([1., 2.718281828])), torch.abs(torch.tensor([-1., 2.])), torch.sigmoid(torch.tensor([0., 2.])), torch.tanh(torch.tensor([0., 1.])), torch.relu(torch.tensor([-1., 2.])))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(torch.softmax(torch.tensor([[1., 2., 3.]]), dim=1), F.softmax(torch.tensor([1., 2., 3.]), dim=0), torch.log_softmax(torch.tensor([1., 2., 3.]), dim=0))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print((a > 2), (a > 2).sum(), (a > 2).float().mean(), a.eq(a).all(), torch.allclose(a, a + 1e-9), (a == 5).nonzero())
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(a.tolist(), a.numpy().tolist(), a.float().dtype, a.long(), a.int().dtype, a.double().dtype, a.to(torch.float64).dtype, a.type(torch.int64).dtype)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(a.clone().data_ptr() != a.data_ptr(), a.is_leaf, a.requires_grad, a.device, len(a), list(a), a.T.is_contiguous() if hasattr(a, 'is_contiguous') else 0)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
sec('autograd')
x = torch.tensor(2.0, requires_grad=True)
y = x ** 3 + 2 * x
try:
    print(y, y.grad_fn, x.grad)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
y.backward()
try:
    print(x.grad)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
y2 = x ** 3
y2.backward()
try:
    print(x.grad)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
x.grad.zero_()
try:
    print(x.grad)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
w = torch.tensor([1., 2., 3.], requires_grad=True)
z = (w * w).sum()
try:
    print(z, z.grad_fn)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
z.backward()
try:
    print(w.grad, w.requires_grad, w.is_leaf, z.is_leaf)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
with torch.no_grad():
    q = w * 2
try:
    print(q.requires_grad, q, w.detach().requires_grad)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print((w * 2).requires_grad, (w.detach() * 2).requires_grad, (w * 2).grad_fn, (w + 1).grad_fn, (w.sum()).grad_fn, w.mean().grad_fn, (w @ w).grad_fn, torch.sigmoid(w).grad_fn, torch.relu(w).grad_fn, torch.exp(w).grad_fn, w.reshape(3, 1).grad_fn, w[0].grad_fn, (w ** 2).grad_fn, (w / 2).grad_fn, (-w).grad_fn)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
T(lambda: x.backward())
T(lambda: torch.tensor([1., 2.], requires_grad=True).backward())
T(lambda: (torch.tensor(1.) * 2).backward())
v = torch.tensor([1., 2.], requires_grad=True)
T(lambda: v.add_(1))
T(lambda: v.numpy())
u = (v * 3)
u.backward(torch.tensor([1., 0.5]))
try:
    print(v.grad)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(torch.autograd.grad((v ** 2).sum(), v))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
sec('nn')
lin = nn.Linear(3, 2)
try:
    print(lin, lin.weight.shape, lin.bias.shape, [n for n, _ in lin.named_parameters()], sum(p.numel() for p in lin.parameters()), lin.weight.requires_grad, lin.weight.dtype, type(lin.weight).__name__)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
nn.init.constant_(lin.weight, 0.5); nn.init.zeros_(lin.bias)
try:
    print(lin(torch.tensor([[1., 2., 3.], [0., 0., 1.]])), lin(torch.ones(3)).shape)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
m = nn.Sequential(nn.Linear(4, 8), nn.ReLU(), nn.Dropout(0.2), nn.Linear(8, 3))
try:
    print(m, len(m), m[0], m[-1].out_features, m.training, [type(c).__name__ for c in m.children()], list(m.state_dict().keys()), [tuple(v.shape) for v in m.state_dict().values()])
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
m.eval(); print(m.training, m[2].training); m.train(); print(m.training)
class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.f1 = nn.Linear(2, 4)
        self.f2 = nn.Linear(4, 1)
    def forward(self, x):
        return self.f2(torch.relu(self.f1(x)))
n = Net()
try:
    print(n, sum(p.numel() for p in n.parameters()), [k for k, _ in n.named_parameters()], n(torch.ones(5, 2)).shape, isinstance(n, nn.Module))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(F.mse_loss(torch.tensor([1., 2., 3.]), torch.tensor([1., 2., 5.])), nn.MSELoss()(torch.tensor([1., 2.]), torch.tensor([0., 0.])), nn.L1Loss()(torch.tensor([1., 2.]), torch.tensor([0., 0.])))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
lg = torch.tensor([[2.0, 1.0, 0.1], [0.5, 2.5, 0.3]]); tg = torch.tensor([0, 1])
try:
    print(nn.CrossEntropyLoss()(lg, tg), F.cross_entropy(lg, tg, reduction='none'), F.nll_loss(F.log_softmax(lg, dim=1), tg), nn.BCEWithLogitsLoss()(torch.tensor([0.5, -1.0]), torch.tensor([1., 0.])), nn.BCELoss()(torch.tensor([0.9, 0.2]), torch.tensor([1., 0.])))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(lg.argmax(dim=1), (lg.argmax(1) == tg).float().mean().item(), F.one_hot(tg, 3), F.relu(torch.tensor([-1., 1.])), nn.ReLU()(torch.tensor([-1., 1.])), nn.Softmax(dim=1)(lg), nn.Flatten()(torch.ones(2, 3, 4)).shape, nn.Sigmoid()(torch.tensor([0.])), nn.Tanh()(torch.tensor([0.])), nn.GELU()(torch.tensor([1.])), nn.LeakyReLU(0.1)(torch.tensor([-1.])))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
sec('optim')
def run(opt_fn, steps=3):
    p = torch.tensor([1.0, -2.0], requires_grad=True)
    opt = opt_fn([p])
    out = []
    for _ in range(steps):
        opt.zero_grad()
        loss = (p ** 2).sum()
        loss.backward()
        opt.step()
        out.append([round(v, 4) for v in p.tolist()])
    return out
try:
    print(run(lambda ps: optim.SGD(ps, lr=0.1)))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(run(lambda ps: optim.SGD(ps, lr=0.1, momentum=0.9)))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(run(lambda ps: optim.SGD(ps, lr=0.1, momentum=0.9, nesterov=True)))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(run(lambda ps: optim.SGD(ps, lr=0.1, weight_decay=0.5)))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(run(lambda ps: optim.Adam(ps, lr=0.1)))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(run(lambda ps: optim.AdamW(ps, lr=0.1)))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(run(lambda ps: optim.RMSprop(ps, lr=0.01)))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(run(lambda ps: optim.Adagrad(ps, lr=0.1)))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
o = optim.SGD([torch.zeros(1, requires_grad=True)], lr=0.1)
try:
    print(o.param_groups[0]['lr'], len(o.param_groups))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
sch = optim.lr_scheduler.StepLR(o, step_size=2, gamma=0.5); lrs = []
for _ in range(5):
    lrs.append(o.param_groups[0]['lr']); o.step(); sch.step()
try:
    print(lrs, sch.get_last_lr())
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
sch2 = optim.lr_scheduler.CosineAnnealingLR(optim.SGD([torch.zeros(1, requires_grad=True)], lr=1.0), T_max=4); print([round(sch2.get_last_lr()[0], 4)] + [(sch2.step(), round(sch2.get_last_lr()[0], 4))[1] for _ in range(4)])
sec('data')
ds = TensorDataset(torch.arange(10.).reshape(5, 2), torch.arange(5))
try:
    print(len(ds), ds[1], ds[0][0].shape)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
dl = DataLoader(ds, batch_size=2)
try:
    print(len(dl), [(xb.shape, yb.tolist()) for xb, yb in dl])
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
dl2 = DataLoader(ds, batch_size=2, drop_last=True); print(len(dl2))
dl3 = DataLoader(ds, batch_size=2, shuffle=True); print(sorted(sum([yb.tolist() for _, yb in dl3], [])))
tr, te = torch.utils.data.random_split(ds, [3, 2]); print(len(tr), len(te))
sec('cnn')
img = torch.arange(16.).reshape(1, 1, 4, 4)
conv = nn.Conv2d(1, 1, 2, bias=False); nn.init.constant_(conv.weight, 1.0)
try:
    print(conv(img), conv, conv.weight.shape)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(nn.MaxPool2d(2)(img), nn.AvgPool2d(2)(img), nn.Conv2d(3, 8, 3, padding=1)(torch.ones(2, 3, 8, 8)).shape, nn.Conv2d(3, 8, 3, stride=2)(torch.ones(2, 3, 8, 8)).shape, nn.AdaptiveAvgPool2d(1)(torch.ones(2, 4, 5, 5)).shape)
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
try:
    print(nn.Sequential(nn.Conv2d(1, 4, 3), nn.ReLU(), nn.MaxPool2d(2), nn.Flatten(), nn.Linear(4 * 3 * 3, 10)))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
sec('rnn')
emb = nn.Embedding(5, 3); print(emb(torch.tensor([[0, 1], [2, 3]])).shape, emb, emb.weight.shape)
lstm = nn.LSTM(4, 6, batch_first=True); out, (h, c) = lstm(torch.ones(2, 5, 4)); print(out.shape, h.shape, c.shape, lstm)
gru = nn.GRU(4, 6, num_layers=2); out, h = gru(torch.ones(5, 2, 4)); print(out.shape, h.shape, gru)
rnn = nn.RNN(4, 6, batch_first=True, bidirectional=True); out, h = rnn(torch.ones(2, 5, 4)); print(out.shape, h.shape)
sec('reg')
bn = nn.BatchNorm1d(3); x3 = torch.tensor([[1., 2., 3.], [3., 4., 5.], [5., 6., 10.]]); print(bn(x3).shape, bn.running_mean, bn.running_var)
bn.eval(); print(bn(x3).shape)
dr = nn.Dropout(0.5); dr.eval(); print(dr(torch.ones(4))); dr.train(); print(set(dr(torch.ones(100)).tolist()) <= {0.0, 2.0})
ln = nn.LayerNorm(3); print(ln(x3).mean(dim=-1).abs().max().item() < 1e-6)
for p in nn.Linear(2, 2).parameters(): p.requires_grad = False
fz = nn.Linear(2, 2)
for p in fz.parameters(): p.requires_grad_(False)
try:
    print([p.requires_grad for p in fz.parameters()], sum(p.numel() for p in fz.parameters() if p.requires_grad))
except Exception as _e:
    print("EXC", type(_e).__name__, str(_e).splitlines()[0][:100])
sd = nn.Linear(2, 2).state_dict(); print(list(sd.keys()), type(sd).__name__)
m1 = nn.Linear(2, 2); m2 = nn.Linear(2, 2); print(m2.load_state_dict(m1.state_dict()), torch.equal(m1.weight, m2.weight))
sec('errores')
T(lambda: nn.Linear(3, 2)(torch.ones(4, 5)))
T(lambda: torch.ones(2, 3) + torch.ones(2, 4))
T(lambda: torch.ones(2, 3).view(4, 2))
T(lambda: torch.ones(3)[5])
T(lambda: torch.ones(2, 2)[0, 0, 0])
T(lambda: nn.Conv2d(3, 4, 3)(torch.ones(1, 1, 8, 8)))
T(lambda: F.cross_entropy(torch.ones(2, 3), torch.tensor([0., 1.])))
T(lambda: torch.tensor([1, 2]).float().long().float().item())
T(lambda: torch.tensor([1., 2.]).item())
T(lambda: torch.cat([torch.ones(2, 2), torch.ones(3, 3)]))
T(lambda: torch.stack([torch.ones(2), torch.ones(3)]))
T(lambda: torch.ones(2, 2).sum(dim=2))
T(lambda: nn.Embedding(3, 2)(torch.tensor([5])))
T(lambda: torch.tensor([[1, 2], [3]]))
T(lambda: torch.tensor("a"))
T(lambda: torch.ones(2).foo())
T(lambda: nn.Linear(2, 2).bar)
