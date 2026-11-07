import numpy as np
from dojo_ai.embeddings import embed, similarity, most_similar, analogia, vocabulario, embed_palabra
print(len(vocabulario()))
for w in ['perro', 'pizza', 'envío', 'contraseña', 'fútbol', 'rey']:
    print(w, most_similar(w, 5))
for a in [('hombre', 'rey', 'mujer'), ('hombre', 'mujer', 'rey'), ('francia', 'parís', 'italia'), ('padre', 'madre', 'hijo'), ('españa', 'madrid', 'japón'), ('tío', 'tía', 'abuelo'), ('camarero', 'camarera', 'profesor')]:
    print(a, analogia(*a))
pares = [('perro', 'gato'), ('perro', 'ordenador'), ('comprar', 'vender'), ('feliz', 'triste'), ('envío', 'paquete')]
for a, b in pares: print(a, b, round(similarity(a, b), 3))
qs = ['¿Cuánto tarda en llegar mi paquete?', 'quiero devolver un producto', 'olvidé mi contraseña', 'cómo pago con tarjeta']
ds = ['Los envíos estándar tardan de 3 a 5 días hábiles.', 'Puedes devolver cualquier artículo en 30 días y recibirás el reembolso.', 'Para restablecer tu contraseña usa el enlace de la pantalla de acceso.', 'Aceptamos tarjeta, PayPal y transferencia bancaria.', 'Nuestro horario de atención es de 9 a 18 h.']
E = embed(ds)
for q in qs:
    s = E @ embed(q)
    print(q, '->', int(np.argmax(s)), np.round(s, 2).tolist())
