import numpy as np
from sklearn.datasets import load_digits
from dojo_ai.vectordb import IndexFlatL2, IndexFlatIP, IndexIVF, IndexLSH, recall, Client
from dojo_ai.corpus import FAQ
from dojo_ai.embeddings import embed

X, y = load_digits(return_X_y=True)
X = X / 16.0
Xb, Q = X[:1500], X[1500:1520]
flat = IndexFlatL2(64); flat.add(Xb)
D, I = flat.search(Q, 5)
print(I[0].tolist(), flat.last_comparisons)
for np_ in (1, 2, 4):
    ivf = IndexIVF(64, nlist=16, nprobe=np_); ivf.train(Xb); ivf.add(Xb)
    D2, I2 = ivf.search(Q, 5)
    print('ivf', np_, round(recall(I2, I), 2), ivf.last_comparisons)
lsh = IndexLSH(64, nbits=6); lsh.add(Xb)
D3, I3 = lsh.search(Q, 5)
print('lsh', round(recall(I3, I), 2), lsh.last_comparisons)
c = Client().create_collection('faq', metadata={'hnsw:space': 'cosine'})
c.add(ids=[f[0] for f in FAQ], documents=[f[2] for f in FAQ], metadatas=[{'categoria': f[1]} for f in FAQ])
r = c.query(query_texts=['¿puedo devolver un producto?'], n_results=2)
print(r['ids'], [round(d, 3) for d in r['distances'][0]])
r = c.query(query_texts=['cuánto cuesta el envío'], n_results=3, where={'categoria': 'pagos'})
print(r['ids'])
