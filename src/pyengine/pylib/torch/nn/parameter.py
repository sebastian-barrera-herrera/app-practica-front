from torch import Tensor


class Parameter(Tensor):
    def __init__(self, data=None, requires_grad=True):
        Tensor.__init__(self, data, requires_grad=requires_grad)

    def __repr__(self):
        return 'Parameter containing:\n' + Tensor.__repr__(self)
