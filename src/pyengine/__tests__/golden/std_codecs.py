import codecs
s = "héllo ñandú €𝄞"
for enc in ("utf-8", "utf-16", "utf-16-le", "utf-16-be", "utf-32", "utf-8-sig", "unicode-escape", "raw-unicode-escape"):
    b = s.encode(enc)
    print(enc, b, b.decode(enc) == s)
for enc in ("latin-1", "cp1252", "ascii", "iso8859-15", "cp437", "cp850"):
    for err in ("strict", "ignore", "replace", "backslashreplace", "xmlcharrefreplace", "namereplace"):
        try:
            print(enc, err, "héllo €ñ".encode(enc, err))
        except Exception as e:
            print(enc, err, type(e).__name__, e)
for data, enc in ((b"\xff\xfe", "utf-8"), (b"a\xe4\xb8", "utf-8"), (b"\xe4\xb8a", "utf-8"), (b"\xc3(", "utf-8"), (b"\xed\xa0\x80", "utf-8"), (b"abc\x80", "ascii"), (b"\x00\xd8", "utf-16-le"), (b"a", "utf-16")):
    for err in ("strict", "ignore", "replace", "backslashreplace", "surrogateescape"):
        try:
            print(enc, err, repr(data.decode(enc, err)))
        except Exception as e:
            print(enc, err, type(e).__name__, e)
print(codecs.lookup("UTF8").name, codecs.lookup("latin-1").name, codecs.lookup("Windows-1252").name)
print(codecs.encode("abc", "rot13"), codecs.encode(b"abc", "hex"), codecs.decode(b"616263", "hex"), codecs.encode(b"abc", "base64"))
def h(e):
    return ("<%d>" % e.start, e.end)
codecs.register_error("mine", h)
print("aéb".encode("ascii", "mine"), codecs.lookup_error("strict"))
try:
    "x".encode("hex")
except LookupError as e:
    print(e)
try:
    "x".encode("nope")
except LookupError as e:
    print(e)
print("\udc80".encode("utf-8", "surrogateescape"), b"\xff".decode("utf-8", "surrogateescape").encode("utf-8", "surrogateescape"))
print(codecs.BOM_UTF8, codecs.getincrementaldecoder("utf-8")().decode(b"\xe2\x82"), bytes("é", "latin-1"), str(b"\xe9", "latin-1"))
import io
f = io.TextIOWrapper(io.BytesIO("ñ".encode("utf-16")), encoding="utf-16")
print(f.read() if hasattr(f, "read") else None)
print(repr("aé".encode("punycode")), "münchen".encode("idna") if False else "")
