import React, { useState } from 'react';
import { View } from 'react-native';
import { colors } from '@/ui/theme';
import { Tabs } from './pyui';
import { Frame } from './common';
import { Explain, Note, SqlTable, sqlHue } from './sqlui';

// ───────────────────────── anatomía de una tabla ─────────────────────────

type Part = 'tabla' | 'columna' | 'fila' | 'celda' | 'clave' | 'null';

const COLS = [{ name: 'id', pk: true }, { name: 'nombre' }, { name: 'ciudad' }, { name: 'vip' }];
const ROWS: (string | number | null | boolean)[][] = [
  [1, 'Ana García', 'Madrid', true],
  [2, 'Luis Martín', 'Sevilla', false],
  [3, 'Pablo Ruiz', null, false],
  [4, 'Lucía Fernández', 'Barcelona', true],
];

const INFO: Record<Part, { title: string; color: () => string; text: string }> = {
  tabla: { title: 'Tabla', color: () => colors.cyan, text: 'Un conjunto de datos sobre UN mismo tipo de cosa. Esta se llama «clientes»: aquí no hay pedidos ni productos, solo clientes.' },
  columna: { title: 'Columna', color: () => colors.mint, text: 'Una propiedad que tienen todos los elementos: «nombre», «ciudad»… Cada columna tiene un tipo de dato (texto, número, fecha…) y todos sus valores son de ese tipo.' },
  fila: { title: 'Fila (o registro)', color: () => colors.amber, text: 'Un elemento concreto. Esta fila es Luis Martín, de Sevilla. Una tabla con 4 filas tiene 4 clientes.' },
  celda: { title: 'Celda', color: () => colors.violet, text: 'El cruce de una fila y una columna: un solo dato. La ciudad de Luis es «Sevilla».' },
  clave: { title: 'Clave primaria 🔑', color: () => colors.rose, text: 'La columna que identifica cada fila sin confusión: no puede repetirse ni estar vacía. Por eso dos clientes pueden llamarse igual pero nunca tendrán el mismo id.' },
  null: { title: 'NULL', color: () => colors.dim, text: 'Significa «no hay valor / no se sabe». Pablo no tiene ciudad registrada. NULL no es cero ni un texto vacío: es la ausencia de dato.' },
};

export function TableAnatomy() {
  const [part, setPart] = useState<Part>('tabla');
  const info = INFO[part];
  const c = info.color();
  return (
    <Frame>
      <SqlTable
        name="clientes"
        cols={COLS}
        rows={ROWS}
        color={c}
        hiCols={part === 'columna' ? [1] : part === 'clave' ? [0] : []}
        hiRows={part === 'fila' ? [1] : part === 'tabla' ? [0, 1, 2, 3] : []}
        hiCells={part === 'celda' ? ['1,2'] : part === 'null' ? ['2,2'] : []}
        onName={() => setPart('tabla')}
        onCol={(ci) => setPart(ci === 0 ? 'clave' : 'columna')}
        onRow={() => setPart('fila')}
        onCell={(r, ci) => setPart(ROWS[r][ci] === null ? 'null' : ci === 0 ? 'clave' : 'celda')}
      />
      <Tabs
        color={sqlHue().a}
        value={part}
        onChange={setPart}
        items={[
          { id: 'tabla', label: 'tabla' },
          { id: 'columna', label: 'columna' },
          { id: 'fila', label: 'fila' },
          { id: 'celda', label: 'celda' },
          { id: 'clave', label: 'clave primaria' },
          { id: 'null', label: 'NULL' },
        ]}
      />
      <Explain k={part} title={info.title} color={c}>{info.text}</Explain>
      <View>
        <Note min={40}>Toca una parte de la tabla o elige una etiqueta para verla resaltada.</Note>
      </View>
    </Frame>
  );
}
