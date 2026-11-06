import numpy as np

# Generator: el zigurat de NumPy (normal y exponencial) y las distribuciones que dependen de él
for seed in [0, 7]:
    r = np.random.default_rng(seed)
    print(r.standard_normal(4).round(6).tolist())
    print(r.normal(10, 2, 3).round(6).tolist())
    print(r.exponential(2.0, 3).round(6).tolist())
    print(r.gamma(0.5, 1.0, 2).round(6).tolist(), r.gamma(3.0, 2.0, 2).round(6).tolist())
    print(r.beta(2, 3, 2).round(6).tolist(), r.beta(0.5, 0.7, 2).round(6).tolist())
    print(r.chisquare(4, 2).round(6).tolist(), r.standard_t(6, 2).round(6).tolist(), r.lognormal(0, 0.5, 2).round(6).tolist())
    print(r.geometric(0.1, 6).tolist(), r.geometric(0.6, 6).tolist())
    print(r.dirichlet([2, 3, 4], 2).round(6).tolist())
    print(r.integers(0, 10, 5).tolist(), r.choice(5, 3, replace=False).tolist(), r.permutation(5).tolist())

# semillas con listas y SeedSequence
print(np.random.default_rng([1, 2, 3]).random(3).round(6).tolist())
print(np.random.default_rng(np.random.SeedSequence(5)).random(3).round(6).tolist())

# la API antigua sigue igual
np.random.seed(3)
print(np.random.geometric(0.1, 8).tolist(), np.random.exponential(2.0, 3).round(6).tolist())
print(np.random.randn(3).round(6).tolist(), np.random.gamma(2.0, 1.0, 3).round(6).tolist())

# la suma sigue el orden de NumPy (por pares en el eje contiguo, en secuencia en el otro)
x = np.random.default_rng(1).standard_normal(1000)
print(repr(float(x.sum())), repr(float(x.mean())), repr(float(x.var())))
m = np.random.default_rng(2).standard_normal((300, 4))
print(repr(float(m.sum())))
print(m.sum(axis=0).tolist())
print(m.sum(axis=1)[:3].tolist())
print(m.mean(axis=0).tolist())
print(m.var(axis=0).tolist())
