import { PySession } from '../../index';
import { E } from '../../runtime/exc_types';
import { PyType } from '../../runtime/objects';
const s = new PySession({});
console.log('Exception.alloc', !!E.Exception.alloc, 'Base.alloc', !!E.BaseException.alloc);
s.run('class E(Exception): pass\nx = E()\nprint(type(x))').then((r) => { console.log(r.stdout, r.stderr);
  const g: any = s.I.mainGlobals; const Ecls = g.get('E') as PyType; console.log('E.alloc', !!Ecls.alloc, Ecls.mro.map(m=>m.name+':'+!!m.alloc)); });
