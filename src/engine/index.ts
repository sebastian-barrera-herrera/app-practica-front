export { Terminal, restoreTerminal } from './terminal';
export type { Chunk, RunRecord, TerminalOptions } from './terminal';
export { createWorld, applyFiles, LAB_FILES } from './world';
export type { Files, FileSpec, WorldOptions, World } from './world';
export { REGISTRY } from './registry';
export type { CommandDef, Category } from './registry';
export { stripAnsi } from './format';
export { parseAnsi } from './ansi';
export * from './check';
