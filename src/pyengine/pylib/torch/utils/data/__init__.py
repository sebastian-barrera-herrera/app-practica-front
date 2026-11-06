import numpy as np
import torch
from torch import Tensor


class Dataset:
    def __getitem__(self, i):
        raise NotImplementedError

    def __len__(self):
        raise NotImplementedError


class TensorDataset(Dataset):
    def __init__(self, *tensors):
        n = tensors[0].shape[0]
        for t in tensors:
            if t.shape[0] != n:
                raise AssertionError('Size mismatch between tensors')
        self.tensors = tensors

    def __getitem__(self, i):
        return tuple(t[i] for t in self.tensors)

    def __len__(self):
        return self.tensors[0].shape[0]


class Subset(Dataset):
    def __init__(self, dataset, indices):
        self.dataset = dataset
        self.indices = list(indices)

    def __getitem__(self, i):
        return self.dataset[self.indices[i]]

    def __len__(self):
        return len(self.indices)


def random_split(dataset, lengths):
    n = len(dataset)
    if all(isinstance(l, float) for l in lengths):
        sizes = [int(np.floor(n * l)) for l in lengths]
        for i in range(n - sum(sizes)):
            sizes[i % len(sizes)] += 1
        lengths = sizes
    perm = torch._rng.permutation(n).tolist()
    out = []
    pos = 0
    for l in lengths:
        out.append(Subset(dataset, perm[pos:pos + l]))
        pos += l
    return out


def _collate(items):
    first = items[0]
    if isinstance(first, tuple):
        return tuple(_collate([it[k] for it in items]) for k in range(len(first)))
    if isinstance(first, Tensor):
        return torch.stack(items, 0)
    return torch.tensor(items)


class DataLoader:
    def __init__(self, dataset, batch_size=1, shuffle=False, drop_last=False, num_workers=0, collate_fn=None):
        self.dataset = dataset
        self.batch_size = batch_size
        self.shuffle = shuffle
        self.drop_last = drop_last
        self.collate_fn = collate_fn or _collate

    def __len__(self):
        n = len(self.dataset)
        return n // self.batch_size if self.drop_last else -(-n // self.batch_size)

    def __iter__(self):
        n = len(self.dataset)
        order = torch._rng.permutation(n).tolist() if self.shuffle else list(range(n))
        for s in range(0, n, self.batch_size):
            idx = order[s:s + self.batch_size]
            if self.drop_last and len(idx) < self.batch_size:
                break
            yield self.collate_fn([self.dataset[i] for i in idx])
