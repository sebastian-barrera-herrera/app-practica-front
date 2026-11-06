import math


class _LRScheduler:
    def __init__(self, optimizer, last_epoch=-1):
        self.optimizer = optimizer
        self.base_lrs = [g['lr'] for g in optimizer.param_groups]
        self.last_epoch = last_epoch
        self._step_count = 0
        self.step()

    def get_lr(self):
        raise NotImplementedError

    def get_last_lr(self):
        return self._last_lr

    def step(self, epoch=None):
        self.last_epoch += 1
        lrs = self.get_lr()
        for g, lr in zip(self.optimizer.param_groups, lrs):
            g['lr'] = lr
        self._last_lr = list(lrs)


LRScheduler = _LRScheduler


class StepLR(_LRScheduler):
    def __init__(self, optimizer, step_size, gamma=0.1, last_epoch=-1):
        self.step_size = step_size
        self.gamma = gamma
        super().__init__(optimizer, last_epoch)

    def get_lr(self):
        return [b * self.gamma ** (self.last_epoch // self.step_size) for b in self.base_lrs]


class MultiStepLR(_LRScheduler):
    def __init__(self, optimizer, milestones, gamma=0.1, last_epoch=-1):
        self.milestones = sorted(milestones)
        self.gamma = gamma
        super().__init__(optimizer, last_epoch)

    def get_lr(self):
        n = sum(1 for m in self.milestones if m <= self.last_epoch)
        return [b * self.gamma ** n for b in self.base_lrs]


class ExponentialLR(_LRScheduler):
    def __init__(self, optimizer, gamma, last_epoch=-1):
        self.gamma = gamma
        super().__init__(optimizer, last_epoch)

    def get_lr(self):
        return [b * self.gamma ** self.last_epoch for b in self.base_lrs]


class CosineAnnealingLR(_LRScheduler):
    def __init__(self, optimizer, T_max, eta_min=0.0, last_epoch=-1):
        self.T_max = T_max
        self.eta_min = eta_min
        super().__init__(optimizer, last_epoch)

    def get_lr(self):
        return [self.eta_min + (b - self.eta_min) * (1 + math.cos(math.pi * self.last_epoch / self.T_max)) / 2 for b in self.base_lrs]


class LambdaLR(_LRScheduler):
    def __init__(self, optimizer, lr_lambda, last_epoch=-1):
        self.lr_lambda = lr_lambda
        super().__init__(optimizer, last_epoch)

    def get_lr(self):
        return [b * self.lr_lambda(self.last_epoch) for b in self.base_lrs]


class ReduceLROnPlateau:
    def __init__(self, optimizer, mode='min', factor=0.1, patience=10, threshold=1e-4, min_lr=0.0):
        self.optimizer = optimizer
        self.mode = mode
        self.factor = factor
        self.patience = patience
        self.threshold = threshold
        self.min_lr = min_lr
        self.best = math.inf if mode == 'min' else -math.inf
        self.bad = 0
        self._last_lr = [g['lr'] for g in optimizer.param_groups]

    def step(self, metrics):
        better = metrics < self.best * (1 - self.threshold) if self.mode == 'min' else metrics > self.best * (1 + self.threshold)
        if better:
            self.best = metrics
            self.bad = 0
        else:
            self.bad += 1
        if self.bad > self.patience:
            for g in self.optimizer.param_groups:
                g['lr'] = max(g['lr'] * self.factor, self.min_lr)
            self.bad = 0
        self._last_lr = [g['lr'] for g in self.optimizer.param_groups]

    def get_last_lr(self):
        return self._last_lr
