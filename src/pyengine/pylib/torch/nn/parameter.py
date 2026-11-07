from torch import Tensor


class Parameter(Tensor):
    def __init__(self, data=None, requires_grad=True):
        import numpy as np
        import torch
        # los módulos crean sus pesos con arrays de NumPy: la precisión por defecto de PyTorch es float32
        dt = torch.get_default_dtype() if isinstance(data, np.ndarray) and data.dtype.kind == 'f' else None
        Tensor.__init__(self, data, dtype=dt, requires_grad=requires_grad)

    def __repr__(self):
        return 'Parameter containing:\n' + Tensor.__repr__(self)
