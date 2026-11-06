from sklearn.utils import type_of_target


def unique_labels(*ys):
    import numpy as np
    seen = []
    for y in ys:
        for v in np.unique(y).tolist():
            if v not in seen:
                seen.append(v)
    return np.array(sorted(seen))
