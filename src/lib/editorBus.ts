/** Puente entre el motor (nano/vim) y el modal de edición de la interfaz. */
export type EditorRequest = { path: string; content: string; name: string; resolve: (v: string | null) => void };

let handler: ((req: EditorRequest) => void) | null = null;

export function registerEditorHost(fn: ((req: EditorRequest) => void) | null) {
  handler = fn;
}

export function openEditor(path: string, content: string, name: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!handler) {
      resolve(null);
      return;
    }
    handler({ path, content, name, resolve });
  });
}
