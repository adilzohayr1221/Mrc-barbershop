var RUNTIME_PUBLIC_PATH = "server/chunks/[turbopack]_runtime.js";
var RELATIVE_ROOT_PATH = "..";
var ASSET_PREFIX = "/";
// Apply forwarded globals from workerData if running in a worker thread
if (typeof require !== 'undefined') {
    try {
        var { workerData } = require('worker_threads');
        if (workerData?.__turbopack_globals__) {
            Object.assign(globalThis, workerData.__turbopack_globals__);
            // Remove internal data so it's not visible to user code
            delete workerData.__turbopack_globals__;
        }
    } catch (_) {
        // Not in a worker thread context, ignore
    }
}
/**
 * This file contains runtime types and functions that are shared between all
 * TurboPack ECMAScript runtimes.
 *
 * It will be prepended to the runtime code of each runtime.
 */ /* eslint-disable @typescript-eslint/no-unused-vars */ /// <reference path="./runtime-types.d.ts" />
/// <reference path="./async-module.ts" />
/**
 * Describes why a module was instantiated.
 * Shared between browser and Node.js runtimes.
 */ var SourceType = /*#__PURE__*/ function(SourceType) {
    /**
   * The module was instantiated because it was included in an evaluated chunk's
   * runtime.
   * SourceData is a ChunkPath.
   */ SourceType[SourceType["Runtime"] = 0] = "Runtime";
    /**
   * The module was instantiated because a parent module imported it.
   * SourceData is a ModuleId.
   */ SourceType[SourceType["Parent"] = 1] = "Parent";
    /**
   * The module was instantiated because it was included in a chunk's hot module
   * update.
   * SourceData is an array of ModuleIds or undefined.
   */ SourceType[SourceType["Update"] = 2] = "Update";
    return SourceType;
}(SourceType || {});
/**
 * Flag indicating which module object type to create when a module is merged. Set to `true`
 * by each runtime that uses ModuleWithDirection (browser dev-base.ts, nodejs dev-base.ts,
 * nodejs build-base.ts). Browser production (build-base.ts) leaves it as `false` since it
 * uses plain Module objects.
 */ let createModuleWithDirectionFlag = false;
const REEXPORTED_OBJECTS = new WeakMap();
/**
 * Constructs the `__turbopack_context__` object for a module.
 */ function Context(module, exports) {
    this.m = module;
    // We need to store this here instead of accessing it from the module object to:
    // 1. Make it available to factories directly, since we rewrite `this` to
    //    `__turbopack_context__.e` in CJS modules.
    // 2. Support async modules which rewrite `module.exports` to a promise, so we
    //    can still access the original exports object from functions like
    //    `esmExport`
    // Ideally we could find a new approach for async modules and drop this property altogether.
    this.e = exports;
}
const contextPrototype = Context.prototype;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const toStringTag = typeof Symbol !== 'undefined' && Symbol.toStringTag;
function defineProp(obj, name, options) {
    if (!hasOwnProperty.call(obj, name)) Object.defineProperty(obj, name, options);
}
function getOverwrittenModule(moduleCache, id) {
    let module = moduleCache[id];
    if (!module) {
        if (createModuleWithDirectionFlag) {
            // set in development modes for hmr support
            module = createModuleWithDirection(id);
        } else {
            module = createModuleObject(id);
        }
        moduleCache[id] = module;
    }
    return module;
}
/**
 * Creates the module object. Only done here to ensure all module objects have the same shape.
 */ function createModuleObject(id) {
    return {
        exports: {},
        error: undefined,
        id,
        namespaceObject: undefined
    };
}
function createModuleWithDirection(id) {
    return {
        exports: {},
        error: undefined,
        id,
        namespaceObject: undefined,
        parents: [],
        children: []
    };
}
const BindingTag_Value = 0;
/**
 * Adds the getters to the exports object.
 */ function esm(exports, bindings, dynamic) {
    defineProp(exports, '__esModule', {
        value: true
    });
    if (toStringTag) defineProp(exports, toStringTag, {
        value: 'Module'
    });
    let i = 0;
    while(i < bindings.length){
        const propName = bindings[i++];
        const tagOrFunction = bindings[i++];
        if (typeof tagOrFunction === 'number') {
            if (tagOrFunction === BindingTag_Value) {
                defineProp(exports, propName, {
                    value: bindings[i++],
                    enumerable: true,
                    writable: false
                });
            } else {
                throw new Error(`unexpected tag: ${tagOrFunction}`);
            }
        } else {
            const getterFn = tagOrFunction;
            if (typeof bindings[i] === 'function') {
                const setterFn = bindings[i++];
                defineProp(exports, propName, {
                    get: getterFn,
                    set: setterFn,
                    enumerable: true
                });
            } else {
                defineProp(exports, propName, {
                    get: getterFn,
                    enumerable: true
                });
            }
        }
    }
    // The properties defined above are already non-configurable and
    // non-writable, so the namespace's existing exports are effectively
    // immutable. Sealing additionally makes the object non-extensible, matching
    // real ESM-namespace semantics. Modules with dynamic re-exports
    // (`export *` from a CommonJS module) must stay extensible so the dynamic
    // export proxy can surface keys discovered at runtime, so skip the seal for
    // them.
    if (!dynamic) Object.seal(exports);
}
/**
 * Makes the module an ESM with exports
 */ function esmExport(bindings, id, dynamic) {
    let module;
    let exports;
    if (id != null) {
        module = getOverwrittenModule(this.c, id);
        exports = module.exports;
    } else {
        module = this.m;
        exports = this.e;
    }
    module.namespaceObject = exports;
    esm(exports, bindings, dynamic);
}
contextPrototype.s = esmExport;
function ensureDynamicExports(module, exports) {
    let reexportedObjects = REEXPORTED_OBJECTS.get(module);
    if (!reexportedObjects) {
        REEXPORTED_OBJECTS.set(module, reexportedObjects = []);
        // Returns the re-exported object that provides `prop` as an own property,
        // or `undefined` if none does. The traps share this logic so they always
        // agree on which keys are synthesized from `reexportedObjects`. `default`
        // is never re-exported by `export *`, so it is never synthesized.
        const reexportOwning = (prop)=>{
            if (prop !== 'default') {
                for (const obj of reexportedObjects){
                    if (hasOwnProperty.call(obj, prop)) return obj;
                }
            }
            return undefined;
        };
        // Modules with dynamic re-exports are not sealed by `esm()`, so the
        // target beneath the namespace stays extensible. That is what lets the
        // `ownKeys` and `getOwnPropertyDescriptor` traps legally report keys that
        // exist on `reexportedObjects` but not on the target itself.
        module.exports = module.namespaceObject = new Proxy(exports, {
            get (target, prop) {
                if (hasOwnProperty.call(target, prop) || prop === 'default' || prop === '__esModule') {
                    return Reflect.get(target, prop);
                }
                const obj = reexportOwning(prop);
                return obj && Reflect.get(obj, prop);
            },
            // The namespace is read-only, like a real esm namespace object. The
            // re-exported modules can still mutate their own exports (exposed live
            // via `get`), but mutating the namespace itself is rejected. Refusing
            // here, rather than forwarding to the extensible target, also prevents an
            // assignment/definition from shadowing a dynamic re-export. It also
            // prevents delete from removing a static export.
            set () {
                return false;
            },
            defineProperty () {
                return false;
            },
            deleteProperty () {
                return false;
            },
            // The `has` trap ensures that `'exportName' in starImports` will reflect
            // the truth of whether a key is exported.
            has (target, prop) {
                if (Reflect.has(target, prop)) return true;
                if (prop === 'default' || prop === '__esModule') return false;
                return reexportOwning(prop) !== undefined;
            },
            // ownKeys and getOwnPropertyDescriptor together make the keys enumerable.
            // If a value is returned from `ownKeys` but its property descriptor is
            // not enumerable, it will not be visible to iterator methods.
            // Collectively, they allow code like the following:
            //
            // ```
            // // module.js re-exports dynamic CJS exports
            // export * from './legacyModule.cjs'
            //
            // // from another JS file, reference the re-exported dynamic values
            // import * as Namespace from './module.js'
            // Object.keys(Namespace)
            // ```
            ownKeys (target) {
                const keys = Reflect.ownKeys(target);
                for (const obj of reexportedObjects){
                    for (const key of Reflect.ownKeys(obj)){
                        if (key !== 'default' && !keys.includes(key)) keys.push(key);
                    }
                }
                return keys;
            },
            getOwnPropertyDescriptor (target, prop) {
                const own = Reflect.getOwnPropertyDescriptor(target, prop);
                if (own || prop === 'default' || prop === '__esModule') return own;
                const obj = reexportOwning(prop);
                if (obj) {
                    // Synthetic keys don't exist on the target, so they MUST be
                    // reported as configurable. However the set/delete traps above will
                    // prevent them from actually being changed
                    return {
                        enumerable: true,
                        configurable: true,
                        get: ()=>Reflect.get(obj, prop)
                    };
                }
                return undefined;
            }
        });
    }
    return reexportedObjects;
}
/**
 * Dynamically exports properties from an object
 */ function dynamicExport(object, id) {
    let module;
    let exports;
    if (id != null) {
        module = getOverwrittenModule(this.c, id);
        exports = module.exports;
    } else {
        module = this.m;
        exports = this.e;
    }
    const reexportedObjects = ensureDynamicExports(module, exports);
    if (typeof object === 'object' && object !== null) {
        reexportedObjects.push(object);
    }
}
contextPrototype.j = dynamicExport;
function exportValue(value, id) {
    let module;
    if (id != null) {
        module = getOverwrittenModule(this.c, id);
    } else {
        module = this.m;
    }
    module.exports = value;
}
contextPrototype.v = exportValue;
function exportNamespace(namespace, id) {
    let module;
    if (id != null) {
        module = getOverwrittenModule(this.c, id);
    } else {
        module = this.m;
    }
    module.exports = module.namespaceObject = namespace;
}
contextPrototype.n = exportNamespace;
function createGetter(obj, key) {
    return ()=>obj[key];
}
/**
 * @returns prototype of the object
 */ const getProto = Object.getPrototypeOf ? (obj)=>Object.getPrototypeOf(obj) : (obj)=>obj.__proto__;
/** Prototypes that are not expanded for exports */ const LEAF_PROTOTYPES = [
    null,
    getProto({}),
    getProto([]),
    getProto(getProto)
];
/**
 * @param raw
 * @param ns
 * @param allowExportDefault
 *   * `false`: will have the raw module as default export
 *   * `true`: will have the default property as default export
 */ function interopEsm(raw, ns, allowExportDefault) {
    const bindings = [];
    let defaultLocation = -1;
    for(let current = raw; (typeof current === 'object' || typeof current === 'function') && !LEAF_PROTOTYPES.includes(current); current = getProto(current)){
        for (const key of Object.getOwnPropertyNames(current)){
            bindings.push(key, createGetter(raw, key));
            if (defaultLocation === -1 && key === 'default') {
                defaultLocation = bindings.length - 1;
            }
        }
    }
    // this is not really correct
    // we should set the `default` getter if the imported module is a `.cjs file`
    if (!(allowExportDefault && defaultLocation >= 0)) {
        // Replace the binding with one for the namespace itself in order to preserve iteration order.
        if (defaultLocation >= 0) {
            // Replace the getter with the value
            bindings.splice(defaultLocation, 1, BindingTag_Value, raw);
        } else {
            bindings.push('default', BindingTag_Value, raw);
        }
    }
    esm(ns, bindings);
    return ns;
}
function createNS(raw) {
    if (typeof raw === 'function') {
        return function(...args) {
            return raw.apply(this, args);
        };
    } else {
        return Object.create(null);
    }
}
function esmImport(id) {
    const module = getOrInstantiateModuleFromParent(id, this.m);
    // any ES module has to have `module.namespaceObject` defined.
    if (module.namespaceObject) return module.namespaceObject;
    // only ESM can be an async module, so we don't need to worry about exports being a promise here.
    const raw = module.exports;
    return module.namespaceObject = interopEsm(raw, createNS(raw), raw && raw.__esModule);
}
contextPrototype.i = esmImport;
function asyncLoader(moduleId) {
    const loader = this.r(moduleId);
    return loader(esmImport.bind(this));
}
contextPrototype.A = asyncLoader;
// Add a simple runtime require so that environments without one can still pass
// `typeof require` CommonJS checks so that exports are correctly registered.
const runtimeRequire = // @ts-ignore
typeof require === 'function' ? require : function require1() {
    throw new Error('Unexpected use of runtime require');
};
contextPrototype.t = runtimeRequire;
function commonJsRequire(id) {
    return getOrInstantiateModuleFromParent(id, this.m).exports;
}
contextPrototype.r = commonJsRequire;
/**
 * Remove fragments and query parameters since they are never part of the context map keys
 *
 * This matches how we parse patterns at resolving time.  Arguably we should only do this for
 * strings passed to `import` but the resolve does it for `import` and `require` and so we do
 * here as well.
 */ function parseRequest(request) {
    // Per the URI spec fragments can contain `?` characters, so we should trim it off first
    // https://datatracker.ietf.org/doc/html/rfc3986#section-3.5
    const hashIndex = request.indexOf('#');
    if (hashIndex !== -1) {
        request = request.substring(0, hashIndex);
    }
    const queryIndex = request.indexOf('?');
    if (queryIndex !== -1) {
        request = request.substring(0, queryIndex);
    }
    return request;
}
/**
 * `require.context` and require/import expression runtime.
 */ function moduleContext(map) {
    function moduleContext(id) {
        id = parseRequest(id);
        if (hasOwnProperty.call(map, id)) {
            return map[id].module();
        }
        const e = new Error(`Cannot find module '${id}'`);
        e.code = 'MODULE_NOT_FOUND';
        throw e;
    }
    moduleContext.keys = ()=>{
        return Object.keys(map);
    };
    moduleContext.resolve = (id)=>{
        id = parseRequest(id);
        if (hasOwnProperty.call(map, id)) {
            return map[id].id();
        }
        const e = new Error(`Cannot find module '${id}'`);
        e.code = 'MODULE_NOT_FOUND';
        throw e;
    };
    moduleContext.import = async (id)=>{
        return await moduleContext(id);
    };
    return moduleContext;
}
contextPrototype.f = moduleContext;
/**
 * Returns the path of a chunk defined by its data.
 */ function getChunkPath(chunkData) {
    return typeof chunkData === 'string' ? chunkData : chunkData.path;
}
// Load the CompressedmoduleFactories of a chunk into the `moduleFactories` Map.
// The CompressedModuleFactories format is
// - 1 or more module ids
// - a module factory function
// So walking this is a little complex but the flat structure is also fast to
// traverse, we can use `typeof` operators to distinguish the two cases.
function installCompressedModuleFactories(chunkModules, offset, moduleFactories, newModuleId) {
    let i = offset;
    while(i < chunkModules.length){
        let end = i + 1;
        // Find our factory function
        while(end < chunkModules.length && typeof chunkModules[end] !== 'function'){
            end++;
        }
        if (end === chunkModules.length) {
            throw new Error('malformed chunk format, expected a factory function');
        }
        // Install the factory for each module ID that doesn't already have one.
        // When some IDs in this group already have a factory, reuse that existing
        // group factory for the missing IDs to keep all IDs in the group consistent.
        // Otherwise, install the factory from this chunk.
        const moduleFactoryFn = chunkModules[end];
        let existingGroupFactory = undefined;
        for(let j = i; j < end; j++){
            const id = chunkModules[j];
            const existingFactory = moduleFactories.get(id);
            if (existingFactory) {
                existingGroupFactory = existingFactory;
                break;
            }
        }
        const factoryToInstall = existingGroupFactory ?? moduleFactoryFn;
        let didInstallFactory = false;
        for(let j = i; j < end; j++){
            const id = chunkModules[j];
            if (!moduleFactories.has(id)) {
                if (!didInstallFactory) {
                    if (factoryToInstall === moduleFactoryFn) {
                        applyModuleFactoryName(moduleFactoryFn);
                    }
                    didInstallFactory = true;
                }
                moduleFactories.set(id, factoryToInstall);
                newModuleId?.(id);
            }
        }
        i = end + 1; // end is pointing at the last factory advance to the next id or the end of the array.
    }
}
/**
 * A pseudo "fake" URL object to resolve to its relative path.
 *
 * When UrlRewriteBehavior is set to relative, calls to the `new URL()` will construct url without base using this
 * runtime function to generate context-agnostic urls between different rendering context, i.e ssr / client to avoid
 * hydration mismatch.
 *
 * This is based on webpack's existing implementation:
 * https://github.com/webpack/webpack/blob/87660921808566ef3b8796f8df61bd79fc026108/lib/runtime/RelativeUrlRuntimeModule.js
 */ const relativeURL = function relativeURL(inputUrl) {
    const realUrl = new URL(inputUrl, 'x:/');
    const values = {};
    for(const key in realUrl)values[key] = realUrl[key];
    values.href = inputUrl;
    values.pathname = inputUrl.replace(/[?#].*/, '');
    values.origin = values.protocol = '';
    values.toString = values.toJSON = (..._args)=>inputUrl;
    for(const key in values)Object.defineProperty(this, key, {
        enumerable: true,
        configurable: true,
        value: values[key]
    });
};
relativeURL.prototype = URL.prototype;
contextPrototype.U = relativeURL;
/**
 * Utility function to ensure all variants of an enum are handled.
 */ function invariant(never, computeMessage) {
    throw new Error(`Invariant: ${computeMessage(never)}`);
}
/**
 * Constructs an error message for when a module factory is not available.
 */ function factoryNotAvailableMessage(moduleId, sourceType, sourceData) {
    let instantiationReason;
    switch(sourceType){
        case 0:
            instantiationReason = `as a runtime entry of chunk ${sourceData}`;
            break;
        case 1:
            instantiationReason = `because it was required from module ${sourceData}`;
            break;
        case 2:
            instantiationReason = 'because of an HMR update';
            break;
        default:
            invariant(sourceType, (sourceType)=>`Unknown source type: ${sourceType}`);
    }
    return `Module ${moduleId} was instantiated ${instantiationReason}, but the module factory is not available.`;
}
/**
 * A stub function to make `require` available but non-functional in ESM.
 */ function requireStub(_moduleId) {
    throw new Error('dynamic usage of require is not supported');
}
contextPrototype.z = requireStub;
// Make `globalThis` available to the module in a way that cannot be shadowed by a local variable.
contextPrototype.g = globalThis;
function applyModuleFactoryName(factory) {
    // Give the module factory a nice name to improve stack traces.
    Object.defineProperty(factory, 'name', {
        value: 'module evaluation'
    });
}
/// <reference path="../shared/runtime/runtime-utils.ts" />
/// A 'base' utilities to support runtime can have externals.
/// Currently this is for node.js / edge runtime both.
/// If a fn requires node.js specific behavior, it should be placed in `node-external-utils` instead.
async function externalImport(id) {
    let raw;
    try {
        switch (id) {
  case "next/dist/compiled/@vercel/og/index.node.js":
    raw = await import("next/dist/compiled/@vercel/og/index.edge.js");
    break;
  default:
    raw = await import(id);
};
    } catch (err) {
        // TODO(alexkirsz) This can happen when a client-side module tries to load
        // an external module we don't provide a shim for (e.g. querystring, url).
        // For now, we fail semi-silently, but in the future this should be a
        // compilation error.
        throw new Error(`Failed to load external module ${id}: ${err}`);
    }
    if (raw && raw.__esModule && raw.default && 'default' in raw.default) {
        return interopEsm(raw.default, createNS(raw), true);
    }
    return raw;
}
contextPrototype.y = externalImport;
function externalRequire(id, thunk, esm = false) {
    let raw;
    try {
        raw = thunk();
    } catch (err) {
        // TODO(alexkirsz) This can happen when a client-side module tries to load
        // an external module we don't provide a shim for (e.g. querystring, url).
        // For now, we fail semi-silently, but in the future this should be a
        // compilation error.
        throw new Error(`Failed to load external module ${id}: ${err}`);
    }
    if (!esm || raw.__esModule) {
        return raw;
    }
    return interopEsm(raw, createNS(raw), true);
}
externalRequire.resolve = (id, options)=>{
    return require.resolve(id, options);
};
contextPrototype.x = externalRequire;
/* eslint-disable @typescript-eslint/no-unused-vars */ const path = require('path');
const relativePathToRuntimeRoot = path.relative(RUNTIME_PUBLIC_PATH, '.');
// Compute the relative path to the `distDir`.
const relativePathToDistRoot = path.join(relativePathToRuntimeRoot, RELATIVE_ROOT_PATH);
const RUNTIME_ROOT = path.resolve(__filename, relativePathToRuntimeRoot);
// Compute the absolute path to the root, by stripping distDir from the absolute path to this file.
const ABSOLUTE_ROOT = path.resolve(__filename, relativePathToDistRoot);
/**
 * Returns an absolute path to the given module path.
 * Module path should be relative, either path to a file or a directory.
 *
 * This fn allows to calculate an absolute path for some global static values, such as
 * `__dirname` or `import.meta.url` that Turbopack will not embeds in compile time.
 * See ImportMetaBinding::code_generation for the usage.
 */ function resolveAbsolutePath(modulePath) {
    if (modulePath) {
        return path.join(ABSOLUTE_ROOT, modulePath);
    }
    return ABSOLUTE_ROOT;
}
Context.prototype.P = resolveAbsolutePath;
/**
 * Returns an absolute `file://` URL for the given module path.
 *
 * Uses `url.pathToFileURL` so that the resulting URL is a valid file URI on
 * all platforms (forward slashes on Windows, drive letters handled
 * correctly, path segments URL-encoded).
 */ function resolveFileUrl(modulePath) {
    return require('url').pathToFileURL(resolveAbsolutePath(modulePath)).href;
}
Context.prototype.F = resolveFileUrl;
/* eslint-disable @typescript-eslint/no-unused-vars */ /// <reference path="../../shared/runtime/runtime-utils.ts" />
/// <reference path="../../shared-node/base-externals-utils.ts" />
/// <reference path="../../shared-node/node-externals-utils.ts" />
/// <reference path="./nodejs-globals.d.ts" />
/**
 * Base Node.js runtime shared between production and development.
 * Contains chunk loading, module caching, and other non-HMR functionality.
 */ process.env.TURBOPACK = '1';
const url = require('url');
const moduleFactories = new Map();
const moduleCache = Object.create(null);
/**
 * Returns an absolute path to the given module's id.
 */ function resolvePathFromModule(moduleId) {
    const exported = this.r(moduleId);
    const exportedPath = exported?.default ?? exported;
    if (typeof exportedPath !== 'string') {
        return exported;
    }
    const strippedAssetPrefix = exportedPath.slice(ASSET_PREFIX.length);
    const resolved = path.resolve(RUNTIME_ROOT, strippedAssetPrefix);
    return url.pathToFileURL(resolved).href;
}
/**
 * Exports a URL value. No suffix is added in Node.js runtime.
 */ function exportUrl(urlValue, id) {
    exportValue.call(this, urlValue, id);
}
function loadRuntimeChunk(sourcePath, chunkData) {
    if (typeof chunkData === 'string') {
        loadRuntimeChunkPath(sourcePath, chunkData);
    } else {
        loadRuntimeChunkPath(sourcePath, chunkData.path);
    }
}
const loadedChunks = new Set();
const unsupportedLoadChunk = Promise.resolve(undefined);
const loadedChunk = Promise.resolve(undefined);
const chunkCache = new Map();
function clearChunkCache() {
    chunkCache.clear();
    loadedChunks.clear();
}
function loadRuntimeChunkPath(sourcePath, chunkPath) {
    if (!isJs(chunkPath)) {
        // We only support loading JS chunks in Node.js.
        // This branch can be hit when trying to load a CSS chunk.
        return;
    }
    if (loadedChunks.has(chunkPath)) {
        return;
    }
    try {
        const resolved = path.resolve(RUNTIME_ROOT, chunkPath);
        const chunkModules = requireChunk(chunkPath);
        installCompressedModuleFactories(chunkModules, 0, moduleFactories);
        loadedChunks.add(chunkPath);
    } catch (cause) {
        let errorMessage = `Failed to load chunk ${chunkPath}`;
        if (sourcePath) {
            errorMessage += ` from runtime for chunk ${sourcePath}`;
        }
        const error = new Error(errorMessage, {
            cause
        });
        error.name = 'ChunkLoadError';
        throw error;
    }
}
function loadChunkAsync(chunkData) {
    const chunkPath = typeof chunkData === 'string' ? chunkData : chunkData.path;
    if (!isJs(chunkPath)) {
        // We only support loading JS chunks in Node.js.
        // This branch can be hit when trying to load a CSS chunk.
        return unsupportedLoadChunk;
    }
    let entry = chunkCache.get(chunkPath);
    if (entry === undefined) {
        try {
            // resolve to an absolute path to simplify `require` handling
            const resolved = path.resolve(RUNTIME_ROOT, chunkPath);
            // TODO: consider switching to `import()` to enable concurrent chunk loading and async file io
            // However this is incompatible with hot reloading (since `import` doesn't use the require cache)
            const chunkModules = requireChunk(chunkPath);
            installCompressedModuleFactories(chunkModules, 0, moduleFactories);
            entry = loadedChunk;
        } catch (cause) {
            const errorMessage = `Failed to load chunk ${chunkPath} from module ${this.m.id}`;
            const error = new Error(errorMessage, {
                cause
            });
            error.name = 'ChunkLoadError';
            // Cache the failure promise, future requests will also get this same rejection
            entry = Promise.reject(error);
        }
        chunkCache.set(chunkPath, entry);
    }
    // TODO: Return an instrumented Promise that React can use instead of relying on referential equality.
    return entry;
}
contextPrototype.l = loadChunkAsync;
function loadChunkAsyncByUrl(chunkUrl) {
    const path1 = url.fileURLToPath(new URL(chunkUrl, RUNTIME_ROOT));
    return loadChunkAsync.call(this, path1);
}
contextPrototype.L = loadChunkAsyncByUrl;
// Shared runtime primitive: the root that on-disk chunk paths are resolved
// against. Used by the bundled wasm helper (exposed as `__turbopack_runtime_root__`).
contextPrototype.w = RUNTIME_ROOT;
const regexJsUrl = /\.js(?:\?[^#]*)?(?:#.*)?$/;
/**
 * Checks if a given path/URL ends with .js, optionally followed by ?query or #fragment.
 */ function isJs(chunkUrlOrPath) {
    return regexJsUrl.test(chunkUrlOrPath);
}
/* eslint-disable @typescript-eslint/no-unused-vars */ /// <reference path="./runtime-base.ts" />
/**
 * Production Node.js runtime.
 * Uses ModuleWithDirection and simple module instantiation without HMR support.
 */ // moduleCache and moduleFactories are declared in runtime-base.ts
// this is read in runtime-utils.ts so it creates a module with direction for hmr
createModuleWithDirectionFlag = true;
const nodeContextPrototype = Context.prototype;
nodeContextPrototype.q = exportUrl;
nodeContextPrototype.M = moduleFactories;
// Cast moduleCache to ModuleWithDirection for production mode
nodeContextPrototype.c = moduleCache;
nodeContextPrototype.R = resolvePathFromModule;
nodeContextPrototype.C = clearChunkCache;
function instantiateModule(id, sourceType, sourceData) {
    const moduleFactory = moduleFactories.get(id);
    if (typeof moduleFactory !== 'function') {
        // This can happen if modules incorrectly handle HMR disposes/updates,
        // e.g. when they keep a `setTimeout` around which still executes old code
        // and contains e.g. a `require("something")` call.
        throw new Error(factoryNotAvailableMessage(id, sourceType, sourceData));
    }
    const module1 = createModuleWithDirection(id);
    const exports = module1.exports;
    moduleCache[id] = module1;
    const context = new Context(module1, exports);
    // NOTE(alexkirsz) This can fail when the module encounters a runtime error.
    try {
        moduleFactory(context, module1, exports);
    } catch (error) {
        module1.error = error;
        throw error;
    }
    ;
    module1.loaded = true;
    if (module1.namespaceObject && module1.exports !== module1.namespaceObject) {
        // in case of a circular dependency: cjs1 -> esm2 -> cjs1
        interopEsm(module1.exports, module1.namespaceObject);
    }
    return module1;
}
/**
 * Retrieves a module from the cache, or instantiate it if it is not cached.
 */ // @ts-ignore
function getOrInstantiateModuleFromParent(id, sourceModule) {
    const module1 = moduleCache[id];
    if (module1) {
        if (module1.error) {
            throw module1.error;
        }
        return module1;
    }
    return instantiateModule(id, SourceType.Parent, sourceModule.id);
}
/**
 * Instantiates a runtime module.
 */ function instantiateRuntimeModule(chunkPath, moduleId) {
    return instantiateModule(moduleId, SourceType.Runtime, chunkPath);
}
/**
 * Retrieves a module from the cache, or instantiate it as a runtime module if it is not cached.
 */ // @ts-ignore TypeScript doesn't separate this module space from the browser runtime
function getOrInstantiateRuntimeModule(chunkPath, moduleId) {
    const module1 = moduleCache[moduleId];
    if (module1) {
        if (module1.error) {
            throw module1.error;
        }
        return module1;
    }
    return instantiateRuntimeModule(chunkPath, moduleId);
}
module.exports = (sourcePath)=>({
        m: (id)=>getOrInstantiateRuntimeModule(sourcePath, id),
        c: (chunkData)=>loadRuntimeChunk(sourcePath, chunkData)
    });


//# sourceMappingURL=%5Bturbopack%5D_runtime.js.map

  function requireChunk(chunkPath) {
    switch(chunkPath) {
      case "server/chunks/ssr/[root-of-the-server]__0d55-q_._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__0d55-q_._.js");
      case "server/chunks/ssr/[root-of-the-server]__0vz7f19._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__0vz7f19._.js");
      case "server/chunks/ssr/[root-of-the-server]__16wpg8x._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__16wpg8x._.js");
      case "server/chunks/ssr/[root-of-the-server]__1s6fy64._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__1s6fy64._.js");
      case "server/chunks/ssr/[root-of-the-server]__1v12tfu._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__1v12tfu._.js");
      case "server/chunks/ssr/[turbopack]_runtime.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[turbopack]_runtime.js");
      case "server/chunks/ssr/_0_drtlr._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_0_drtlr._.js");
      case "server/chunks/ssr/_next-internal_server_app__not-found_page_actions_0pt47yr.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app__not-found_page_actions_0pt47yr.js");
      case "server/chunks/ssr/node_modules_next_0x3i8za._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/node_modules_next_0x3i8za._.js");
      case "server/chunks/ssr/node_modules_next_dist_0nkkbfv._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/node_modules_next_dist_0nkkbfv._.js");
      case "server/chunks/ssr/node_modules_next_dist_1pq-o5w._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/node_modules_next_dist_1pq-o5w._.js");
      case "server/chunks/ssr/node_modules_next_dist_1v8aef8._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/node_modules_next_dist_1v8aef8._.js");
      case "server/chunks/ssr/node_modules_next_dist_1ymd6cg._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/node_modules_next_dist_1ymd6cg._.js");
      case "server/chunks/ssr/node_modules_next_dist_client_components_0bew68i._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/node_modules_next_dist_client_components_0bew68i._.js");
      case "server/chunks/ssr/node_modules_next_dist_client_components_0wpq8j3._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/node_modules_next_dist_client_components_0wpq8j3._.js");
      case "server/chunks/ssr/node_modules_next_dist_client_components_builtin_forbidden_0symwr9.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/node_modules_next_dist_client_components_builtin_forbidden_0symwr9.js");
      case "server/chunks/ssr/node_modules_next_dist_client_components_builtin_unauthorized_0l_sp0x.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/node_modules_next_dist_client_components_builtin_unauthorized_0l_sp0x.js");
      case "server/chunks/ssr/[root-of-the-server]__07_clhj._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__07_clhj._.js");
      case "server/chunks/ssr/[root-of-the-server]__1f2jx51._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__1f2jx51._.js");
      case "server/chunks/ssr/_next-internal_server_app__global-error_page_actions_0zi5s8-.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app__global-error_page_actions_0zi5s8-.js");
      case "server/chunks/ssr/node_modules_next_dist_client_components_builtin_global-error_0q-w892.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/node_modules_next_dist_client_components_builtin_global-error_0q-w892.js");
      case "server/chunks/[externals]__1md9mv7._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[externals]__1md9mv7._.js");
      case "server/chunks/[root-of-the-server]__0l3yhx4._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0l3yhx4._.js");
      case "server/chunks/[root-of-the-server]__0plluon._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0plluon._.js");
      case "server/chunks/[turbopack]_runtime.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[turbopack]_runtime.js");
      case "server/chunks/_1al-du5._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_1al-du5._.js");
      case "server/chunks/_next-internal_server_app_api_assistant_route_actions_1w4zl8n.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_assistant_route_actions_1w4zl8n.js");
      case "server/chunks/[root-of-the-server]__1tl9wbd._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1tl9wbd._.js");
      case "server/chunks/_next-internal_server_app_api_auth_barber_route_actions_0q1o2to.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_auth_barber_route_actions_0q1o2to.js");
      case "server/chunks/src_lib_auth_ts_1_aqh19._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/src_lib_auth_ts_1_aqh19._.js");
      case "server/chunks/_1ceszf0._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_1ceszf0._.js");
      case "server/chunks/_next-internal_server_app_api_auth_customer_route_actions_1s5d3yg.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_auth_customer_route_actions_1s5d3yg.js");
      case "server/chunks/[root-of-the-server]__1a3neqj._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1a3neqj._.js");
      case "server/chunks/_next-internal_server_app_api_auth_owner_route_actions_1ibsf-c.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_auth_owner_route_actions_1ibsf-c.js");
      case "server/chunks/[externals]_util_1jlmhhy._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[externals]_util_1jlmhhy._.js");
      case "server/chunks/[root-of-the-server]__0-xnw80._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0-xnw80._.js");
      case "server/chunks/[root-of-the-server]__0rc0hk6._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0rc0hk6._.js");
      case "server/chunks/[root-of-the-server]__1rpfej6._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1rpfej6._.js");
      case "server/chunks/_1_vkdwn._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_1_vkdwn._.js");
      case "server/chunks/_next-internal_server_app_api_barber_bookings_[id]_done_route_actions_0imikl4.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_bookings_[id]_done_route_actions_0imikl4.js");
      case "server/chunks/[root-of-the-server]__19un5dl._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__19un5dl._.js");
      case "server/chunks/_next-internal_server_app_api_barber_connect_route_actions_1k1u2uz.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_connect_route_actions_1k1u2uz.js");
      case "server/chunks/[root-of-the-server]__0zqnhhz._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0zqnhhz._.js");
      case "server/chunks/_next-internal_server_app_api_barber_earnings_route_actions_1iouy8o.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_earnings_route_actions_1iouy8o.js");
      case "server/chunks/[root-of-the-server]__1-df59y._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1-df59y._.js");
      case "server/chunks/_next-internal_server_app_api_barber_hours_route_actions_018uj6a.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_hours_route_actions_018uj6a.js");
      case "server/chunks/[root-of-the-server]__02ir3_8._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__02ir3_8._.js");
      case "server/chunks/[root-of-the-server]__1_negnm._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1_negnm._.js");
      case "server/chunks/_next-internal_server_app_api_barber_photos_[id]_route_actions_1_t5qrs.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_photos_[id]_route_actions_1_t5qrs.js");
      case "server/chunks/[root-of-the-server]__01rgrom._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__01rgrom._.js");
      case "server/chunks/_next-internal_server_app_api_barber_photos_route_actions_02v3jtd.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_photos_route_actions_02v3jtd.js");
      case "server/chunks/[root-of-the-server]__1g49xrw._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1g49xrw._.js");
      case "server/chunks/_next-internal_server_app_api_barber_schedule_route_actions_09be2nu.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_schedule_route_actions_09be2nu.js");
      case "server/chunks/[root-of-the-server]__1qrsb18._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1qrsb18._.js");
      case "server/chunks/_next-internal_server_app_api_barber_shop_intent_route_actions_1s5oytl.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_shop_intent_route_actions_1s5oytl.js");
      case "server/chunks/1oeh_server_app_api_barber_shop_orders_[id]_cancel_route_actions_0a4_2fq.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/1oeh_server_app_api_barber_shop_orders_[id]_cancel_route_actions_0a4_2fq.js");
      case "server/chunks/[root-of-the-server]__1r2_5e1._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1r2_5e1._.js");
      case "server/chunks/[externals]__09t8sr3._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[externals]__09t8sr3._.js");
      case "server/chunks/_0eo350_._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_0eo350_._.js");
      case "server/chunks/_next-internal_server_app_api_barber_shop_orders_route_actions_0clg_a0.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_shop_orders_route_actions_0clg_a0.js");
      case "server/chunks/[root-of-the-server]__0nb2_cj._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0nb2_cj._.js");
      case "server/chunks/_next-internal_server_app_api_barber_shop_products_route_actions_0qg-ftk.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_shop_products_route_actions_0qg-ftk.js");
      case "server/chunks/[root-of-the-server]__1_6yf2v._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1_6yf2v._.js");
      case "server/chunks/_next-internal_server_app_api_barber_signup_route_actions_1ncllwb.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_signup_route_actions_1ncllwb.js");
      case "server/chunks/[root-of-the-server]__0jff8mu._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0jff8mu._.js");
      case "server/chunks/_next-internal_server_app_api_barber_skills_photo_route_actions_0iac-y2.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_skills_photo_route_actions_0iac-y2.js");
      case "server/chunks/[root-of-the-server]__1lmjadm._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1lmjadm._.js");
      case "server/chunks/_next-internal_server_app_api_barber_skills_route_actions_0zwlbzr.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_skills_route_actions_0zwlbzr.js");
      case "server/chunks/[root-of-the-server]__10m-ni5._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__10m-ni5._.js");
      case "server/chunks/_next-internal_server_app_api_barber_skills_submit_route_actions_09o-n2v.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barber_skills_submit_route_actions_09o-n2v.js");
      case "server/chunks/[root-of-the-server]__1doqa54._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1doqa54._.js");
      case "server/chunks/_next-internal_server_app_api_barbers_[id]_slots_route_actions_0zv4ob8.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barbers_[id]_slots_route_actions_0zv4ob8.js");
      case "server/chunks/[root-of-the-server]__0gi7c6q._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0gi7c6q._.js");
      case "server/chunks/_next-internal_server_app_api_barbers_route_actions_1606omp.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_barbers_route_actions_1606omp.js");
      case "server/chunks/[externals]__1d5p0kd._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[externals]__1d5p0kd._.js");
      case "server/chunks/_0zwwghx._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_0zwwghx._.js");
      case "server/chunks/_next-internal_server_app_api_bookings_[id]_route_actions_1h9a10_.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_bookings_[id]_route_actions_1h9a10_.js");
      case "server/chunks/[root-of-the-server]__0dsu21_._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0dsu21_._.js");
      case "server/chunks/_next-internal_server_app_api_bookings_recent_route_actions_04sy2ty.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_bookings_recent_route_actions_04sy2ty.js");
      case "server/chunks/[root-of-the-server]__1ppxi07._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1ppxi07._.js");
      case "server/chunks/_0c3ym06._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_0c3ym06._.js");
      case "server/chunks/_next-internal_server_app_api_bookings_route_actions_1x10bx0.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_bookings_route_actions_1x10bx0.js");
      case "server/chunks/[root-of-the-server]__1nrmw4b._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1nrmw4b._.js");
      case "server/chunks/_next-internal_server_app_api_branches_route_actions_05-jxxr.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_branches_route_actions_05-jxxr.js");
      case "server/chunks/[root-of-the-server]__0qb6bwn._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0qb6bwn._.js");
      case "server/chunks/_02n_m2u._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_02n_m2u._.js");
      case "server/chunks/_next-internal_server_app_api_chats_[bookingId]_route_actions_0wdsz0i.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_chats_[bookingId]_route_actions_0wdsz0i.js");
      case "server/chunks/[root-of-the-server]__04518tp._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__04518tp._.js");
      case "server/chunks/_next-internal_server_app_api_chats_unread_route_actions_0a8q4w4.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_chats_unread_route_actions_0a8q4w4.js");
      case "server/chunks/[root-of-the-server]__1kdzh54._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1kdzh54._.js");
      case "server/chunks/_1fx1vrs._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_1fx1vrs._.js");
      case "server/chunks/_next-internal_server_app_api_complaints_route_actions_0v5v_r2.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_complaints_route_actions_0v5v_r2.js");
      case "server/chunks/[root-of-the-server]__208rdzx._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__208rdzx._.js");
      case "server/chunks/_next-internal_server_app_api_comps_redeem_route_actions_15q3i1x.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_comps_redeem_route_actions_15q3i1x.js");
      case "server/chunks/[root-of-the-server]__1p-w01x._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1p-w01x._.js");
      case "server/chunks/_next-internal_server_app_api_cron_plan-weeks_route_actions_1iqodgt.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_cron_plan-weeks_route_actions_1iqodgt.js");
      case "server/chunks/src_lib_store_ts_1dsgeys._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/src_lib_store_ts_1dsgeys._.js");
      case "server/chunks/[root-of-the-server]__16rg60r._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__16rg60r._.js");
      case "server/chunks/_next-internal_server_app_api_cron_reminders_route_actions_051v7sb.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_cron_reminders_route_actions_051v7sb.js");
      case "server/chunks/[root-of-the-server]__0p6u66_._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0p6u66_._.js");
      case "server/chunks/_next-internal_server_app_api_customer_bookings_route_actions_1saczyi.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_customer_bookings_route_actions_1saczyi.js");
      case "server/chunks/[root-of-the-server]__14j7-t6._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__14j7-t6._.js");
      case "server/chunks/_next-internal_server_app_api_customer_password_route_actions_092oclu.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_customer_password_route_actions_092oclu.js");
      case "server/chunks/_1ztnah7._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_1ztnah7._.js");
      case "server/chunks/_next-internal_server_app_api_customer_profile_route_actions_0lc5gig.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_customer_profile_route_actions_0lc5gig.js");
      case "server/chunks/[root-of-the-server]__0vj1zwi._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0vj1zwi._.js");
      case "server/chunks/_next-internal_server_app_api_gifts_claim_route_actions_1yes8ot.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_gifts_claim_route_actions_1yes8ot.js");
      case "server/chunks/[root-of-the-server]__0394yga._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0394yga._.js");
      case "server/chunks/_next-internal_server_app_api_gifts_intent_route_actions_1vi6a0t.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_gifts_intent_route_actions_1vi6a0t.js");
      case "server/chunks/[root-of-the-server]__09gxq6-._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__09gxq6-._.js");
      case "server/chunks/_next-internal_server_app_api_gifts_mine_route_actions_0tj3ddf.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_gifts_mine_route_actions_0tj3ddf.js");
      case "server/chunks/_100zjez._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_100zjez._.js");
      case "server/chunks/_next-internal_server_app_api_gifts_purchase_route_actions_0v_446-.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_gifts_purchase_route_actions_0v_446-.js");
      case "server/chunks/[externals]__0dj_x0w._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[externals]__0dj_x0w._.js");
      case "server/chunks/[root-of-the-server]__0q8wwr1._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0q8wwr1._.js");
      case "server/chunks/[root-of-the-server]__0yyekge._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0yyekge._.js");
      case "server/chunks/_1li8d4d._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_1li8d4d._.js");
      case "server/chunks/_next-internal_server_app_api_gifts_redeem_route_actions_0os67he.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_gifts_redeem_route_actions_0os67he.js");
      case "server/chunks/[root-of-the-server]__1yehfq3._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1yehfq3._.js");
      case "server/chunks/_next-internal_server_app_api_memberships_cancel_route_actions_1o_qhzr.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_memberships_cancel_route_actions_1o_qhzr.js");
      case "server/chunks/src_lib_store_ts_0aqfq7t._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/src_lib_store_ts_0aqfq7t._.js");
      case "server/chunks/[root-of-the-server]__1220-lc._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1220-lc._.js");
      case "server/chunks/_next-internal_server_app_api_memberships_qr_route_actions_1onvie2.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_memberships_qr_route_actions_1onvie2.js");
      case "server/chunks/src_lib_store_ts_07o4bze._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/src_lib_store_ts_07o4bze._.js");
      case "server/chunks/[root-of-the-server]__1oxk8er._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1oxk8er._.js");
      case "server/chunks/_0up8amk._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_0up8amk._.js");
      case "server/chunks/_next-internal_server_app_api_memberships_redeem_route_actions_0_ss5ln.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_memberships_redeem_route_actions_0_ss5ln.js");
      case "server/chunks/src_lib_payouts_ts_1y_zqip._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/src_lib_payouts_ts_1y_zqip._.js");
      case "server/chunks/[root-of-the-server]__1wtblh7._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1wtblh7._.js");
      case "server/chunks/_next-internal_server_app_api_memberships_status_route_actions_1bwqu0c.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_memberships_status_route_actions_1bwqu0c.js");
      case "server/chunks/src_lib_store_ts_0nioyss._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/src_lib_store_ts_0nioyss._.js");
      case "server/chunks/[root-of-the-server]__1yilttn._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1yilttn._.js");
      case "server/chunks/_next-internal_server_app_api_memberships_subscribe_route_actions_1f628q4.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_memberships_subscribe_route_actions_1f628q4.js");
      case "server/chunks/src_lib_store_ts_0-zrysl._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/src_lib_store_ts_0-zrysl._.js");
      case "server/chunks/[root-of-the-server]__06_9dns._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__06_9dns._.js");
      case "server/chunks/_next-internal_server_app_api_memberships_subscribe-custom_route_actions_1ese3by.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_memberships_subscribe-custom_route_actions_1ese3by.js");
      case "server/chunks/src_lib_store_ts_1xyx4i-._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/src_lib_store_ts_1xyx4i-._.js");
      case "server/chunks/[root-of-the-server]__03l19hl._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__03l19hl._.js");
      case "server/chunks/_next-internal_server_app_api_memberships_sync_route_actions_0as7wu8.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_memberships_sync_route_actions_0as7wu8.js");
      case "server/chunks/src_lib_store_ts_0sbye5y._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/src_lib_store_ts_0sbye5y._.js");
      case "server/chunks/[root-of-the-server]__1vbmv3f._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1vbmv3f._.js");
      case "server/chunks/_next-internal_server_app_api_notifications_subscribe_route_actions_1t4k4gw.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_notifications_subscribe_route_actions_1t4k4gw.js");
      case "server/chunks/[root-of-the-server]__1x0n9db._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1x0n9db._.js");
      case "server/chunks/_next-internal_server_app_api_notifications_unsubscribe_route_actions_0vrquel.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_notifications_unsubscribe_route_actions_0vrquel.js");
      case "server/chunks/[root-of-the-server]__1szw7-l._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1szw7-l._.js");
      case "server/chunks/_next-internal_server_app_api_owner_barbers_[id]_reset_route_actions_1gzwpzm.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_barbers_[id]_reset_route_actions_1gzwpzm.js");
      case "server/chunks/[root-of-the-server]__1l4p7cc._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1l4p7cc._.js");
      case "server/chunks/_next-internal_server_app_api_owner_barbers_[id]_route_actions_1t09i71.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_barbers_[id]_route_actions_1t09i71.js");
      case "server/chunks/[root-of-the-server]__0g7go8w._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0g7go8w._.js");
      case "server/chunks/_next-internal_server_app_api_owner_barbers_route_actions_189u9db.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_barbers_route_actions_189u9db.js");
      case "server/chunks/[root-of-the-server]__0fazr3h._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0fazr3h._.js");
      case "server/chunks/_next-internal_server_app_api_owner_bookings_route_actions_1zi4qjl.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_bookings_route_actions_1zi4qjl.js");
      case "server/chunks/[root-of-the-server]__0t1r0lb._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0t1r0lb._.js");
      case "server/chunks/_next-internal_server_app_api_owner_complaints_[id]_route_actions_01wq_ss.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_complaints_[id]_route_actions_01wq_ss.js");
      case "server/chunks/[root-of-the-server]__1udwxdh._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1udwxdh._.js");
      case "server/chunks/_next-internal_server_app_api_owner_complaints_route_actions_1hpxoe8.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_complaints_route_actions_1hpxoe8.js");
      case "server/chunks/[root-of-the-server]__0ozd9ca._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0ozd9ca._.js");
      case "server/chunks/_next-internal_server_app_api_owner_customers_[id]_reset_route_actions_1i4x_v6.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_customers_[id]_reset_route_actions_1i4x_v6.js");
      case "server/chunks/[root-of-the-server]__0qdrvj9._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0qdrvj9._.js");
      case "server/chunks/_next-internal_server_app_api_owner_customers_[id]_route_actions_0neyege.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_customers_[id]_route_actions_0neyege.js");
      case "server/chunks/[root-of-the-server]__166p308._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__166p308._.js");
      case "server/chunks/_next-internal_server_app_api_owner_customers_route_actions_1w_sa5a.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_customers_route_actions_1w_sa5a.js");
      case "server/chunks/[root-of-the-server]__17j-3e8._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__17j-3e8._.js");
      case "server/chunks/_next-internal_server_app_api_owner_earnings_route_actions_1zi09h4.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_earnings_route_actions_1zi09h4.js");
      case "server/chunks/[root-of-the-server]__0fc2yu0._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0fc2yu0._.js");
      case "server/chunks/_next-internal_server_app_api_owner_memberships_route_actions_0i43-7o.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_memberships_route_actions_0i43-7o.js");
      case "server/chunks/src_lib_store_ts_0m8-j61._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/src_lib_store_ts_0m8-j61._.js");
      case "server/chunks/[root-of-the-server]__1o7m8yb._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1o7m8yb._.js");
      case "server/chunks/_next-internal_server_app_api_owner_partners_leads_[id]_route_actions_1yct4r7.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_partners_leads_[id]_route_actions_1yct4r7.js");
      case "server/chunks/[root-of-the-server]__0n9gpuz._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0n9gpuz._.js");
      case "server/chunks/_next-internal_server_app_api_owner_partners_leads_route_actions_0wv4vnl.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_partners_leads_route_actions_0wv4vnl.js");
      case "server/chunks/[root-of-the-server]__0stycke._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0stycke._.js");
      case "server/chunks/_next-internal_server_app_api_owner_photos_[id]_route_actions_0f-q8lc.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_photos_[id]_route_actions_0f-q8lc.js");
      case "server/chunks/[root-of-the-server]__0c40b5j._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0c40b5j._.js");
      case "server/chunks/_next-internal_server_app_api_owner_photos_route_actions_1n007oo.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_photos_route_actions_1n007oo.js");
      case "server/chunks/[root-of-the-server]__1836n9o._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1836n9o._.js");
      case "server/chunks/_next-internal_server_app_api_owner_reviews_[id]_route_actions_0_q2243.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_reviews_[id]_route_actions_0_q2243.js");
      case "server/chunks/[root-of-the-server]__12qsbbl._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__12qsbbl._.js");
      case "server/chunks/_next-internal_server_app_api_owner_reviews_route_actions_10o6_ju.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_reviews_route_actions_10o6_ju.js");
      case "server/chunks/[root-of-the-server]__1jinhwq._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1jinhwq._.js");
      case "server/chunks/_next-internal_server_app_api_owner_services_[id]_route_actions_1z3_1nn.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_services_[id]_route_actions_1z3_1nn.js");
      case "server/chunks/[root-of-the-server]__1c_c5pu._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1c_c5pu._.js");
      case "server/chunks/_next-internal_server_app_api_owner_services_route_actions_1ecm13m.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_services_route_actions_1ecm13m.js");
      case "server/chunks/1oeh_server_app_api_owner_shop_orders_[id]_cancel_route_actions_0j46c9q.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/1oeh_server_app_api_owner_shop_orders_[id]_cancel_route_actions_0j46c9q.js");
      case "server/chunks/[root-of-the-server]__13oynha._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__13oynha._.js");
      case "server/chunks/1oeh_server_app_api_owner_shop_orders_[id]_confirm_route_actions_11maik4.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/1oeh_server_app_api_owner_shop_orders_[id]_confirm_route_actions_11maik4.js");
      case "server/chunks/[root-of-the-server]__10v26xm._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__10v26xm._.js");
      case "server/chunks/[root-of-the-server]__1zyehku._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1zyehku._.js");
      case "server/chunks/_next-internal_server_app_api_owner_shop_orders_route_actions_0p_9-fd.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_shop_orders_route_actions_0p_9-fd.js");
      case "server/chunks/[root-of-the-server]__12xabrg._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__12xabrg._.js");
      case "server/chunks/_next-internal_server_app_api_owner_shop_products_[id]_route_actions_0a1ow1b.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_shop_products_[id]_route_actions_0a1ow1b.js");
      case "server/chunks/[root-of-the-server]__17_vz-h._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__17_vz-h._.js");
      case "server/chunks/_next-internal_server_app_api_owner_shop_products_route_actions_1dumjy_.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_shop_products_route_actions_1dumjy_.js");
      case "server/chunks/[root-of-the-server]__0-ry7d9._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0-ry7d9._.js");
      case "server/chunks/_next-internal_server_app_api_owner_skills_[id]_route_actions_1kj08xe.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_skills_[id]_route_actions_1kj08xe.js");
      case "server/chunks/[root-of-the-server]__1024vxq._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1024vxq._.js");
      case "server/chunks/_next-internal_server_app_api_owner_skills_route_actions_18wdkcl.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_owner_skills_route_actions_18wdkcl.js");
      case "server/chunks/[root-of-the-server]__1s9l9zp._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1s9l9zp._.js");
      case "server/chunks/_next-internal_server_app_api_partners_lead_route_actions_0ytp07n.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_partners_lead_route_actions_0ytp07n.js");
      case "server/chunks/_0918i29._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_0918i29._.js");
      case "server/chunks/_next-internal_server_app_api_payments_collect_route_actions_03g8y7q.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_payments_collect_route_actions_03g8y7q.js");
      case "server/chunks/[root-of-the-server]__1b35u73._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1b35u73._.js");
      case "server/chunks/_next-internal_server_app_api_payments_collect-token_route_actions_1tpkfeb.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_payments_collect-token_route_actions_1tpkfeb.js");
      case "server/chunks/_1rsqhw7._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_1rsqhw7._.js");
      case "server/chunks/_next-internal_server_app_api_payments_intent_route_actions_0ar03ko.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_payments_intent_route_actions_0ar03ko.js");
      case "server/chunks/[root-of-the-server]__02oq1ol._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__02oq1ol._.js");
      case "server/chunks/_next-internal_server_app_api_photos_[___path]_route_actions_0mm69pq.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_photos_[___path]_route_actions_0mm69pq.js");
      case "server/chunks/[root-of-the-server]__1obw-ts._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1obw-ts._.js");
      case "server/chunks/_next-internal_server_app_api_reviews_route_actions_0yv3cz6.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_reviews_route_actions_0yv3cz6.js");
      case "server/chunks/[root-of-the-server]__1k379-k._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1k379-k._.js");
      case "server/chunks/_next-internal_server_app_api_services_route_actions_045zq8g.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_services_route_actions_045zq8g.js");
      case "server/chunks/_1am9n80._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_1am9n80._.js");
      case "server/chunks/_next-internal_server_app_api_team-chat_route_actions_1zg8qlw.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_team-chat_route_actions_1zg8qlw.js");
      case "server/chunks/[root-of-the-server]__1abpxkq._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__1abpxkq._.js");
      case "server/chunks/_next-internal_server_app_api_team-chat_unread_route_actions_0xclqc1.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_team-chat_unread_route_actions_0xclqc1.js");
      case "server/chunks/[root-of-the-server]__01l2q51._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__01l2q51._.js");
      case "server/chunks/_next-internal_server_app_api_thanks_route_actions_1sf6uwe.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_thanks_route_actions_1sf6uwe.js");
      case "server/chunks/src_lib_store_ts_04nk_g6._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/src_lib_store_ts_04nk_g6._.js");
      case "server/chunks/[root-of-the-server]__0voq7f8._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0voq7f8._.js");
      case "server/chunks/_157gigh._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_157gigh._.js");
      case "server/chunks/_next-internal_server_app_api_tips_route_actions_0b5jy5o.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_api_tips_route_actions_0b5jy5o.js");
      case "server/chunks/ssr/[root-of-the-server]__0ln2jy-._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__0ln2jy-._.js");
      case "server/chunks/ssr/_0i326a0._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_0i326a0._.js");
      case "server/chunks/ssr/_0pswpyq._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_0pswpyq._.js");
      case "server/chunks/ssr/_next-internal_server_app_barber_dashboard_page_actions_06d89mg.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_barber_dashboard_page_actions_06d89mg.js");
      case "server/chunks/ssr/src_app_barber_layout_tsx_0tyoyzu._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_app_barber_layout_tsx_0tyoyzu._.js");
      case "server/chunks/ssr/src_components_1xe_cgh._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_components_1xe_cgh._.js");
      case "server/chunks/ssr/[root-of-the-server]__0lms7g3._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__0lms7g3._.js");
      case "server/chunks/ssr/_next-internal_server_app_barber_page_actions_0dar-7h.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_barber_page_actions_0dar-7h.js");
      case "server/chunks/ssr/src_app_barber_page_tsx_1hunlh2._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_app_barber_page_tsx_1hunlh2._.js");
      case "server/chunks/ssr/[root-of-the-server]__1z71twg._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__1z71twg._.js");
      case "server/chunks/ssr/_next-internal_server_app_barber_signup_page_actions_0ru5fje.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_barber_signup_page_actions_0ru5fje.js");
      case "server/chunks/ssr/src_app_barber_signup_page_tsx_157pgnh._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_app_barber_signup_page_tsx_157pgnh._.js");
      case "server/chunks/ssr/[root-of-the-server]__09-p1pf._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__09-p1pf._.js");
      case "server/chunks/ssr/_next-internal_server_app_customer_appointments_page_actions_1_qtuu4.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_customer_appointments_page_actions_1_qtuu4.js");
      case "server/chunks/ssr/node_modules_qrcode_react_lib_esm_index_14qk37x.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/node_modules_qrcode_react_lib_esm_index_14qk37x.js");
      case "server/chunks/ssr/src_0jhogit._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_0jhogit._.js");
      case "server/chunks/ssr/src_10otsqy._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_10otsqy._.js");
      case "server/chunks/ssr/src_components_AiAssistant_tsx_02-mli3._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_components_AiAssistant_tsx_02-mli3._.js");
      case "server/chunks/ssr/[root-of-the-server]__1lcd-h4._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__1lcd-h4._.js");
      case "server/chunks/ssr/_next-internal_server_app_customer_book_[barberId]_page_actions_0oh99zr.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_customer_book_[barberId]_page_actions_0oh99zr.js");
      case "server/chunks/ssr/src_app_customer_book_[barberId]_page_tsx_0rclmb8._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_app_customer_book_[barberId]_page_tsx_0rclmb8._.js");
      case "server/chunks/ssr/src_components_0efc0tt._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_components_0efc0tt._.js");
      case "server/chunks/ssr/[root-of-the-server]__07yhs2h._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__07yhs2h._.js");
      case "server/chunks/ssr/_next-internal_server_app_customer_branch_[branchId]_page_actions_0nh96b4.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_customer_branch_[branchId]_page_actions_0nh96b4.js");
      case "server/chunks/ssr/src_1e--sx8._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_1e--sx8._.js");
      case "server/chunks/ssr/[root-of-the-server]__1uay5zm._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__1uay5zm._.js");
      case "server/chunks/ssr/_next-internal_server_app_customer_gifts_claim_page_actions_1uppw11.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_customer_gifts_claim_page_actions_1uppw11.js");
      case "server/chunks/ssr/src_13i4b6o._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_13i4b6o._.js");
      case "server/chunks/ssr/[root-of-the-server]__20d-27-._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__20d-27-._.js");
      case "server/chunks/ssr/_next-internal_server_app_customer_gifts_page_actions_0x6_nec.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_customer_gifts_page_actions_0x6_nec.js");
      case "server/chunks/ssr/src_1hiqjys._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_1hiqjys._.js");
      case "server/chunks/ssr/[root-of-the-server]__1r648yh._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__1r648yh._.js");
      case "server/chunks/ssr/_next-internal_server_app_customer_login_page_actions_1r81mlf.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_customer_login_page_actions_1r81mlf.js");
      case "server/chunks/ssr/src_app_customer_login_page_tsx_00_c969._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_app_customer_login_page_tsx_00_c969._.js");
      case "server/chunks/ssr/[root-of-the-server]__028ssn3._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__028ssn3._.js");
      case "server/chunks/ssr/_next-internal_server_app_customer_offers_page_actions_1lukjy0.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_customer_offers_page_actions_1lukjy0.js");
      case "server/chunks/ssr/src_app_customer_offers_page_tsx_1yxbxyt._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_app_customer_offers_page_tsx_1yxbxyt._.js");
      case "server/chunks/ssr/src_components_Loading_tsx_1u0er1n._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_components_Loading_tsx_1u0er1n._.js");
      case "server/chunks/ssr/[root-of-the-server]__1_qwtn7._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__1_qwtn7._.js");
      case "server/chunks/ssr/_08qav7l._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_08qav7l._.js");
      case "server/chunks/ssr/_next-internal_server_app_customer_page_actions_0ovvd05.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_customer_page_actions_0ovvd05.js");
      case "server/chunks/ssr/[root-of-the-server]__0tyjbqw._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__0tyjbqw._.js");
      case "server/chunks/ssr/_next-internal_server_app_customer_profile_page_actions_0czm10w.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_customer_profile_page_actions_0czm10w.js");
      case "server/chunks/ssr/src_app_customer_profile_page_tsx_0bk8hzy._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_app_customer_profile_page_tsx_0bk8hzy._.js");
      case "server/chunks/ssr/src_components_1-k202m._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_components_1-k202m._.js");
      case "server/chunks/ssr/[root-of-the-server]__1md83o2._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__1md83o2._.js");
      case "server/chunks/ssr/_00oup_f._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_00oup_f._.js");
      case "server/chunks/ssr/_next-internal_server_app_customer_settings_page_actions_1tadk0l.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_customer_settings_page_actions_1tadk0l.js");
      case "server/chunks/ssr/[root-of-the-server]__18ww7xp._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__18ww7xp._.js");
      case "server/chunks/ssr/_next-internal_server_app_customer_thanks_page_actions_0_-xnke.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_customer_thanks_page_actions_0_-xnke.js");
      case "server/chunks/ssr/src_app_customer_thanks_page_tsx_1fsd32t._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_app_customer_thanks_page_tsx_1fsd32t._.js");
      case "server/chunks/_0uxp3uh._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_0uxp3uh._.js");
      case "server/chunks/_next-internal_server_app_favicon_ico_route_actions_0g2jjls.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_favicon_ico_route_actions_0g2jjls.js");
      case "server/chunks/[root-of-the-server]__0q6v0kc._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/[root-of-the-server]__0q6v0kc._.js");
      case "server/chunks/_next-internal_server_app_icon_svg_route_actions_1r2h_ub.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/_next-internal_server_app_icon_svg_route_actions_1r2h_ub.js");
      case "server/chunks/ssr/[root-of-the-server]__1xmvna7._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__1xmvna7._.js");
      case "server/chunks/ssr/_next-internal_server_app_owner_dashboard_page_actions_1c87w3t.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_owner_dashboard_page_actions_1c87w3t.js");
      case "server/chunks/ssr/src_app_owner_dashboard_page_tsx_06fn401._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_app_owner_dashboard_page_tsx_06fn401._.js");
      case "server/chunks/ssr/src_app_owner_layout_tsx_02sf2bg._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_app_owner_layout_tsx_02sf2bg._.js");
      case "server/chunks/ssr/src_components_1jomli6._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_components_1jomli6._.js");
      case "server/chunks/ssr/[root-of-the-server]__0yxvlht._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__0yxvlht._.js");
      case "server/chunks/ssr/_next-internal_server_app_owner_page_actions_0nzi9co.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_owner_page_actions_0nzi9co.js");
      case "server/chunks/ssr/src_app_owner_page_tsx_08b9xau._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_app_owner_page_tsx_08b9xau._.js");
      case "server/chunks/ssr/[root-of-the-server]__10x-6sf._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__10x-6sf._.js");
      case "server/chunks/ssr/_1_mdye7._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_1_mdye7._.js");
      case "server/chunks/ssr/_next-internal_server_app_page_actions_0hhsz1j.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_page_actions_0hhsz1j.js");
      case "server/chunks/ssr/[root-of-the-server]__1lm462-._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/[root-of-the-server]__1lm462-._.js");
      case "server/chunks/ssr/_next-internal_server_app_partners_page_actions_1hexh3l.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/_next-internal_server_app_partners_page_actions_1hexh3l.js");
      case "server/chunks/ssr/src_app_partners_page_tsx_1vftoii._.js": return require("/home/hatch/workspace/mrc-barbershop/.open-next/server-functions/default/.next/server/chunks/ssr/src_app_partners_page_tsx_1vftoii._.js");
      default:
        throw new Error(`Not found ${chunkPath}`);
    }
  }


  async function loadWasmChunk(chunkPath) {
    switch (chunkPath) {

      default:
        throw new Error(`Unknown wasm chunk: ${chunkPath}`);
    }
  }
