import { answerSituation, directEncrypt, DIRECT_LIMIT, ENVELOPE, envelopeAt, kmsAccess, SCP_ACTIONS, SEC_SERVICES, SEC_SITUATIONS, scpDecide, WAF_REQS, WAF_RULES, wafDecide, type ScpLevel, type WafRule } from '../awsSecLogic';

describe('cifrado de sobre', () => {
  test('Encrypt solo admite 4 KB', () => {
    expect(directEncrypt(DIRECT_LIMIT).ok).toBe(true);
    expect(directEncrypt(DIRECT_LIMIT + 1).ok).toBe(false);
    expect(directEncrypt(5_000_000).reason).toMatch(/GenerateDataKey/);
  });

  test('al cifrar la clave en claro desaparece antes de guardar el sobre', () => {
    const s = ENVELOPE.cifrar;
    expect(s[0].kms).toBe('GenerateDataKey');
    expect(s[0].plainKey && s[0].cipherKey).toBe(true);
    expect(s[2].plainKey).toBe(false);
    expect(s[3].stored).toEqual(['fichero.cifrado', 'clave-de-datos.cifrada']);
    expect(s.every((x) => x.kms === null || x.kms === 'GenerateDataKey')).toBe(true);
  });

  test('al descifrar solo se ve el fichero en claro mientras la clave está en memoria', () => {
    const s = ENVELOPE.descifrar;
    expect(s[1].kms).toBe('Decrypt');
    s.forEach((x) => {
      if (x.data === 'claro') expect(x.plainKey).toBe(true);
    });
    expect(s[3].plainKey).toBe(false);
  });

  test('retirar kms:Decrypt atasca el descifrado en la llamada a KMS', () => {
    expect(envelopeAt('descifrar', 0, true).blocked).toBe(false);
    for (const i of [1, 2, 3]) {
      const b = envelopeAt('descifrar', i, true);
      expect(b.blocked).toBe(true);
      expect(b.plainKey).toBe(false);
      expect(b.data).toBe('cifrado');
      expect(b.text).toMatch(/AccessDenied/);
    }
    // cifrar no pasa por Decrypt; y sin revocar todo funciona
    expect(envelopeAt('cifrar', 2, true).blocked).toBe(false);
    expect(envelopeAt('descifrar', 2, false).blocked).toBe(false);
    // índices fuera de rango se acotan
    expect(envelopeAt('cifrar', 99, false).title).toBe(ENVELOPE.cifrar[3].title);
    expect(envelopeAt('cifrar', -5, false).title).toBe(ENVELOPE.cifrar[0].title);
  });
});

describe('quién puede usar la clave', () => {
  const none = { delegates: false, names: false, iam: false, grant: false, deny: false };
  test('IAM solo vale si la clave delega', () => {
    expect(kmsAccess({ ...none, iam: true }).allowed).toBe(false);
    expect(kmsAccess({ ...none, iam: true }).why).toMatch(/IAM por sí solo no vale/);
    expect(kmsAccess({ ...none, iam: true, delegates: true })).toMatchObject({ allowed: true, via: 'iam' });
    expect(kmsAccess({ ...none, delegates: true }).allowed).toBe(false);
  });
  test('nombrar al rol en la política de la clave basta; una concesión también', () => {
    expect(kmsAccess({ ...none, names: true })).toMatchObject({ allowed: true, via: 'policy' });
    expect(kmsAccess({ ...none, grant: true })).toMatchObject({ allowed: true, via: 'grant' });
    expect(kmsAccess(none)).toMatchObject({ allowed: false, via: null });
  });
  test('un Deny explícito gana a todo', () => {
    expect(kmsAccess({ delegates: true, names: true, iam: true, grant: true, deny: true }).allowed).toBe(false);
  });
});

describe('evaluación de WAF', () => {
  const req = (id: string) => WAF_REQS.find((r) => r.id === id)!;
  test('el caso base: cada petición cae donde debe', () => {
    const d = (id: string) => wafDecide(WAF_RULES, req(id), 'Allow');
    expect(d('home')).toMatchObject({ decision: 'Allow', by: 'acción por defecto' });
    expect(d('admin-office')).toMatchObject({ decision: 'Allow', by: 'Permitir oficina' });
    expect(d('admin-out')).toMatchObject({ decision: 'Block', by: 'Bloquear /admin' });
    expect(d('sqli')).toMatchObject({ decision: 'Block', by: 'Grupo SQLi' });
    expect(d('flood')).toMatchObject({ decision: 'Block', by: 'Límite de /login' });
  });

  test('la prioridad manda: si «Bloquear /admin» va antes que «Permitir oficina», Ana queda fuera', () => {
    const swapped: WafRule[] = WAF_RULES.map((r) => (r.id === 'admin' ? { ...r, priority: 0 } : r.id === 'office' ? { ...r, priority: 1 } : r));
    const t = wafDecide(swapped, req('admin-office'), 'Allow');
    expect(t.decision).toBe('Block');
    expect(t.trace[0].rule.id).toBe('admin');
    expect(t.trace[1].skipped).toBe(true);
  });

  test('las reglas posteriores a la que termina quedan sin evaluar', () => {
    const t = wafDecide(WAF_RULES, req('sqli'), 'Allow');
    expect(t.trace.map((x) => x.skipped)).toEqual([false, false, false, true]);
    expect(t.trace[2].hit).toBe(true);
  });

  test('Count solo anota y deja seguir', () => {
    const counting = WAF_RULES.map((r) => (r.id === 'sqli' ? { ...r, action: 'Count' as const } : r));
    const t = wafDecide(counting, req('sqli'), 'Allow');
    expect(t.decision).toBe('Allow');
    expect(t.counted).toEqual(['Grupo SQLi']);
  });

  test('con acción por defecto Block, lo que nadie permite se bloquea', () => {
    expect(wafDecide(WAF_RULES, req('home'), 'Block')).toMatchObject({ decision: 'Block', by: 'acción por defecto' });
    expect(wafDecide(WAF_RULES, req('admin-office'), 'Block').decision).toBe('Allow');
  });

  test('no modifica el orden de la lista original', () => {
    const copy = JSON.stringify(WAF_RULES);
    wafDecide([...WAF_RULES].reverse(), req('flood'), 'Allow');
    expect(JSON.stringify(WAF_RULES)).toBe(copy);
  });
});

describe('qué servicio responde a qué', () => {
  test('cada situación tiene una respuesta válida y única en el catálogo', () => {
    for (const s of SEC_SITUATIONS) expect(SEC_SERVICES).toContain(s.answer);
    expect(new Set(SEC_SITUATIONS.map((s) => s.id)).size).toBe(SEC_SITUATIONS.length);
  });
  test('acierto y fallo', () => {
    expect(answerSituation('s1', 'GuardDuty').ok).toBe(true);
    const bad = answerSituation('s1', 'Macie');
    expect(bad.ok).toBe(false);
    expect(bad.right).toBe('GuardDuty');
    expect(bad.why).toMatch(/GuardDuty/);
    expect(answerSituation('nope', 'Macie').ok).toBe(false);
  });
});

describe('cadena de SCP', () => {
  const act = (id: string) => SCP_ACTIONS.find((a) => a.id === id)!;
  const open: ScpLevel[] = [{ name: 'Raíz', full: true }, { name: 'Producción', full: true }, { name: 'web-prod', full: true }];

  test('con FullAWSAccess en todos los niveles todo pasa', () => {
    for (const a of SCP_ACTIONS) expect(scpDecide(open, a, false).allowed).toBe(true);
  });

  test('una SCP de región niega fuera de ella pero no los servicios globales', () => {
    const lv: ScpLevel[] = [open[0], { name: 'Producción', full: true, region: 'eu-west-1' }, open[2]];
    expect(scpDecide(lv, act('ec2-ie'), false).allowed).toBe(true);
    const va = scpDecide(lv, act('ec2-va'), false);
    expect(va).toMatchObject({ allowed: false, level: 'Producción', reason: 'deny' });
    expect(scpDecide(lv, act('iam'), false).allowed).toBe(true);
  });

  test('un nivel sin ningún Allow bloquea todo, aunque los demás permitan', () => {
    const lv: ScpLevel[] = [open[0], { name: 'Producción', full: false }, open[2]];
    expect(scpDecide(lv, act('s3'), false)).toMatchObject({ allowed: false, level: 'Producción', reason: 'no-allow' });
  });

  test('una lista de permitidos solo deja pasar esos servicios', () => {
    const lv: ScpLevel[] = [open[0], { name: 'Producción', full: false, allow: ['ec2', 's3'] }, open[2]];
    expect(scpDecide(lv, act('s3'), false).allowed).toBe(true);
    expect(scpDecide(lv, act('iam'), false)).toMatchObject({ allowed: false, reason: 'no-allow' });
  });

  test('un Deny puntual gana aunque FullAWSAccess siga ahí', () => {
    const lv: ScpLevel[] = [open[0], open[1], { name: 'web-prod', full: true, deny: ['cloudtrail:StopLogging'] }];
    expect(scpDecide(lv, act('ct'), false)).toMatchObject({ allowed: false, level: 'web-prod', reason: 'deny' });
    expect(scpDecide(lv, act('s3'), false).allowed).toBe(true);
  });

  test('el primer nivel que falla es el que se señala', () => {
    const lv: ScpLevel[] = [{ name: 'Raíz', full: true, deny: ['s3:*'] }, { name: 'Producción', full: false }, open[2]];
    expect(scpDecide(lv, act('s3'), false).level).toBe('Raíz');
  });

  test('la cuenta de administración no se ve afectada por las SCP', () => {
    const lv: ScpLevel[] = [{ name: 'Raíz', full: false, deny: ['ec2:*'] }];
    expect(scpDecide(lv, act('ec2-ie'), true)).toMatchObject({ allowed: true, reason: 'management' });
    expect(scpDecide(lv, act('ec2-ie'), false).allowed).toBe(false);
  });
});
