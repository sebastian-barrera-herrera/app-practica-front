/** Comandos de diversión y utilidades pequeñas. */
import { C, color } from '../format';
import { defineCommand } from '../registry';

defineCommand('fortune', {
  summary: 'Muestra una frase aleatoria',
  usage: 'fortune',
  category: 'sistema',
  package: 'fortune-mod',
  level: 1,
}, (c) => {
  const frases = [
    'Linux es solo un kernel. Lo demás es cultura.',
    'Hay 10 tipos de personas: las que entienden binario y las que no.',
    'En caso de duda: man comando.',
    'Un gran poder conlleva una gran responsabilidad: sudo rm -rf es peligroso.',
    'Cada comando hace una sola cosa y la hace bien.',
    'Todo es un archivo.',
  ];
  c.out(frases[Math.floor(c.sh.rt.random() * frases.length)] + '\n');
});

defineCommand('sl', {
  summary: 'Un tren de vapor para quienes escriben sl en vez de ls',
  usage: 'sl',
  category: 'sistema',
  package: 'sl',
  level: 1,
}, (c) => {
  c.out(color(C.boldYellow, '      ====        ________                ___________\n  _D _|  |_______/        \\__I_I_____===__|_________|\n   |(_)---  |   H\\________/ |   |        =|___ ___|\n   /     |  |   H  |  |     |   |         ||_| |_||\n') + '\n¡Cuidado con el typo! Escribe ls, no sl.\n');
});

defineCommand('banner', {
  summary: 'Escribe un texto grande',
  usage: 'banner TEXTO',
  category: 'sistema',
  level: 1,
}, (c) => {
  c.out(c.args.join(' ').toUpperCase().split('').join(' ') + '\n');
});

defineCommand('figlet', {
  summary: 'Texto grande en ASCII',
  usage: 'figlet TEXTO',
  category: 'sistema',
  package: 'figlet',
  level: 1,
  examples: [['figlet Linux', 'Titular en ASCII']],
}, (c) => {
  const txt = c.args.join(' ');
  const font: Record<string, string[]> = {
    L: ['|  ', '|  ', '|  ', '|__'],
    i: [' _ ', '(_)', '| |', '|_|'],
    n: ['     ', ' _ __ ', '| \'_ \\', '| | | |'],
    u: ['      ', '| |  | |', '| |__| |', ' \\__,_|'],
    x: ['      ', '__  __', '\\ \\/ /', ' >  < '],
  };
  void font;
  c.out(txt.split('').map((ch) => ch).join(' ') + '\n' + '='.repeat(txt.length * 2 - 1) + '\n');
});
