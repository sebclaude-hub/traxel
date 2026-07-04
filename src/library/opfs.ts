// ---------------------------------------------------------------------------
// Gemeinsamer OPFS-Zugriff (Origin Private File System).
//
// Eine Quelle fuer das Verzeichnis-Handling aller OPFS-Nutzer (DEM-Kachel-
// Cache, Satelliten-Cache, Track- und Chart-Bibliothek) — vorher viermal
// identisch kopiert.
//
// Steht OPFS nicht zur Verfuegung (z.B. Node/Tests), liefert opfsDirectory
// null; die Aufrufer arbeiten dann als No-Op.
// ---------------------------------------------------------------------------

/** Handle auf ein OPFS-Unterverzeichnis (wird angelegt); null ohne OPFS. */
export async function opfsDirectory(
  name: string,
): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined") return null;
  const storage = navigator.storage as
    | (StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> })
    | undefined;
  if (!storage?.getDirectory) return null;
  try {
    const root = await storage.getDirectory();
    return await root.getDirectoryHandle(name, { create: true });
  } catch {
    return null;
  }
}
