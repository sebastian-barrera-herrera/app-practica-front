#!/usr/bin/env python3
"""
Genera src/pyengine/stdlib/pylib.generated.ts a partir de src/pyengine/pylib/manifest.json.

Cada módulo viene de la biblioteca estándar de CPython 3.13 ("std:ruta", tal cual salvo comentarios y líneas en
blanco) o de src/pyengine/pylib/ ("own:archivo.py", escrito a mano para este intérprete). Sufijo "!pkg" = paquete.
Uso: python3 scripts/build_pylib.py
"""
import io, json, os, sys, tokenize

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYLIB = os.path.join(ROOT, 'src', 'pyengine', 'pylib')
STD = os.path.dirname(os.__file__)
OUT = os.path.join(ROOT, 'src', 'pyengine', 'stdlib', 'pylib.generated.ts')


# Parches mínimos sobre módulos de CPython para igualar los mensajes de la versión en C (que la biblioteca pura no replica).
PATCHES = {
    '_pydatetime': [
        ("raise ValueError('year must be in %d..%d' % (MINYEAR, MAXYEAR), year)", "raise ValueError('year %d is out of range' % year)"),
        ("raise ValueError('month must be in 1..12', month)", "raise ValueError('month must be in 1..12')"),
        ("raise ValueError('day must be in 1..%d' % dim, day)", "raise ValueError('day is out of range for month')"),
        ("raise ValueError('hour must be in 0..23', hour)", "raise ValueError('hour must be in 0..23')"),
        ("raise ValueError('minute must be in 0..59', minute)", "raise ValueError('minute must be in 0..59')"),
        ("raise ValueError('second must be in 0..59', second)", "raise ValueError('second must be in 0..59')"),
        ("raise ValueError('microsecond must be in 0..999999', microsecond)", "raise ValueError('microsecond must be in 0..999999')"),
        ("raise ValueError('fold must be either 0 or 1', fold)", "raise ValueError('fold must be either 0 or 1')"),
    ],
}


def minify(src: str) -> str:
    lines = src.splitlines()
    keep = set()
    try:
        for tok in tokenize.generate_tokens(io.StringIO(src).readline):
            if tok.type in (tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER):
                continue
            for r in range(tok.start[0], tok.end[0] + 1):
                keep.add(r)
    except tokenize.TokenError:
        return src
    out = []
    for i, l in enumerate(lines, 1):
        if i in keep or (i - 1 in keep and False):
            out.append(l.rstrip())
    # una línea que continúa la anterior con barra invertida o está dentro de paréntesis ya está en `keep`
    return '\n'.join(out) + '\n'


def main() -> None:
    man = json.load(open(os.path.join(PYLIB, 'manifest.json')))
    parts = ['// GENERADO por scripts/build_pylib.py: no editar a mano.\n', "import { registerPy } from './registry';\n\n"]
    total = 0
    for name, spec in man['modules'].items():
        kind, rest = spec.split(':', 1)
        pkg = rest.endswith('!pkg')
        path = rest[:-4] if pkg else rest
        base = STD if kind == 'std' else PYLIB
        full = os.path.join(base, path)
        if not os.path.exists(full):
            print('FALTA', name, full)
            sys.exit(1)
        raw = open(full, encoding='utf8').read()
        for old, new in PATCHES.get(name, []):
            if old not in raw:
                print('PARCHE NO APLICABLE', name, old)
                sys.exit(1)
            raw = raw.replace(old, new)
        src = minify(raw)
        total += len(src)
        parts.append(f'registerPy({json.dumps(name)}, () => {json.dumps(src)}, {"true" if pkg else "false"});\n')
    open(OUT, 'w', encoding='utf8').write(''.join(parts))
    print(f'{len(man["modules"])} módulos, {total/1024:.0f} KB de fuente → {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
