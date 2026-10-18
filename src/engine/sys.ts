/**
 * Estado "del sistema" simulado: usuarios, grupos, procesos, servicios,
 * paquetes, red y reloj virtual. Todo en memoria y determinista.
 */
import type { Clock, Cred } from './vfs';

export interface UserEntry {
  name: string;
  uid: number;
  gid: number;
  gecos: string;
  home: string;
  shell: string;
  locked?: boolean;
  /** Caducidad de contraseña (chage). Fechas en ms; -1 = sin límite. */
  aging?: { lastChange?: number; min?: number; max?: number; warn?: number; inactive?: number; expire?: number };
}

export interface GroupEntry {
  name: string;
  gid: number;
  members: Set<string>;
}

export interface Proc {
  pid: number;
  ppid: number;
  user: string;
  command: string; // línea completa como la muestra ps
  state: string; // S R T Z D
  start: number; // ms virtuales
  cpu: number; // % cpu
  mem: number; // % memoria
  rss: number; // KB
  vsz: number; // KB
  tty: string;
  nice: number;
  /** Segundos de CPU acumulados */
  time: number;
}

export interface ServiceEntry {
  name: string;
  description: string;
  state: 'active' | 'inactive' | 'failed';
  enabled: boolean;
  pid?: number;
  port?: number;
  package?: string;
  since: number;
}

export interface PackageEntry {
  name: string;
  version: string;
  description: string;
  installed: boolean;
  sizeKb: number;
  deps?: string[];
  autoInstalled?: boolean;
}

export interface HostEntry {
  name: string;
  ip: string;
  up: boolean;
  latency: number; // ms
  ports: number[];
}

export class System {
  clock: Clock;
  hostname = 'dojo';
  bootTime: number;
  users = new Map<string, UserEntry>();
  groups = new Map<string, GroupEntry>();
  procs = new Map<number, Proc>();
  services = new Map<string, ServiceEntry>();
  packages = new Map<string, PackageEntry>();
  hosts = new Map<string, HostEntry>();
  crontabs = new Map<string, string>();
  nextPid = 2000;
  nextUid = 1003;
  nextGid = 1004;
  aptUpdated = false;
  ipAddr = '192.168.1.50';
  gateway = '192.168.1.1';
  mac = '02:42:ac:11:00:02';
  /** Comandos ejecutados por el alumno (registro global para comprobaciones) */
  commandLog: string[] = [];
  /** Mundos remotos creados bajo demanda (ssh/scp). */
  remotes = new Map<string, any>();
  ufwRules: string[] = [];
  ufwEnabled = false;

  constructor(clock: Clock) {
    this.clock = clock;
    this.bootTime = clock.now - (3 * 86400000 + 4 * 3600000 + 17 * 60000);
  }

  // ───────────── usuarios ─────────────

  user(name: string): UserEntry | undefined {
    return this.users.get(name);
  }

  userByUid(uid: number): UserEntry | undefined {
    for (const u of this.users.values()) if (u.uid === uid) return u;
    return undefined;
  }

  groupsOf(name: string): string[] {
    const u = this.users.get(name);
    const out: string[] = [];
    if (u) {
      const prim = [...this.groups.values()].find((g) => g.gid === u.gid);
      if (prim) out.push(prim.name);
    }
    for (const g of this.groups.values()) {
      if (g.members.has(name) && !out.includes(g.name)) out.push(g.name);
    }
    return out;
  }

  cred(name: string): Cred {
    return { name, groups: this.groupsOf(name) };
  }

  isSudoer(name: string): boolean {
    if (name === 'root') return true;
    return this.groups.get('sudo')?.members.has(name) ?? false;
  }

  addUser(name: string, opts: Partial<UserEntry> = {}): UserEntry {
    const uid = opts.uid ?? this.nextUid++;
    let gid = opts.gid;
    if (gid === undefined) {
      const g = this.groups.get(name);
      if (g) gid = g.gid;
      else {
        gid = this.nextGid++;
        this.groups.set(name, { name, gid, members: new Set() });
      }
    }
    const u: UserEntry = {
      name,
      uid,
      gid,
      gecos: opts.gecos ?? '',
      home: opts.home ?? '/home/' + name,
      shell: opts.shell ?? '/bin/bash',
    };
    this.users.set(name, u);
    return u;
  }

  addGroup(name: string, members: string[] = [], gid?: number): GroupEntry {
    const g: GroupEntry = { name, gid: gid ?? this.nextGid++, members: new Set(members) };
    this.groups.set(name, g);
    return g;
  }

  // ───────────── procesos ─────────────

  spawn(user: string, command: string, opts: Partial<Proc> = {}): Proc {
    const pid = opts.pid ?? this.nextPid++;
    const p: Proc = {
      pid,
      ppid: opts.ppid ?? 1,
      user,
      command,
      state: opts.state ?? 'S',
      start: opts.start ?? this.clock.now,
      cpu: opts.cpu ?? 0,
      mem: opts.mem ?? 0.1,
      rss: opts.rss ?? 1200 + (pid % 50) * 40,
      vsz: opts.vsz ?? 12000 + (pid % 70) * 100,
      tty: opts.tty ?? '?',
      nice: opts.nice ?? 0,
      time: opts.time ?? 0,
    };
    this.procs.set(pid, p);
    return p;
  }

  killProc(pid: number): boolean {
    return this.procs.delete(pid);
  }

  // ───────────── servicios / paquetes ─────────────

  pkgInstalled(name: string): boolean {
    return this.packages.get(name)?.installed ?? false;
  }

  /** Puertos TCP en escucha derivados de los servicios activos. */
  listening(): { proto: string; addr: string; port: number; proc: string; pid: number; user: string }[] {
    const out: { proto: string; addr: string; port: number; proc: string; pid: number; user: string }[] = [
      { proto: 'tcp', addr: '127.0.0.53', port: 53, proc: 'systemd-resolve', pid: 455, user: 'systemd-resolve' },
    ];
    for (const s of this.services.values()) {
      if (s.state === 'active' && s.port) {
        out.push({
          proto: 'tcp',
          addr: '0.0.0.0',
          port: s.port,
          proc: s.name === 'ssh' ? 'sshd' : s.name,
          pid: s.pid ?? 0,
          user: 'root',
        });
      }
    }
    return out;
  }

  /** Avanza el reloj virtual y devuelve los ms avanzados. */
  advance(seconds: number): void {
    this.clock.now += Math.round(seconds * 1000);
  }
}

export const START_TIME = Date.UTC(2026, 2, 14, 10, 0, 0); // sáb 14 mar 2026 10:00 UTC
