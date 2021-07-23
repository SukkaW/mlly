import { fileURLToPath as _fileURLToPath, pathToFileURL } from 'url'
import { dirname } from 'path'
import { realpathSync, promises as fsp } from 'fs'
import { createRequire, builtinModules } from 'module'
import { moduleResolve } from 'import-meta-resolve'

// CommonJS

export function createCommonJS (importMeta) {
  const __filename = fileURLToPath(importMeta.url)
  const __dirname = dirname(__filename)

  // Lazy require
  let _nativeRequire
  const getNativeRequire = () => _nativeRequire || (_nativeRequire = createRequire(importMeta.url))
  function require (id) { return getNativeRequire()(id) }
  require.resolve = (id, options) => getNativeRequire().resolve(id, options)

  return {
    __filename,
    __dirname,
    require
  }
}

// Resolve

const DEFAULT_CONDITIONS_SET = new Set(['node', 'import'])
const BUILُTIN_MODULES = new Set(builtinModules)
const DEFAULT_FROM = pathToFileURL(process.cwd())
const DEFAULT_EXTENSIONS = ['.mjs', '.cjs', '.js', '.json']
const NOT_FOUND_ERRORS = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT', 'MODULE_NOT_FOUND'])

function _tryModuleResolve (id, from, conditions) {
  try {
    return moduleResolve(id, from, conditions)
  } catch (err) {
    if (!NOT_FOUND_ERRORS.has(err.code)) {
      throw err
    }
    return null
  }
}

function _resolve (id, opts = {}) {
  // console.log('> resolve ', id, 'from', opts.from)

  // Skip if already has a protocol
  if (/(node|data|http|https):/.test(id)) {
    return id
  }

  // Skip builtins
  if (BUILُTIN_MODULES.has(id)) {
    return 'node:' + id
  }

  // Defaults
  const conditionsSet = opts.conditions ? new Set(opts.conditions) : DEFAULT_CONDITIONS_SET
  const from = opts.from ? normalizeid(opts.from) : DEFAULT_FROM

  // Try simple resolve
  let resolved = _tryModuleResolve(id, from, conditionsSet)

  // Try other extensions if not found
  if (!resolved) {
    for (const prefix of ['', '/index']) {
      for (const ext of opts.extensions || DEFAULT_EXTENSIONS) {
        resolved = _tryModuleResolve(id + prefix + ext, from, conditionsSet)
        if (resolved) { break }
      }
      if (resolved) { break }
    }
  }

  // Throw error if not found
  if (!resolved) {
    const err = new Error(`Cannot find module ${id} imported from ${from}`)
    err.code = 'ERR_MODULE_NOT_FOUND'
    throw err
  }

  // Resolve realPath and normalize slash
  const realPath = realpathSync(fileURLToPath(resolved))
  return pathToFileURL(realPath).toString()
}

export function resolveSync (id, opts) {
  return _resolve(id, opts)
}

export function resolve (id, opts) {
  return _pcall(resolveSync, id, opts)
}

export function resolvePathSync (id, opts) {
  return fileURLToPath(resolveSync(id, opts))
}

export function resolvePath (id, opts) {
  return _pcall(resolvePathSync, id, opts)
}

export function createResolve (defaults) {
  return (id, from) => {
    return resolve(id, { ...defaults, from: from || defaults.from })
  }
}

// Evaluate

const ESM_IMPORT_RE = /(?<=import .* from ['"])([^'"]+)(?=['"])|(?<=export .* from ['"])([^'"]+)(?=['"])|(?<=import\s*['"])([^'"]+)(?=['"])|(?<=import\s*\(['"])([^'"]+)(?=['"]\))/g

export async function loadModule (id, opts = {}) {
  const { url, code } = await readModule(id, opts)
  return evalModule(code, {
    url,
    ...opts
  })
}

export async function evalModule (code, opts = {}) {
  const transformed = await transformModule(code, opts)
  return import(toDataURL(transformed, opts))
}

export async function readModule (id, opts) {
  const url = await resolve(id, opts)
  const code = await fsp.readFile(fileURLToPath(url), 'utf-8')
  return { url, code }
}

export async function transformModule (code, opts) {
  // Use url <> from as defaults of each other
  if (!opts.url && opts.from) {
    opts.url = opts.from
  } else if (opts.url && !opts.from) {
    opts.from = opts.url
  }

  // Resolve relative imports
  code = await resolveImports(code, opts)

  // Rewrite import.meta.url
  if (opts.url) {
    code = code.replace(/import\.meta\.url/g, `'${opts.url}'`)
  }

  return code
}

export function toDataURL (code) {
  const base64 = Buffer.from(code).toString('base64')
  return `data:text/javascript;base64,${base64}`
}

export async function resolveImports (code, opts) {
  const imports = Array.from(code.matchAll(ESM_IMPORT_RE)).map(m => m[0])
  if (!imports.length) {
    return code
  }

  const uniqueImports = Array.from(new Set(imports))
  const resolved = new Map()
  const resolveOpts = { ...opts, from: opts.url }
  await Promise.all(uniqueImports.map(async (id) => { resolved.set(id, await resolve(id, resolveOpts)) }))

  const re = new RegExp(uniqueImports.map(i => `(${i})`).join('|'), 'g')
  return code.replace(re, id => resolved.get(id))
}

// Utils

export function fileURLToPath (id) {
  if (typeof id === 'string' && !id.startsWith('file://')) {
    return normalizeSlash(id)
  }
  return normalizeSlash(_fileURLToPath(id))
}

export function normalizeid (id) {
  if (typeof id !== 'string') {
    id = id.toString()
  }
  if (/(node|data|http|https|file):/.test(id)) {
    return id
  }
  if (BUILُTIN_MODULES.has(id)) {
    return 'node:' + id
  }
  return 'file://' + normalizeSlash(id)
}

function normalizeSlash (str) {
  return str.replace(/\\/g, '/')
}

function _pcall (fn, ...args) {
  try {
    return Promise.resolve(fn(...args)).catch(err => _perr(err))
  } catch (err) {
    return _perr(err)
  }
}

function _perr (_err) {
  const err = new Error(_err)
  err.code = _err.code
  Error.captureStackTrace(err, _pcall)
  return Promise.reject(err)
}
