import React, { useState } from 'react';
import { View } from 'react-native';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Tabs } from './pyui';
import { Explain, Pill, Stepper, Toggle, awsHue } from './awsui';

const Box = ({ title, ok, children }: { title: string; ok?: boolean; children?: React.ReactNode }) => {
  const c = ok === undefined ? colors.line : ok ? colors.green : colors.rose;
  return (
    <View style={{ borderWidth: 1.5, borderColor: c, backgroundColor: ok === undefined ? 'transparent' : c + '1A', borderRadius: radius.sm, padding: 8, gap: 4 }}>
      <T style={{ fontFamily: fonts.monoBold, fontSize: 12.5 }} color={colors.text}>{title}</T>
      {children}
    </View>
  );
};

const Mono = ({ children, color }: { children: React.ReactNode; color?: string }) => (
  <T style={{ fontFamily: fonts.mono, fontSize: 11.5 }} color={color ?? colors.text}>{children}</T>
);

// ───────────────────────── Lambda: memoria, CPU, coste y arranque en frío ─────────────────────────

const MEMS = [128, 256, 512, 1024, 1769, 3008];

export function LambdaLifecycle() {
  const [mem, setMem] = useState(512);
  const [cold, setCold] = useState(true);
  const [prov, setProv] = useState(false);
  const { a } = awsHue();
  // un trabajo que con 1 vCPU completa (1769 MB) tarda 800 ms; con menos memoria tarda proporcionalmente más y con más no mejora (un solo hilo)
  const run = Math.round(800 * Math.max(1, 1769 / mem));
  const init = cold && !prov ? 280 : 0;
  const total = run + init;
  const gbs = (mem / 1024) * (run / 1000);
  const perMillion = gbs * 0.0000166667 * 1e6 + 0.2;
  const cpu = Math.min(2, mem / 1769);
  const best = mem === 1769;
  return (
    <Frame>
      <T v="label" color={colors.dim}>Memoria asignada (MB) — la CPU va en el mismo paquete</T>
      <Tabs color={a} value={String(mem)} onChange={(v) => setMem(Number(v))} items={MEMS.map((m) => ({ id: String(m), label: String(m) }))} />
      <Toggle label="La función estaba «fría» (primera petición o tras 5 min parada)" on={cold} set={setCold} />
      <Toggle label="Concurrencia aprovisionada (entornos siempre calientes)" on={prov} set={setProv} hint="Se paga aunque nadie llame" />
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`${cpu.toFixed(2)} vCPU`} color={a} />
        <Pill text={`Init ${init} ms`} color={init ? colors.amber : colors.green} />
        <Pill text={`Invoke ${run} ms`} color={run > 3000 ? colors.rose : colors.violet} />
        <Pill text={`Total ${total} ms`} color={total > 3000 ? colors.rose : colors.green} solid />
      </View>
      <Box title="📄 REPORT RequestId: …">
        <Mono>
          Duration: {run}.00 ms · Billed Duration: {run} ms · Memory Size: {mem} MB{init ? ` · Init Duration: ${init}.00 ms` : ''}
        </Mono>
      </Box>
      <Explain k={`${mem}${cold}${prov}`} title={`≈ ${perMillion.toFixed(2)} $ por millón de ejecuciones (ilustrativo)`} color={best ? colors.green : a}>
        {mem < 1769
          ? 'Con poca memoria la función es más lenta: la CPU es proporcional. Como se paga memoria × tiempo, el coste apenas cambia… pero tu usuario espera mucho más. Sube la memoria hasta que dejes de ganar tiempo.'
          : mem === 1769
            ? 'A 1.769 MB tienes un vCPU completo: es el punto en el que un código de un solo hilo deja de acelerar. Casi siempre es el equilibrio entre rapidez y precio.'
            : 'Por encima de 1.769 MB solo ganas con código que use varios hilos. Si tu función es de un solo hilo, pagas más por lo mismo.'}{' '}
        {init ? 'El arranque en frío añade el tiempo de crear el entorno e importar tu código (Init Duration); no se cobra aparte pero se nota.' : 'Sin arranque en frío: el entorno ya estaba listo.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── API Gateway: cada salto puede fallar ─────────────────────────

export function ApiFlow() {
  const [route, setRoute] = useState(true);
  const [guarded, setGuarded] = useState(true);
  const [token, setToken] = useState(false);
  const [perm, setPerm] = useState(false);
  const [format, setFormat] = useState(true);
  const [iam, setIam] = useState(false);
  const { a } = awsHue();
  const hops = [
    { id: 'route', title: '1 · API Gateway: ¿hay ruta?', ok: route, status: 404, msg: '{"message":"Not Found"} — la ruta o la etapa no existen (¿falta desplegar?).' },
    { id: 'auth', title: '2 · Autorizador JWT', ok: !guarded || token, status: 401, msg: '{"message":"Unauthorized"} — falta el token o no coincide el emisor / la audiencia.' },
    { id: 'perm', title: '3 · Permiso para invocar la función', ok: perm, status: 500, msg: '{"message":"Internal Server Error"} — la política de recursos de la función no admite a apigateway.amazonaws.com.' },
    { id: 'iam', title: '4 · La función usa su rol (DynamoDB)', ok: iam, status: 500, msg: 'La función lanza AccessDeniedException (está en sus logs) y API Gateway devuelve un 500 genérico.' },
    { id: 'fmt', title: '5 · Respuesta de la función', ok: format, status: 500, msg: 'Falta statusCode o body no es una cadena: API Gateway no puede construir la respuesta.' },
  ];
  const fail = hops.find((h) => !h.ok);
  return (
    <Frame>
      <Toggle label="La ruta y la etapa existen (y están desplegadas)" on={route} set={setRoute} good="on" />
      <Toggle label="La ruta está protegida con un autorizador JWT" on={guarded} set={setGuarded} />
      {guarded ? <Toggle label="La petición lleva un token válido" on={token} set={setToken} good="on" /> : null}
      <Toggle label="La función admite a API Gateway (add-permission)" on={perm} set={setPerm} good="on" />
      <Toggle label="El rol de la función tiene permiso sobre la tabla" on={iam} set={setIam} good="on" />
      <Toggle label="Devuelve {statusCode, body: «texto»}" on={format} set={setFormat} good="on" />
      {hops.map((h) => {
        const reached = !fail || hops.indexOf(h) <= hops.indexOf(fail);
        return <Box key={h.id} title={`${h.ok && reached ? '✓' : reached ? '✖' : '·'} ${h.title}`} ok={reached ? h.ok : undefined} />;
      })}
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={`HTTP ${fail ? fail.status : 200}`} color={fail ? colors.rose : colors.green} solid />
        <Pill text={fail ? 'falla un salto' : 'todo conectado'} color={fail ? colors.amber : a} />
      </View>
      <Explain k={`${route}${guarded}${token}${perm}${iam}${format}`} title={fail ? 'Dónde se corta' : '✓ La petición llega y vuelve'} color={fail ? colors.rose : colors.green}>
        {fail ? fail.msg : 'Ruta → autorizador → función (con permiso) → DynamoDB (con rol) → respuesta bien formada. Cuando algo falla con un 500, mira los logs de la función: es donde está la causa.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── SQS: visibilidad, reintentos y cola de mensajes muertos ─────────────────────────

export function SqsVisibility() {
  const [vis, setVis] = useState(30);
  const [work, setWork] = useState(10);
  const [max, setMax] = useState(3);
  const [fails, setFails] = useState(false);
  const { a } = awsHue();
  const lines: { t: number; text: string; bad?: boolean }[] = [];
  let t = 0;
  let dlq = false;
  let dup = false;
  if (fails) {
    for (let k = 1; k <= max; k++) {
      lines.push({ t, text: `recibido (${k}/${max}) → el consumidor falla a los ${Math.min(work, vis)} s`, bad: true });
      t += vis;
    }
    lines.push({ t, text: `al recibirlo por ${max + 1}ª vez supera maxReceiveCount → pasa a la cola de mensajes muertos`, bad: true });
    dlq = true;
  } else if (work > vis) {
    lines.push({ t: 0, text: 'recibido por el consumidor A' });
    lines.push({ t: vis, text: `la visibilidad (${vis} s) caduca y A aún trabaja → otro consumidor B lo recibe también`, bad: true });
    lines.push({ t: work, text: 'A termina y borra con un recibo que ya no vale; B repite el trabajo' });
    dup = true;
  } else {
    lines.push({ t: 0, text: 'recibido: el mensaje se oculta durante el tiempo de visibilidad' });
    lines.push({ t: work, text: 'procesado y borrado (DeleteMessage): no vuelve' });
  }
  return (
    <Frame>
      <Stepper label="Tiempo de visibilidad (s)" value={vis} min={0} max={120} step={10} onChange={setVis} />
      <Stepper label="Lo que tarda el consumidor (s)" value={work} min={1} max={60} step={1} onChange={setWork} />
      <Stepper label="maxReceiveCount" value={max} min={1} max={5} onChange={setMax} />
      <Toggle label="El consumidor falla con este mensaje" on={fails} set={setFails} good="off" />
      <Box title="⏱️ Línea de tiempo del mensaje" ok={dlq || dup ? false : true}>
        {lines.map((l, i) => (
          <Mono key={i} color={l.bad ? colors.rose : colors.text}>
            t={l.t}s · {l.text}
          </Mono>
        ))}
      </Box>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Pill text={dlq ? 'acaba en la DLQ' : dup ? 'procesado dos veces' : 'procesado una vez'} color={dlq ? colors.amber : dup ? colors.rose : colors.green} solid />
        <Pill text={`visibilidad ${work > vis ? '<' : '≥'} trabajo`} color={work > vis ? colors.rose : a} />
      </View>
      <Explain k={`${vis}${work}${max}${fails}`} title={dlq ? 'Mensaje «veneno» apartado' : dup ? 'Visibilidad demasiado corta' : 'Camino feliz'} color={dlq ? colors.amber : dup ? colors.rose : colors.green}>
        {dlq
          ? 'Sin una DLQ, un mensaje que siempre falla se reintenta para siempre y gasta ejecuciones. Con maxReceiveCount lo apartas para revisarlo después y el resto de la cola sigue.'
          : dup
            ? 'Regla de oro: la visibilidad debe ser mayor que lo que tarda el consumidor (con Lambda, al menos 6 veces el timeout de la función). Si no, SQS reparte el mismo mensaje dos veces.'
            : 'SQS garantiza «al menos una vez»: tu código debe ser idempotente por si algún mensaje llega repetido.'}
      </Explain>
    </Frame>
  );
}

// ───────────────────────── EventBridge: reglas y patrones ─────────────────────────

interface Ev {
  label: string;
  source: string;
  type: string;
  total?: number;
}

const EVENTS: Ev[] = [
  { label: 'Pedido de 250 €', source: 'tienda.pedidos', type: 'PedidoCreado', total: 250 },
  { label: 'Pedido de 40 €', source: 'tienda.pedidos', type: 'PedidoCreado', total: 40 },
  { label: 'Envío salido', source: 'tienda.envios', type: 'EnvioSalido' },
];

export function EventRouting() {
  const [i, setI] = useState(0);
  const [min, setMin] = useState(100);
  const [exact, setExact] = useState(true);
  const { a } = awsHue();
  const e = EVENTS[i];
  const rules = [
    { name: 'pedidos-grandes', to: '📥 cola grandes', pat: `source = tienda.pedidos, detail.total > ${min}`, ok: e.source === 'tienda.pedidos' && (e.total ?? 0) > min },
    { name: 'todos-los-pedidos', to: '📊 analítica (Lambda)', pat: exact ? 'source = tienda.pedidos, detail-type = PedidoCreado' : 'source = tienda.pedidos', ok: e.source === 'tienda.pedidos' && (!exact || e.type === 'PedidoCreado') },
    { name: 'todo', to: '🪵 auditoría (S3 vía Firehose)', pat: 'source = prefijo «tienda.»', ok: e.source.startsWith('tienda.') },
  ];
  return (
    <Frame>
      <T v="label" color={colors.dim}>Evento que llega al bus por defecto</T>
      <Tabs color={a} value={String(i)} onChange={(v) => setI(Number(v))} items={EVENTS.map((x, k) => ({ id: String(k), label: x.label }))} />
      <Box title="📨 Evento">
        <Mono>
          {`{ "source": "${e.source}", "detail-type": "${e.type}"${e.total !== undefined ? `, "detail": { "total": ${e.total} }` : ''} }`}
        </Mono>
      </Box>
      <Stepper label="Umbral de «pedidos-grandes» (€)" value={min} min={0} max={500} step={50} onChange={setMin} />
      <Toggle label="«todos-los-pedidos» exige también detail-type" on={exact} set={setExact} />
      {rules.map((r) => (
        <Box key={r.name} title={`${r.ok ? '✓ coincide' : '· no coincide'} — regla ${r.name}`} ok={r.ok ? true : undefined}>
          <Mono color={colors.dim}>{r.pat}</Mono>
          <T v="tiny" color={r.ok ? colors.green : colors.dim}>{r.ok ? `→ entrega a ${r.to}` : `no entrega a ${r.to}`}</T>
        </Box>
      ))}
      <Explain k={`${i}${min}${exact}`} title={`${rules.filter((r) => r.ok).length} regla(s) reciben el evento`} color={a}>
        EventBridge evalúa el evento contra todas las reglas del bus a la vez: puede coincidir con varias (fan-out) o con ninguna (el evento se descarta). Cada regla tiene sus destinos, y cada destino necesita permiso (política de la cola o de la función que admita a events.amazonaws.com).
      </Explain>
    </Frame>
  );
}

// ───────────────────────── Cognito: del registro al token y a la API ─────────────────────────

type Step = 'signup' | 'login' | 'api';

export function CognitoFlow() {
  const [step, setStep] = useState<Step>('signup');
  const [flow, setFlow] = useState(true);
  const [confirmed, setConfirmed] = useState(true);
  const [expired, setExpired] = useState(false);
  const [aud, setAud] = useState(true);
  const { a } = awsHue();
  const loginErr = !flow ? 'InvalidParameterException: USER_PASSWORD_AUTH flow not enabled for this client' : !confirmed ? 'UserNotConfirmedException: User is not confirmed.' : '';
  const apiErr = loginErr ? 'No hay token: antes hay que iniciar sesión.' : expired ? '401 Unauthorized — el token ha caducado (exp en el pasado). Renueva con el refresh token.' : !aud ? '401 Unauthorized — la audiencia del autorizador no es el client id del token.' : '';
  return (
    <Frame>
      <Tabs color={a} value={step} onChange={setStep} items={[{ id: 'signup', label: '1 · Registro' }, { id: 'login', label: '2 · Inicio de sesión' }, { id: 'api', label: '3 · Llamar a la API' }]} />
      {step === 'signup' ? (
        <View style={{ gap: 6 }}>
          <Toggle label="La usuaria confirma el código del correo (confirm-sign-up)" on={confirmed} set={setConfirmed} good="on" />
          <Box title="sign-up → UNCONFIRMED" ok={undefined}>
            <Mono>aws cognito-idp sign-up --client-id … --username ana@tienda.es --password …</Mono>
          </Box>
          <Box title={confirmed ? 'confirm-sign-up → CONFIRMED' : '⏳ sigue UNCONFIRMED'} ok={confirmed}>
            <Mono>código recibido por correo (en el simulador: 123456)</Mono>
          </Box>
        </View>
      ) : null}
      {step === 'login' ? (
        <View style={{ gap: 6 }}>
          <Toggle label="El cliente tiene ALLOW_USER_PASSWORD_AUTH" on={flow} set={setFlow} good="on" hint="No viene activado por defecto" />
          <Box title={loginErr ? '✖ initiate-auth' : '✓ initiate-auth'} ok={!loginErr}>
            <Mono color={loginErr ? colors.rose : colors.text}>{loginErr || 'IdToken (quién eres) · AccessToken (qué puedes hacer) · RefreshToken (30 días)'}</Mono>
          </Box>
        </View>
      ) : null}
      {step === 'api' ? (
        <View style={{ gap: 6 }}>
          <Toggle label="El token ha caducado (dura 1 hora)" on={expired} set={setExpired} good="off" />
          <Toggle label="La audiencia del autorizador es el client id" on={aud} set={setAud} good="on" />
          <Box title="Authorization: Bearer <IdToken>" ok={!apiErr}>
            <Mono color={apiErr ? colors.rose : colors.text}>{apiErr || '200 — API Gateway comprobó firma, emisor (iss), audiencia (aud) y caducidad (exp) sin llamar a Cognito'}</Mono>
          </Box>
        </View>
      ) : null}
      <Explain k={`${step}${flow}${confirmed}${expired}${aud}`} title="Dos preguntas distintas" color={a}>
        Autenticación (¿quién eres?) la resuelve Cognito con el grupo de usuarios y te da JWT. Autorización (¿qué puedes hacer?) la decides tú: con los grupos del token (cognito:groups), con los claims en tu función o con roles de IAM (grupo de identidades). API Gateway solo comprueba el token; el resto es cosa de tu código.
      </Explain>
    </Frame>
  );
}
