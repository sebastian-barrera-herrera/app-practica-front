import { fetchFromInternet } from '../web';
import { mkEnv, type TestEnv } from './helpers';

const day = (e: TestEnv, n: number) => {
  e.acct.clock += n * 86400000;
};

async function setup() {
  const e = mkEnv({ scenario: 'cont-ecs' });
  const zone = (await e.json('route53 create-hosted-zone --name tienda.test --caller-reference z1')).HostedZone.Id as string;
  const zid = zone.replace('/hostedzone/', '');
  const arn = (await e.json('acm request-certificate --domain-name tienda.test --subject-alternative-names "*.tienda.test" --validation-method DNS')).CertificateArn as string;
  const lb = (await e.json('elbv2 describe-load-balancers --names web')).LoadBalancers[0] as { LoadBalancerArn: string; DNSName: string };
  const tg = (await e.json('elbv2 describe-target-groups --names web-tg --query TargetGroups[0].TargetGroupArn')) as string;
  const validate = async () => {
    const rec = (await e.json(`acm describe-certificate --certificate-arn ${arn}`)).Certificate.DomainValidationOptions[0].ResourceRecord as { Name: string; Value: string };
    const batch = JSON.stringify({ Changes: [{ Action: 'UPSERT', ResourceRecordSet: { Name: rec.Name, Type: 'CNAME', TTL: 300, ResourceRecords: [{ Value: rec.Value }] } }] });
    e.write('b.json', batch);
    await e.run(`route53 change-resource-record-sets --hosted-zone-id ${zid} --change-batch file://b.json`);
    return { rec, zid };
  };
  return { e, arn, lb, tg, zid, validate };
}
const status = async (e: TestEnv, arn: string) => (await e.json(`acm describe-certificate --certificate-arn ${arn}`)).Certificate;

describe('ACM: solicitud y validación por DNS', () => {
  test('el certificado sigue pendiente hasta que existe el CNAME; es un solo registro para el dominio y su comodín', async () => {
    const { e, arn, validate } = await setup();
    const c = await status(e, arn);
    expect(c).toMatchObject({ Status: 'PENDING_VALIDATION', DomainName: 'tienda.test', Type: 'AMAZON_ISSUED' });
    expect(c.SubjectAlternativeNames).toEqual(['tienda.test', '*.tienda.test']);
    expect(c.DomainValidationOptions[0].ResourceRecord).toEqual(c.DomainValidationOptions[1].ResourceRecord);
    expect(c.DomainValidationOptions[0].ResourceRecord.Type).toBe('CNAME');
    expect(c.DomainValidationOptions[0].ResourceRecord.Value).toMatch(/\.acm-validations\.aws\.$/);
    expect((await e.run(`acm get-certificate --certificate-arn ${arn}`)).stderr).toContain('RequestInProgressException');
    day(e, 1);
    expect((await status(e, arn)).Status).toBe('PENDING_VALIDATION');
    await validate();
    const ok = await status(e, arn);
    expect(ok.Status).toBe('ISSUED');
    expect(ok.DomainValidationOptions.every((d: { ValidationStatus: string }) => d.ValidationStatus === 'SUCCESS')).toBe(true);
    expect(Date.parse(ok.NotAfter) - Date.parse(ok.NotBefore)).toBe(395 * 86400000);
    expect((await e.json(`acm get-certificate --certificate-arn ${arn}`)).Certificate).toContain('BEGIN CERTIFICATE');
    expect((await e.json('acm list-certificates')).CertificateSummaryList).toHaveLength(1);
  });

  test('sin validar en 72 horas, la solicitud caduca', async () => {
    const { e, arn } = await setup();
    day(e, 4);
    expect((await status(e, arn)).Status).toBe('VALIDATION_TIMED_OUT');
    expect((await e.json('acm list-certificates')).CertificateSummaryList).toHaveLength(0);
    expect((await e.json('acm list-certificates --certificate-statuses VALIDATION_TIMED_OUT')).CertificateSummaryList).toHaveLength(1);
  });

  test('validaciones de la solicitud, idempotencia y etiquetas', async () => {
    const e = mkEnv();
    expect((await e.run('acm request-certificate --domain-name "no valido"')).stderr).toContain('ValidationException');
    expect((await e.run('acm request-certificate --domain-name a.test --validation-method CARTA')).stderr).toContain('ValidationException');
    const names = Array.from({ length: 11 }, (_, i) => `n${i}.tienda.test`).join(' ');
    expect((await e.run(`acm request-certificate --domain-name tienda.test --subject-alternative-names ${names}`)).stderr).toContain('LimitExceededException');
    const a = (await e.json('acm request-certificate --domain-name x.test --idempotency-token t1')).CertificateArn;
    expect((await e.json('acm request-certificate --domain-name x.test --idempotency-token t1')).CertificateArn).toBe(a);
    await e.run(`acm add-tags-to-certificate --certificate-arn ${a} --tags Key=equipo,Value=web`);
    expect((await e.json(`acm list-tags-for-certificate --certificate-arn ${a}`)).Tags).toEqual([{ Key: 'equipo', Value: 'web' }]);
    await e.run(`acm remove-tags-from-certificate --certificate-arn ${a} --tags Key=equipo`);
    expect((await e.json(`acm list-tags-for-certificate --certificate-arn ${a}`)).Tags).toEqual([]);
    expect((await e.run('acm describe-certificate --certificate-arn arn:aws:acm:us-east-1:123456789012:certificate/nada')).stderr).toContain('ResourceNotFoundException');
    await e.run(`acm delete-certificate --certificate-arn ${a}`);
    expect((await e.json('acm list-certificates')).CertificateSummaryList).toHaveLength(0);
  });
});

describe('ACM: HTTPS en el balanceador', () => {
  const listener = (lb: string, tg: string, arn: string) => `elbv2 create-listener --load-balancer-arn ${lb} --protocol HTTPS --port 443 --certificates CertificateArn=${arn} --default-actions Type=forward,TargetGroupArn=${tg}`;

  test('solo se pueden usar certificados emitidos de la misma región', async () => {
    const { e, arn, lb, tg, validate } = await setup();
    expect((await e.run(listener(lb.LoadBalancerArn, tg, arn))).stderr).toContain('UnsupportedCertificate');
    expect((await e.run(listener(lb.LoadBalancerArn, tg, 'arn:aws:acm:us-east-1:123456789012:certificate/nada'))).stderr).toContain('CertificateNotFound');
    await validate();
    const l = await e.json(listener(lb.LoadBalancerArn, tg, arn));
    expect(l.Listeners[0].Certificates[0].CertificateArn).toBe(arn);
    // en uso: no se puede borrar
    const del = await e.run(`acm delete-certificate --certificate-arn ${arn}`);
    expect(del.stderr).toContain('ResourceInUseException');
    expect((await status(e, arn)).InUseBy).toEqual([lb.LoadBalancerArn]);
    expect((await status(e, arn)).RenewalEligibility).toBe('ELIGIBLE');
    // certificados adicionales
    const arn2 = (await e.json('acm request-certificate --domain-name otro.test --validation-method DNS')).CertificateArn as string;
    expect((await e.run(`elbv2 add-listener-certificates --listener-arn ${l.Listeners[0].ListenerArn} --certificates CertificateArn=${arn2}`)).stderr).toContain('UnsupportedCertificate');
  });

  test('el certificado tiene que cubrir el nombre al que se conecta el cliente', async () => {
    const { e, arn, lb, tg, zid, validate } = await setup();
    await validate();
    await e.run(listener(lb.LoadBalancerArn, tg, arn));
    // el grupo de seguridad del balanceador tiene que dejar entrar por el 443
    const sg = (await e.json('ec2 describe-security-groups --filters Name=group-name,Values=alb-sg --query SecurityGroups[0].GroupId')) as string;
    await e.run(`ec2 authorize-security-group-ingress --group-id ${sg} --protocol tcp --port 443 --cidr 0.0.0.0/0`);
    const rec = (name: string) => {
      e.write('r.json', JSON.stringify({ Changes: [{ Action: 'UPSERT', ResourceRecordSet: { Name: name, Type: 'A', AliasTarget: { HostedZoneId: 'Z35SXDOTRQ7X7K', DNSName: lb.DNSName, EvaluateTargetHealth: false } } }] }));
      return e.run(`route53 change-resource-record-sets --hosted-zone-id ${zid} --change-batch file://r.json`);
    };
    await rec('www.tienda.test');
    await rec('a.b.tienda.test');
    // por el nombre del balanceador, el certificado no coincide (curl lo rechaza, `-k` lo ignora)
    const byDns = fetchFromInternet(e.acct, `https://${lb.DNSName}/`);
    expect(byDns).toMatchObject({ ok: false, curlCode: 60 });
    expect(byDns.error).toContain('no alternative certificate subject name matches');
    expect(fetchFromInternet(e.acct, `https://${lb.DNSName}/`, { headers: { 'x-curl-insecure': '1' } }).curlCode).not.toBe(60);
    // por el dominio, sí (el comodín cubre un nivel)
    expect(fetchFromInternet(e.acct, 'https://www.tienda.test/').curlCode).not.toBe(60);
    expect(fetchFromInternet(e.acct, 'https://a.b.tienda.test/').curlCode).toBe(60);
  });

  test('renovación gestionada: necesita estar en uso y que el CNAME siga publicado', async () => {
    const { e, arn, lb, tg, zid, validate } = await setup();
    const { rec } = await validate();
    await e.run(listener(lb.LoadBalancerArn, tg, arn));
    const before = await status(e, arn);
    day(e, 345);
    await e.run('sts get-caller-identity');
    const after = await status(e, arn);
    expect(after.Status).toBe('ISSUED');
    expect(after.RenewalSummary.RenewalStatus).toBe('SUCCESS');
    expect(Date.parse(after.NotAfter)).toBeGreaterThan(Date.parse(before.NotAfter));
    // si alguien borra el registro, el certificado no se renueva y caduca
    e.write('d.json', JSON.stringify({ Changes: [{ Action: 'DELETE', ResourceRecordSet: { Name: rec.Name, Type: 'CNAME', TTL: 300, ResourceRecords: [{ Value: rec.Value }] } }] }));
    await e.run(`route53 change-resource-record-sets --hosted-zone-id ${zid} --change-batch file://d.json`);
    day(e, 340);
    await e.run('sts get-caller-identity');
    expect((await status(e, arn)).RenewalSummary.RenewalStatus).toBe('PENDING_VALIDATION');
    day(e, 70);
    await e.run('sts get-caller-identity');
    expect((await status(e, arn)).Status).toBe('EXPIRED');
  });
});
