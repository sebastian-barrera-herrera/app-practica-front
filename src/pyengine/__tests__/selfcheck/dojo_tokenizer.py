from dojo_ai.tokenizer import BPETokenizer, get_encoding, contar_tokens
enc = get_encoding()
print(enc, enc.vocab_size)
for t in ['los envíos internacionales tardan más', 'internacionalización', 'el gato come pescado .', 'zxqwv', 'programación']:
    print(t, '->', enc.tokens(t), enc.encode(t)[:6])
print(enc.decode(enc.encode('el gato come pescado .')))
print(enc.merges[:12])
print(contar_tokens('hola, ¿cómo estás?'))
