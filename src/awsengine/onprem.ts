/** La red de la «oficina» del alumno, al otro lado de las VPN y de Direct Connect. */
import type { VpnConnection } from './types';

/** Lo que anuncia por BGP el router de la oficina (para los ejemplos). */
export const ON_PREM_CIDR = '192.168.0.0/16';

/** Rutas que la VPN trae a AWS: las estáticas que declaraste o, si es dinámica (BGP), las que anuncia el router. */
export const vpnRoutes = (v: VpnConnection): string[] => (v.StaticRoutesOnly ? v.routes : [ON_PREM_CIDR, ...v.routes]);
