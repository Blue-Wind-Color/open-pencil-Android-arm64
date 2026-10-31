import { describeDiagnosticError, recordDocumentFailure } from '@/app/diagnostics'
import { storageLocationOf } from '@/app/integrations/storage/location'
import type { StorageDocumentBinding } from '@/app/integrations/storage/types'
import { persistStorageCanvasLocally } from '@/app/storage/sync/persist'
import { isAndroid, isTauri } from '@/app/tauri/env'

type WriteDocumentState = { documentName: string }

/**
 * Writes a saved document into a file the user picked with the system "save as" sheet.
 *
 * That picker hands back a `content://` URI, and the fs plugin resolves paths with
 * `std::fs`, which cannot open one. The webview stages the bytes in the cache directory
 * and the platform copies them through its ContentResolver — sending a multi-megabyte
 * design file over IPC would be slow and memory-hungry on a tablet.
 */
async function writeToAndroidDocument(uri: string, data: Uint8Array): Promise<void> {
  const [{ invoke }, { writeFile, remove, BaseDirectory }, { appCacheDir }] = await Promise.all([
    import('@tauri-apps/api/core'),
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path')
  ])

  const name = `openpencil-save-${Date.now()}.fig`
  await writeFile(name, data, { baseDir: BaseDirectory.Cache })
  try {
    await invoke('write_content_uri', {
      uri,
      sourcePath: `${await appCacheDir()}/${name}`
    })
  } finally {
    await remove(name, { baseDir: BaseDirectory.Cache }).catch(() => undefined)
  }
}

type DocumentWriterOptions = {
  state: WriteDocumentState
  getFilePath: () => string | null
  getFileHandle: () => FileSystemFileHandle | null
  getStorageBinding: () => StorageDocumentBinding | null
  setSavedVersion: (version: number) => void
  setLastWriteTime: (time: number) => void
  onWriteSuccess?: (version: number) => void | Promise<void>
}

export function createDocumentWriter({
  state,
  getFilePath,
  getFileHandle,
  getStorageBinding,
  setSavedVersion,
  setLastWriteTime,
  onWriteSuccess
}: DocumentWriterOptions) {
  async function finishWrite(version: number): Promise<true> {
    setSavedVersion(version)
    try {
      await onWriteSuccess?.(version)
    } catch (error) {
      console.warn('[Recovery] Cleanup after document write failed:', error)
    }
    return true
  }

  return async function writeFile(data: Uint8Array, version: number): Promise<boolean> {
    setLastWriteTime(Date.now())
    try {
      const storage = getStorageBinding()
      if (storage) {
        await persistStorageCanvasLocally({
          ...storageLocationOf(storage),
          canvasId: storage.documentId,
          name: state.documentName || 'Untitled',
          figBytes: data
        })
        return await finishWrite(version)
      }

      const filePath = getFilePath()
      const fileHandle = getFileHandle()
      if (filePath && isTauri()) {
        if (isAndroid() && filePath.startsWith('content://')) {
          await writeToAndroidDocument(filePath, data)
          return await finishWrite(version)
        }
        const { writeFile: tauriWrite } = await import('@tauri-apps/plugin-fs')
        await tauriWrite(filePath, data)
        return await finishWrite(version)
      }
      if (fileHandle) {
        const writable = await fileHandle.createWritable()
        await writable.write(new Uint8Array(data))
        await writable.close()
        return await finishWrite(version)
      }
      return false
    } catch (error) {
      recordDocumentFailure({
        operation: 'save',
        format: 'fig',
        ...describeDiagnosticError(error),
        retryable: describeDiagnosticError(error).retryable
      })
      throw error
    }
  }
}
