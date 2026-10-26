/** `aws configure`: perfiles, credenciales y región en ~/.aws. */
import { configPath, configSection, credsPath, parseIni, profileNames, readConfigFile, readCredsFile, resolveCredentials, stringifyIni, CredError, type Ini } from '../creds';
import { Raw, op, type AwsIO } from '../registry';

const mask = (v: string | undefined) => (v ? '*'.repeat(16) + v.slice(-4) : 'None');

const CRED_KEYS = new Set(['aws_access_key_id', 'aws_secret_access_key', 'aws_session_token']);

function shown(io: AwsIO, p: string) {
  return p.startsWith(io.home + '/') ? '~' + p.slice(io.home.length) : p;
}

function save(io: AwsIO, path: string, ini: Ini) {
  io.writeFile(path, stringifyIni(ini));
}

/** Guarda un valor de configuración donde corresponde (credenciales o config). */
export function setConfigValue(io: AwsIO, profile: string, key: string, value: string): void {
  if (CRED_KEYS.has(key)) {
    const c = readCredsFile(io);
    (c[profile] ??= {})[key] = value;
    save(io, credsPath(io), c);
  } else {
    const c = readConfigFile(io);
    (c[configSection(profile)] ??= {})[key] = value;
    save(io, configPath(io), c);
  }
}

op('configure', '$run', '', 'Pregunta por las credenciales, la región y el formato y los guarda en ~/.aws.', { anon: true }, async (c) => {
  const io = c.io;
  const profile = c.opts.profile;
  const cr = readCredsFile(io)[profile] ?? {};
  const cf = readConfigFile(io)[configSection(profile)] ?? {};
  const ask = io.prompt;
  if (!ask) return new Raw('');
  const a1 = await ask(`AWS Access Key ID [${mask(cr.aws_access_key_id)}]: `);
  if (a1 === null) return new Raw('');
  const a2 = await ask(`AWS Secret Access Key [${mask(cr.aws_secret_access_key)}]: `);
  if (a2 === null) return new Raw('');
  const a3 = await ask(`Default region name [${cf.region ?? 'None'}]: `);
  if (a3 === null) return new Raw('');
  const a4 = await ask(`Default output format [${cf.output ?? 'None'}]: `);
  if (a4 === null) return new Raw('');
  if (a1.trim()) setConfigValue(io, profile, 'aws_access_key_id', a1.trim());
  if (a2.trim()) setConfigValue(io, profile, 'aws_secret_access_key', a2.trim());
  if (a3.trim()) setConfigValue(io, profile, 'region', a3.trim());
  if (a4.trim()) setConfigValue(io, profile, 'output', a4.trim());
  return new Raw('');
});

op('configure', 'list', '', 'Muestra de dónde salen las credenciales, la región y el perfil que se usan ahora.', { anon: true }, (c) => {
  const io = c.io;
  const profile = c.opts.profile;
  const row = (name: string, value: string, type: string, loc: string) => `${name.padStart(10)} ${value.padStart(24)} ${type.padStart(16)}    ${loc}\n`;
  let out = '      Name                    Value             Type    Location\n      ----                    -----             ----    --------\n';
  const explicit = c.opts.profile !== (io.env.AWS_PROFILE ?? 'default') || false;
  out += row('profile', profile === 'default' && !io.env.AWS_PROFILE ? '<not set>' : profile, io.env.AWS_PROFILE ? 'env' : 'None', io.env.AWS_PROFILE ? 'AWS_PROFILE' : 'None');
  void explicit;
  try {
    const r = resolveCredentials(io, { profile: undefined });
    const loc = r.source === 'env' ? 'AWS_ACCESS_KEY_ID' : r.source === 'shared-credentials-file' ? shown(io, credsPath(io)) : shown(io, configPath(io));
    const loc2 = r.source === 'env' ? 'AWS_SECRET_ACCESS_KEY' : loc;
    out += row('access_key', mask(r.akid), r.source, loc);
    out += row('secret_key', mask(r.secret), r.source, loc2);
  } catch (e) {
    if (!(e instanceof CredError)) throw e;
    out += row('access_key', '<not set>', 'None', 'None');
    out += row('secret_key', '<not set>', 'None', 'None');
  }
  const envRegion = io.env.AWS_REGION ? 'AWS_REGION' : io.env.AWS_DEFAULT_REGION ? 'AWS_DEFAULT_REGION' : '';
  const cf = readConfigFile(io)[configSection(profile)] ?? {};
  if (envRegion) out += row('region', io.env[envRegion], 'env', envRegion);
  else if (cf.region) out += row('region', cf.region, 'config-file', shown(io, configPath(io)));
  else out += row('region', '<not set>', 'None', 'None');
  return new Raw(out);
});

op('configure', 'get', 'varname:s!', 'Muestra un valor de configuración (region, output, aws_access_key_id…).', { anon: true, positional: ['varname'] }, (c) => {
  const profile = c.opts.profile;
  const key = c.p.Varname as string;
  const v = CRED_KEYS.has(key) ? readCredsFile(c.io)[profile]?.[key] : readConfigFile(c.io)[configSection(profile)]?.[key];
  return v === undefined ? new Raw('', '', 1) : new Raw(v + '\n');
});

op('configure', 'set', 'varname:s! value:s!', 'Guarda un valor de configuración sin preguntar nada.', { anon: true, positional: ['varname', 'value'] }, (c) => {
  setConfigValue(c.io, c.opts.profile, c.p.Varname, c.p.Value);
  return new Raw('');
});

op('configure', 'list-profiles', '', 'Lista los perfiles configurados.', { anon: true }, (c) => new Raw(profileNames(c.io).map((n) => n + '\n').join('')));

export { parseIni };
