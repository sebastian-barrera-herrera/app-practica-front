import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { tap } from '@/lib/haptics';
import { T } from '@/ui/Text';
import { colors } from '@/ui/theme';
import { Frame } from './common';
import { Tabs } from './pyui';
import { Explain, Layer, Note, Pill, Zone, awsHue } from './awsui';

// ───────────────────────── IaaS / PaaS / SaaS ─────────────────────────

type Model = 'local' | 'iaas' | 'paas' | 'saas';

const LAYERS = ['Aplicación', 'Datos', 'Entorno de ejecución', 'Sistema operativo', 'Virtualización', 'Servidores', 'Almacenamiento', 'Redes'];
/** Cuántas capas (desde arriba) gestiona el cliente en cada modelo. */
const YOURS: Record<Model, number> = { local: 8, iaas: 4, paas: 2, saas: 0 };
const MODEL_INFO: Record<Model, { title: string; text: string; ex: string }> = {
  local: { title: 'Centro de datos propio', text: 'Lo compras, lo instalas y lo mantienes todo tú, de los cables a la aplicación.', ex: 'Tu sala de servidores' },
  iaas: { title: 'IaaS · Infraestructura como servicio', text: 'El proveedor pone el hardware y la virtualización. Tú pones el sistema operativo, lo que ejecuta y tus datos.', ex: 'Amazon EC2' },
  paas: { title: 'PaaS · Plataforma como servicio', text: 'El proveedor gestiona también el sistema y el entorno de ejecución. Tú solo subes tu código y gestionas tus datos.', ex: 'Elastic Beanstalk · AWS Lambda' },
  saas: { title: 'SaaS · Software como servicio', text: 'Te dan el programa terminado. Solo lo usas (y gestionas tus usuarios y tus datos dentro de él).', ex: 'Gmail · Microsoft 365' },
};

export function ServiceModels() {
  const [m, setM] = useState<Model>('iaas');
  const { a } = awsHue();
  const mine = YOURS[m];
  const info = MODEL_INFO[m];
  return (
    <Frame>
      <View style={{ gap: 4 }}>
        {LAYERS.map((l, i) => {
          const you = i < mine;
          const c = you ? colors.mint : colors.violet;
          return <Layer key={l} label={l} owner={you ? 'TÚ' : 'PROVEEDOR'} color={c} />;
        })}
      </View>
      <Tabs
        color={a}
        value={m}
        onChange={setM}
        items={[
          { id: 'local', label: 'propio' },
          { id: 'iaas', label: 'IaaS' },
          { id: 'paas', label: 'PaaS' },
          { id: 'saas', label: 'SaaS' },
        ]}
      />
      <Explain k={m} title={info.title} color={a}>
        {info.text} Ejemplo: <T v="small" bold color={colors.text}>{info.ex}</T>.
      </Explain>
    </Frame>
  );
}

// ───────────────────────── regiones, zonas y bordes ─────────────────────────

type Level = 'region' | 'az' | 'edge';

const LEVEL_INFO: Record<Level, { title: string; text: string }> = {
  region: { title: 'Región', text: 'Una zona geográfica con varias zonas de disponibilidad (eu-west-1 = Irlanda). Es independiente de las demás regiones: sus recursos no se ven desde otra región.' },
  az: { title: 'Zona de disponibilidad', text: 'Centros de datos aislados con energía, red y refrigeración propias, a decenas de km unos de otros y unidos por fibra muy rápida. Prueba a «apagar» una zona: las otras siguen atendiendo.' },
  edge: { title: 'Edge location', text: 'Nodos cercanos al usuario que guardan copias de tu contenido (CloudFront) y resuelven DNS. No son para ejecutar tus servidores.' },
};

function DataCenter({ on }: { on: boolean }) {
  return <View style={{ width: 16, height: 20, borderRadius: 3, backgroundColor: on ? colors.mint : colors.faint, opacity: on ? 1 : 0.4 }} />;
}

export function GlobalInfra() {
  const [lv, setLv] = useState<Level>('az');
  const [down, setDown] = useState<number | null>(null);
  const { a, b } = awsHue();
  const info = LEVEL_INFO[lv];
  const zones = ['eu-west-1a', 'eu-west-1b', 'eu-west-1c'];
  const alive = zones.filter((_z, i) => i !== down).length;
  return (
    <Frame>
      <Zone title="Región · eu-west-1 (Irlanda)" color={lv === 'region' ? b : a}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {zones.map((z, i) => (
            <Pressable key={z} onPress={() => { tap(); setLv('az'); setDown(down === i ? null : i); }} style={{ flex: 1 }}>
              <Zone title={z.replace('eu-west-1', 'AZ ')} color={down === i ? colors.rose : lv === 'az' ? b : a} dim={down === i} dashed>
                <View style={{ flexDirection: 'row', gap: 4, justifyContent: 'center' }}>
                  <DataCenter on={down !== i} />
                  <DataCenter on={down !== i} />
                </View>
                <T v="tiny" center color={down === i ? colors.rose : colors.mint}>{down === i ? '¡caída!' : 'activa'}</T>
              </Zone>
            </Pressable>
          ))}
        </View>
        <T v="tiny" color={colors.dim}>Tu web repartida en las 3 zonas: {alive === 3 ? 'todo en marcha' : `sigue viva con ${alive} de 3 zonas`}.</T>
      </Zone>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <T v="tiny" color={colors.dim}>Edge locations:</T>
        {['Madrid', 'París', 'Lima', 'Tokio', 'Lagos', 'Sídney'].map((c) => (
          <Pill key={c} text={`📡 ${c}`} color={lv === 'edge' ? b : colors.cyan} size={11} />
        ))}
      </View>
      <Tabs
        color={a}
        value={lv}
        onChange={(v) => { setLv(v); if (v !== 'az') setDown(null); }}
        items={[
          { id: 'region', label: 'región' },
          { id: 'az', label: 'zona (AZ)' },
          { id: 'edge', label: 'edge' },
        ]}
      />
      <Explain k={lv} title={info.title} color={a}>{info.text}</Explain>
    </Frame>
  );
}

// ───────────────────────── responsabilidad compartida ─────────────────────────

type Svc = 'ec2' | 'rds' | 's3' | 'lambda';
const ROWS = ['Datos y su cifrado', 'Permisos y accesos (IAM)', 'Tu aplicación o código', 'Sistema operativo y parches', 'Motor / entorno de ejecución', 'Virtualización y hardware', 'Red global y centros de datos'];
const OWNER: Record<Svc, ('you' | 'aws' | 'na')[]> = {
  ec2: ['you', 'you', 'you', 'you', 'you', 'aws', 'aws'],
  rds: ['you', 'you', 'you', 'aws', 'aws', 'aws', 'aws'],
  s3: ['you', 'you', 'na', 'aws', 'aws', 'aws', 'aws'],
  lambda: ['you', 'you', 'you', 'aws', 'aws', 'aws', 'aws'],
};
const SVC_TEXT: Record<Svc, string> = {
  ec2: 'EC2 es IaaS: te dan la máquina virtual y tú te ocupas de todo lo que hay dentro, incluido el sistema operativo y sus parches.',
  rds: 'RDS gestiona el sistema y el motor de base de datos (parches incluidos). Tú: datos, usuarios, configuración y quién puede conectarse.',
  s3: 'S3 es un servicio gestionado de almacenamiento: no hay servidor que parchear. Tuyo: qué guardas, quién lo lee (permisos, política del bucket) y el cifrado.',
  lambda: 'Con Lambda ni siquiera ves el servidor: tú escribes el código y sus permisos; AWS gestiona todo lo demás.',
};

export function SharedResponsibility() {
  const [s, setS] = useState<Svc>('ec2');
  const { a } = awsHue();
  return (
    <Frame>
      <View style={{ gap: 4 }}>
        {ROWS.map((r, i) => {
          const o = OWNER[s][i];
          return <Layer key={r} label={r} owner={o === 'you' ? 'TÚ' : o === 'aws' ? 'AWS' : '—'} color={o === 'you' ? colors.mint : o === 'aws' ? colors.violet : colors.faint} />;
        })}
      </View>
      <Tabs
        color={a}
        value={s}
        onChange={setS}
        items={[
          { id: 'ec2', label: 'EC2' },
          { id: 'rds', label: 'RDS' },
          { id: 's3', label: 'S3' },
          { id: 'lambda', label: 'Lambda' },
        ]}
      />
      <Explain k={s} title={s.toUpperCase()} color={a}>{SVC_TEXT[s]}</Explain>
      <Note min={30}>Cuanto más gestionado es el servicio, menos filas son tuyas. Los datos y los permisos son siempre tuyos.</Note>
    </Frame>
  );
}
