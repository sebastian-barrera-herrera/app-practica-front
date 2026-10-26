import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors, fonts, radius } from '@/ui/theme';
import { Frame } from './common';
import { Tabs } from './pyui';
import { Explain, Note, Pill, Toggle, awsHue } from './awsui';

// ───────────────────────── ¿qué base de datos? ─────────────────────────

type Need = 'sql' | 'kv' | 'cache' | 'olap' | 'graph' | 'doc' | 'ts';

const NEEDS: Record<Need, { label: string; service: string; why: string; avoid: string; color: () => string }> = {
  sql: { label: 'Tablas y uniones', service: 'RDS / Aurora', why: 'Consultas variadas con JOIN, transacciones entre tablas e integridad referencial. MySQL, PostgreSQL, MariaDB, Oracle, SQL Server.', avoid: 'Escala de millones de peticiones/s por clave: mejor DynamoDB.', color: () => colors.cyan },
  kv: { label: 'Clave-valor a escala', service: 'DynamoDB', why: 'Acceso por clave con latencia de milisegundos a cualquier escala, sin servidores. Carritos, perfiles, sesiones, catálogos.', avoid: 'Consultas imprevistas, uniones y agregaciones.', color: () => colors.green },
  cache: { label: 'Caché en memoria', service: 'ElastiCache', why: 'Latencia de microsegundos (Redis/Valkey, Memcached). Alivia la base de datos, guarda sesiones y rankings.', avoid: 'Como única copia de datos importantes (puede perderse).', color: () => colors.amber },
  olap: { label: 'Analítica de petabytes', service: 'Redshift', why: 'Almacén de datos columnar: informes y cuadros de mando sobre años de histórico con SQL.', avoid: 'Operaciones transaccionales del día a día (OLTP).', color: () => colors.violet },
  graph: { label: 'Grafo de relaciones', service: 'Neptune', why: 'Recorrer conexiones profundas: amigos de amigos, recomendaciones, detección de fraude.', avoid: 'Datos tabulares sin relaciones profundas.', color: () => colors.rose },
  doc: { label: 'Documentos tipo MongoDB', service: 'DocumentDB', why: 'Documentos JSON con la API de MongoDB: migrar aplicaciones existentes sin reescribirlas.', avoid: 'Proyectos nuevos sin dependencia de MongoDB: DynamoDB es más simple.', color: () => colors.mint },
  ts: { label: 'Series temporales', service: 'Timestream', why: 'Métricas e IoT: millones de puntos por segundo y consultas por intervalos de tiempo.', avoid: 'Datos que no son series de tiempo.', color: () => colors.cyan },
};

export function DbChooser() {
  const [n, setN] = useState<Need>('kv');
  const { a } = awsHue();
  const info = NEEDS[n];
  const c = info.color();
  return (
    <Frame>
      <T v="label" color={colors.dim}>¿Qué necesita tu aplicación?</T>
      <Tabs color={a} value={n} onChange={setN} items={(Object.keys(NEEDS) as Need[]).map((k) => ({ id: k, label: NEEDS[k].label }))} />
      <Animated.View key={n} entering={FadeIn.duration(200)} style={{ borderWidth: 2, borderColor: c, borderRadius: radius.md, padding: 12, backgroundColor: c + '1F', gap: 6 }}>
        <T style={{ fontFamily: fonts.monoBold, fontSize: 16 }} color={c}>{info.service}</T>
        <T v="small" color={colors.text}>{info.why}</T>
        <T v="small" color={colors.dim}>✋ Evítalo para: {info.avoid}</T>
      </Animated.View>
      <Note min={30}>Elige por cómo vas a consultar los datos, no por moda.</Note>
    </Frame>
  );
}

// ───────────────────────── Multi-AZ y réplicas ─────────────────────────

export function MultiAz() {
  const [multi, setMulti] = useState(true);
  const [replica, setReplica] = useState(false);
  const [down, setDown] = useState(false);
  const { a } = awsHue();
  const zone = (name: string, items: { label: string; sub: string; color: string; dead?: boolean }[], dead: boolean) => (
    <View style={{ flex: 1, gap: 6, padding: 8, borderRadius: radius.sm, borderWidth: 1.5, borderStyle: 'dashed', borderColor: dead ? colors.rose : colors.line, backgroundColor: dead ? colors.rose + '12' : 'transparent' }}>
      <T v="tiny" color={dead ? colors.rose : colors.dim}>{name}{dead ? ' · caída 💥' : ''}</T>
      {items.map((it) => (
        <View key={it.label} style={{ padding: 8, borderRadius: radius.sm, borderWidth: 1.5, borderColor: it.dead ? colors.rose : it.color, backgroundColor: (it.dead ? colors.rose : it.color) + '22', opacity: it.dead ? 0.55 : 1 }}>
          <T style={{ fontFamily: fonts.monoBold, fontSize: 12 }} color={colors.text}>{it.dead ? '✖ ' : ''}{it.label}</T>
          <T v="tiny" color={colors.dim}>{it.sub}</T>
        </View>
      ))}
    </View>
  );
  const zoneA = [{ label: 'Principal', sub: 'lee y escribe', color: colors.green, dead: down }];
  const zoneB: { label: string; sub: string; color: string; dead?: boolean }[] = [];
  if (multi) zoneB.push({ label: down ? 'Nueva principal' : 'Copia en espera', sub: down ? 'tras la conmutación' : 'síncrona · no se lee', color: down ? colors.green : colors.amber });
  if (replica) zoneB.push({ label: 'Réplica de lectura', sub: 'asíncrona · sirve SELECT', color: colors.cyan });
  let result: { text: string; color: string };
  if (!down) result = { text: multi ? 'Todo funciona. La copia en espera se actualiza a la vez que la principal, por eso nunca pierde datos confirmados.' : 'Todo funciona, pero hay un único servidor: no hay red de seguridad.', color: colors.green };
  else if (multi) result = { text: 'RDS conmuta solo a la copia en espera en 1–2 minutos. El endpoint no cambia: la aplicación se reconecta sin tocar nada.', color: colors.green };
  else if (replica) result = { text: 'Las escrituras fallan. La réplica sigue sirviendo lecturas, pero hay que promoverla a mano (puede perder los últimos datos: es asíncrona).', color: colors.amber };
  else result = { text: 'Caída total hasta que restaures una copia de seguridad en otra zona.', color: colors.rose };
  return (
    <Frame>
      <Toggle label="Multi-AZ (copia en espera síncrona)" on={multi} set={setMulti} />
      <Toggle label="Réplica de lectura (asíncrona)" on={replica} set={setReplica} />
      <Pressable accessibilityRole="button" accessibilityLabel={down ? 'Restablecer la zona' : 'Provocar la caída de la zona A'} onPress={() => { tap(); setDown(!down); }} style={{ minHeight: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: down ? colors.green : colors.rose }}>
        <T bold color="#0B0B14">{down ? '↺ Restablecer la zona A' : '💥 Provocar la caída de la zona A'}</T>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {zone('Zona A', zoneA, down)}
        {zone('Zona B', zoneB, false)}
      </View>
      <Explain k={`${multi}${replica}${down}`} title={down ? 'Qué pasa ahora' : 'Estado actual'} color={result.color}>{result.text}</Explain>
      <Pill text={multi ? 'Multi-AZ: cuesta el doble' : 'Instancia única'} color={a} />
    </Frame>
  );
}

// ───────────────────────── particiones de DynamoDB ─────────────────────────

type Pk = 'cliente' | 'pais' | 'dia';

const LOAD: Record<Pk, { label: string; parts: number[]; text: string; good: boolean }> = {
  cliente: { label: 'cliente', parts: [24, 26, 25, 25], text: 'Muchos valores distintos: la función hash reparte los elementos de forma pareja entre las particiones.', good: true },
  pais: { label: 'país', parts: [70, 20, 8, 2], text: 'Pocos valores y muy desiguales: una partición recibe casi todo el tráfico («partición caliente»).', good: false },
  dia: { label: 'día actual', parts: [100, 0, 0, 0], text: 'Todas las escrituras de hoy tienen el mismo valor: una única partición se satura mientras las demás duermen.', good: false },
};

export function DdbPartition() {
  const [pk, setPk] = useState<Pk>('cliente');
  const [mode, setMode] = useState<'query' | 'scan'>('query');
  const { a } = awsHue();
  const info = LOAD[pk];
  const max = Math.max(...info.parts, 1);
  return (
    <Frame>
      <T v="label" color={colors.dim}>Clave de partición de la tabla</T>
      <Tabs color={a} value={pk} onChange={setPk} items={(Object.keys(LOAD) as Pk[]).map((k) => ({ id: k, label: LOAD[k].label }))} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 110 }}>
        {info.parts.map((n, i) => {
          const touched = mode === 'scan' || i === 0;
          const c = info.good ? colors.green : n === max && n > 40 ? colors.rose : colors.cyan;
          return (
            <View key={i} style={{ flex: 1, alignItems: 'center', gap: 4, justifyContent: 'flex-end', height: '100%' }}>
              <T style={{ fontFamily: fonts.mono, fontSize: 11 }} color={colors.dim}>{n} %</T>
              <View style={{ width: '100%', height: `${Math.max(4, (n / max) * 70)}%`, backgroundColor: c, borderRadius: 6, borderWidth: touched ? 2 : 0, borderColor: colors.text, opacity: touched ? 1 : 0.35 }} />
              <T v="tiny" color={colors.dim}>P{i + 1}</T>
            </View>
          );
        })}
      </View>
      <Tabs color={a} value={mode} onChange={setMode} items={[{ id: 'query', label: 'Query (una clave)' }, { id: 'scan', label: 'Scan (toda la tabla)' }]} />
      <Explain k={`${pk}${mode}`} title={mode === 'query' ? 'Query: lee solo una partición' : 'Scan: lee TODAS las particiones'} color={mode === 'query' ? colors.green : colors.amber}>
        {info.text} {mode === 'query' ? 'Una consulta por clave va directa a la partición que le toca.' : 'El Scan recorre todo y filtra después: cuanto más crece la tabla, más cuesta.'}
      </Explain>
    </Frame>
  );
}
