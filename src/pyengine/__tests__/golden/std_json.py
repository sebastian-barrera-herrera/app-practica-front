import json
d = {"nombre": "Ana", "edad": 30, "notas": [1, 2.5, None, True], "x": {"y": "é"}}
s = json.dumps(d)
print(s, json.loads(s) == d)
print(json.dumps(d, indent=2, ensure_ascii=False, sort_keys=True))
print(json.dumps([1, 2], separators=(",", ":")), json.dumps("a\n\"b\""), json.dumps(1.0), json.dumps({1: "a"}), json.dumps((1, 2)))
print(json.loads('[1, 2.5, "x", null, true, {"a": [] }]'), json.loads("3"), json.loads('"hola"'))
try: json.loads("{bad}")
except json.JSONDecodeError as e: print(e, e.lineno, e.colno, e.pos)
try: json.dumps({1, 2})
except TypeError as e: print(e)
print(json.dumps({"a": 1}, default=str), json.dumps(float("nan")), json.loads("1e3"), json.dumps({"k": [1, {"z": None}]}, indent=1))
import io
buf = io.StringIO(); json.dump({"a": [1, 2]}, buf); print(buf.getvalue(), json.load(io.StringIO('{"q": 1}')))
class E(json.JSONEncoder):
    def default(self, o): return list(o) if isinstance(o, set) else super().default(o)
print(json.dumps({"s": {3, 1}}, cls=E))
print(json.loads('{"a":1}', object_hook=lambda d: list(d.items())), json.loads("[1.5]", parse_float=str))
