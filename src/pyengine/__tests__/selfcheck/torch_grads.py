import itertools
import torch, numpy as np
from torch import nn
import torch.nn.functional as F

torch.manual_seed(0)


def check(name, fn, *shapes):
    ts = [torch.randn(*s, dtype=torch.float64, requires_grad=True) for s in shapes]
    out = fn(*ts)
    out.sum().backward()
    ok = True
    for i, t in enumerate(ts):
        base = t.detach().numpy().copy()
        num = np.zeros_like(base)
        for idx in itertools.product(*[range(n) for n in base.shape]):
            p = base.copy(); p[idx] += 1e-6
            m = base.copy(); m[idx] -= 1e-6
            args_p = [torch.tensor(p) if j == i else ts[j].detach() for j in range(len(ts))]
            args_m = [torch.tensor(m) if j == i else ts[j].detach() for j in range(len(ts))]
            num[idx] = (fn(*args_p).sum().item() - fn(*args_m).sum().item()) / 2e-6
        err = np.abs(num - t.grad.numpy()).max()
        if err > 1e-5:
            ok = False
            print(name, 'arg', i, 'ERR', err)
    print(name, 'OK' if ok else 'FAIL')

check('add_mul', lambda a, b: a * b + a, (3, 4), (3, 4))
check('bcast', lambda a, b: a * b, (3, 4), (4,))
check('matmul', lambda a, b: a @ b, (3, 4), (4, 2))
check('tanh', lambda a: torch.tanh(a), (3, 4))
check('sigmoid', lambda a: torch.sigmoid(a), (3, 4))
check('relu', lambda a: torch.relu(a) * 2, (3, 4))
check('softmax', lambda a: torch.softmax(a, dim=1) * torch.arange(4.).double(), (3, 4))
check('log_softmax', lambda a: F.log_softmax(a, dim=1) * torch.arange(4.).double(), (3, 4))
check('exp_log', lambda a: torch.log(torch.exp(a) + 1), (3, 4))
check('mean_var', lambda a: a.mean(dim=0) + a.var(dim=0), (5, 3))
check('std', lambda a: a.std(dim=1), (5, 3))
check('max', lambda a: a.max(dim=1).values, (5, 3))
check('pow', lambda a: (a * a + 1) ** 1.5, (3, 3))
check('div', lambda a, b: a / (b * b + 1), (3, 3), (3, 3))
check('reshape_perm', lambda a: a.reshape(2, 6).permute(1, 0) * 2, (3, 4))
check('cat', lambda a, b: torch.cat([a, b], dim=0) ** 2, (2, 3), (3, 3))
check('stack', lambda a, b: torch.stack([a, b]) ** 2, (2, 3), (2, 3))
check('index', lambda a: a[1:, :2] ** 2, (3, 4))
check('gather', lambda a: torch.gather(a, 1, torch.tensor([[0], [2], [1]])) ** 2, (3, 4))
check('where', lambda a: torch.where(a > 0, a * 2, a * a), (3, 4))
check('clamp', lambda a: torch.clamp(a, -0.5, 0.5) * 3, (3, 4))
check('ce', lambda a: F.cross_entropy(a, torch.tensor([0, 2, 1])), (3, 4))
check('mse', lambda a, b: F.mse_loss(a, b), (3, 4), (3, 4))
check('bce_logits', lambda a: F.binary_cross_entropy_with_logits(a, torch.tensor([[1., 0.]]*2).double()), (2, 2))
check('layernorm', lambda a, w, b: F.layer_norm(a, (4,), w, b) ** 2, (3, 4), (4,), (4,))
check('conv2d', lambda x, w, b: F.conv2d(x, w, b, padding=1) ** 2, (2, 2, 5, 5), (3, 2, 3, 3), (3,))
check('conv2d_stride', lambda x, w: F.conv2d(x, w, stride=2) ** 2, (1, 1, 6, 6), (2, 1, 3, 3))
check('maxpool', lambda x: F.max_pool2d(x, 2) ** 2, (1, 2, 4, 4))
check('avgpool', lambda x: F.avg_pool2d(x, 2) ** 2, (1, 2, 4, 4))
check('sdpa', lambda q, k, v: F.scaled_dot_product_attention(q, k, v), (2, 3, 4), (2, 3, 4), (2, 3, 4))
check('sum_keepdim', lambda a: a - a.sum(dim=1, keepdim=True), (3, 4))
check('unsq', lambda a: a.unsqueeze(1) * a.unsqueeze(2), (2, 3))
check('transpose', lambda a: a.transpose(0, 1) @ a, (3, 4))
check('amax', lambda a: a.amax(dim=1) ** 2, (4, 3))
check('logsumexp', lambda a: torch.logsumexp(a, dim=1), (4, 3))
check('diag', lambda a: torch.diag(a) ** 2, (3, 3))
check('flip', lambda a: a.flip(0) * torch.arange(3.).double().reshape(3, 1), (3, 2))
check('roll', lambda a: a.roll(1, 0) * torch.arange(3.).double().reshape(3, 1), (3, 2))
check('log1p', lambda a: (a * a).log1p(), (3, 2))
check('cumsum', lambda a: a.cumsum(dim=1) ** 2, (3, 4))
check('cumprod', lambda a: a.cumprod(dim=1), (3, 4))
check('prod', lambda a: a.prod(), (2, 3))
check('norm', lambda a: a.norm(), (2, 3))
check('gelu', lambda a: F.gelu(a), (3, 3))
check('softplus', lambda a: F.softplus(a), (3, 3))
check('leaky', lambda a: F.leaky_relu(a, 0.1), (3, 3))
check('nll', lambda a: F.nll_loss(F.log_softmax(a, dim=1), torch.tensor([1, 0, 3])), (3, 4))
check('smoothl1', lambda a, b: F.smooth_l1_loss(a, b), (3, 3), (3, 3))
check('l1', lambda a, b: F.l1_loss(a, b), (3, 3), (3, 3))
check('embedding', lambda w: F.embedding(torch.tensor([[0, 2], [1, 1]]), w) ** 2, (4, 3))
check('adaptive', lambda x: F.adaptive_avg_pool2d(x, 1) ** 2, (1, 2, 4, 4))
check('expand', lambda a: a.expand(3, 4) ** 2, (1, 4))
check('repeat', lambda a: a.repeat(2, 1) ** 2, (2, 3))
check('masked_fill', lambda a: a.masked_fill(a > 0, 0.0) ** 2, (3, 3))
check('index_select', lambda a: a.index_select(0, torch.tensor([2, 0, 2])) ** 2, (3, 3))
check('fancy', lambda a: a[torch.tensor([0, 2, 2])] ** 2, (3, 3))
check('boolidx', lambda a: a[a > 0] ** 2, (3, 3))
check('select', lambda a: a[1] ** 2, (3, 3))
check('elems', lambda a: a[:, 0] * a[:, 1], (3, 3))
print('DONE')
