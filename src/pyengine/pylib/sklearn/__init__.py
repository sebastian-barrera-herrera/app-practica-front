"""scikit-learn en miniatura para Dev Dojo (API compatible con lo más usado; todo sobre NumPy)."""
from sklearn.base import clone

__version__ = '1.9.1'


def set_config(**kw):
    pass


def get_config():
    return {'assume_finite': False, 'working_memory': 1024, 'print_changed_only': True, 'display': 'diagram', 'transform_output': 'default'}


def config_context(**kw):
    class _C:
        def __enter__(self):
            return self

        def __exit__(self, *e):
            return False
    return _C()
