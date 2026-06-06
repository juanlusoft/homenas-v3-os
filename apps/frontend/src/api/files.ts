import { useAuthStore } from '../stores/authStore'

export interface FileEntry {
  name: string
  type: 'file' | 'dir' | 'symlink' | 'other'
  size: number
  modified: number
  permissions: string
  disk: string | null
}

export interface FileLocation {
  path: string
  label: string
  type: 'mergerfs' | 'rclone' | 'generic'
}

export interface FileInfo {
  name: string
  path: string
  type: 'file' | 'dir' | 'symlink' | 'other'
  size: number
  permissions: string
  owner: string
  group: string
  modified: number
  accessed: number
  created: number
}

function getHeaders(mutating = false): Record<string, string> {
  const { sessionId, csrfToken } = useAuthStore.getState()
  const headers: Record<string, string> = {}
  if (sessionId) headers['X-Session-Id'] = sessionId
  if (mutating && csrfToken) headers['X-CSRF-Token'] = csrfToken
  return headers
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    useAuthStore.getState().logout()
    throw new Error('UNAUTHORIZED')
  }
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

export const filesApi = {
  getLocations: (): Promise<FileLocation[]> =>
    fetch('/api/files/locations', {
      headers: getHeaders(false),
    }).then((r) => handleResponse<FileLocation[]>(r)),

  list: (path: string): Promise<FileEntry[]> =>
    fetch(`/api/files/list?path=${encodeURIComponent(path)}`, {
      headers: getHeaders(false),
    }).then((r) => handleResponse<FileEntry[]>(r)),

  mkdir: (path: string): Promise<{ ok: boolean }> =>
    fetch('/api/files/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getHeaders(true) },
      body: JSON.stringify({ path }),
    }).then((r) => handleResponse<{ ok: boolean }>(r)),

  deleteItem: (path: string): Promise<{ ok: boolean }> =>
    fetch('/api/files/item', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...getHeaders(true) },
      body: JSON.stringify({ path }),
    }).then((r) => handleResponse<{ ok: boolean }>(r)),

  rename: (oldPath: string, newPath: string): Promise<{ ok: boolean }> =>
    fetch('/api/files/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getHeaders(true) },
      body: JSON.stringify({ oldPath, newPath }),
    }).then((r) => handleResponse<{ ok: boolean }>(r)),

  move: (source: string, destination: string): Promise<{ ok: boolean }> =>
    fetch('/api/files/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getHeaders(true) },
      body: JSON.stringify({ source, destination }),
    }).then((r) => handleResponse<{ ok: boolean }>(r)),

  copy: (source: string, destination: string): Promise<{ ok: boolean }> =>
    fetch('/api/files/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getHeaders(true) },
      body: JSON.stringify({ source, destination }),
    }).then((r) => handleResponse<{ ok: boolean }>(r)),

  search: (path: string, q: string): Promise<string[]> =>
    fetch(`/api/files/search?path=${encodeURIComponent(path)}&q=${encodeURIComponent(q)}`, {
      headers: getHeaders(false),
    }).then((r) => handleResponse<string[]>(r)),

  getInfo: (path: string): Promise<FileInfo> =>
    fetch(`/api/files/info?path=${encodeURIComponent(path)}`, {
      headers: getHeaders(false),
    }).then((r) => handleResponse<FileInfo>(r)),

  // Downloads the file using the session header (NOT a query string), then
  // returns a short-lived blob: URL safe to assign to `<a href>`. The caller
  // is responsible for calling URL.revokeObjectURL() once the download starts.
  //
  // TODO(security): when the backend exposes POST /api/files/download-token,
  // switch to that flow (request a one-shot token, then build a clean URL like
  // `/api/files/download?path=...&token=...`). This avoids the blob round-trip
  // for very large files and lets the browser stream straight to disk.
  getDownloadUrl: async (path: string): Promise<string> => {
    const res = await fetch(`/api/files/download?path=${encodeURIComponent(path)}`, {
      headers: getHeaders(false),
    })
    if (res.status === 401) {
      useAuthStore.getState().logout()
      throw new Error('UNAUTHORIZED')
    }
    if (!res.ok) throw new Error(await res.text())
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  },

  upload: (destDir: string, files: File[], onProgress?: (pct: number) => void): Promise<{ ok: boolean; files: string[] }> => {
    return new Promise((resolve, reject) => {
      const { sessionId, csrfToken } = useAuthStore.getState()
      const formData = new FormData()
      formData.append('path', destDir)
      for (const f of files) {
        formData.append('file', f, f.name)
      }

      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/files/upload')
      if (sessionId) xhr.setRequestHeader('X-Session-Id', sessionId)
      if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken)

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
        }
      }

      xhr.onload = () => {
        if (xhr.status === 401) {
          useAuthStore.getState().logout()
          reject(new Error('UNAUTHORIZED'))
        } else if (xhr.status >= 400) {
          reject(new Error(xhr.responseText))
        } else {
          resolve(JSON.parse(xhr.responseText))
        }
      }
      xhr.onerror = () => reject(new Error('Network error during upload'))
      xhr.send(formData)
    })
  },
}
