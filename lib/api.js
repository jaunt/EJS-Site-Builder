"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AirFry = exports.TriggerReason = exports.POST_GENERATE_NAME = exports.PRE_GENERATE_NAME = exports.POST_GENERATE_JS = exports.PRE_GENERATE_JS = void 0;
const ejs_1 = __importDefault(require("ejs"));
const vm_1 = __importDefault(require("vm"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const front_matter_1 = __importDefault(require("front-matter"));
const chalk_1 = __importDefault(require("chalk"));
const micromatch_1 = __importDefault(require("micromatch"));
const shared_ts_1 = require("@danglingdev/shared-ts");
const loggers = (0, shared_ts_1.makeLoggers)("@ ");
const log = loggers.log;
const logError = loggers.logError;
exports.PRE_GENERATE_JS = "preGenerate.js";
exports.POST_GENERATE_JS = "postGenerate.js";
exports.PRE_GENERATE_NAME = "PRE_GENERATE";
exports.POST_GENERATE_NAME = "POST_GENERATE";
const libDir = "/js";
const SCRIPT_ENTRY = "<script entry>";
const SCRIPT_ENTRY_LENGTH = SCRIPT_ENTRY.length;
const SCRIPT_LIB = "<script lib>";
const SCRIPT_LIB_LENGTH = SCRIPT_LIB.length;
const SCRIPT_GENERATE = "<script generate>";
const SCRIPT_GENERATE_LENGTH = SCRIPT_GENERATE.length;
const SCRIPT_GENERATE_USE = "<script generate-use:";
const SCRIPT_GENERATE_USE_LENGTH = SCRIPT_GENERATE_USE.length;
const SCRIPT_GENERATE_USE_REGEX = /^"([\w-]+(\/([\w-]+))+)">$/;
const END_SCRIPT = "</script>";
const END_SCRIPT_LENGTH = END_SCRIPT.length;
const EXTRACT_SCRIPT = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
var TriggerReason;
(function (TriggerReason) {
    TriggerReason[TriggerReason["Added"] = 0] = "Added";
    TriggerReason[TriggerReason["Modified"] = 1] = "Modified";
    TriggerReason[TriggerReason["Deleted"] = 2] = "Deleted";
})(TriggerReason = exports.TriggerReason || (exports.TriggerReason = {}));
function safeOutputCheck(func, outPath, path, ...args) {
    if (!(0, shared_ts_1.isRelative)(outPath, path)) {
        throw "Trying to write " + path + " which is outside of " + outPath;
    }
    func(path, ...args);
}
function stringifyFuncs(_, v) {
    if (typeof v === "function") {
        return "render function";
    }
    return v;
}
class AirFry {
    constructor(inputDir, dataDir, outputDir, cacheDir, verbose) {
        this.state = {
            generateScripts: {},
            generateScriptRefs: {},
            entryScripts: {},
            templateDepTree: {},
            pathDepTree: {},
            wildDepTree: {},
            globalDeps: {},
            frontMatter: {},
            templates: {},
            toGenerate: {},
            globalData: {},
            cache: {},
            outputData: {
                html: [],
                entry: [],
                lib: [],
                json: [],
                outData: {},
            },
            errorCount: 0,
        };
        this.inputDir = inputDir;
        this.dataDir = dataDir;
        this.outputDir = outputDir;
        this.cacheDir = cacheDir;
        this.outPath = path_1.default.resolve("./" + this.outputDir);
        this.verbose = verbose;
        this.loadCache();
    }
    getErrorCount() {
        return this.state.errorCount;
    }
    writeFileSafe(path, ...args) {
        safeOutputCheck(fs_1.default.writeFile, this.outputDir, path, ...args);
    }
    mkdirSyncSafe(path, ...args) {
        safeOutputCheck(fs_1.default.mkdirSync, this.outputDir, path, ...args);
    }
    /// ----------------------------------------------------------------------------
    /// Safety to prevent user from accidently
    /// writing files outside the output directory
    /// ----------------------------------------------------------------------------
    getDataFileNames(source, globList) {
        const resData = path_1.default.resolve(this.dataDir);
        let files = (0, shared_ts_1.getAllFiles)(resData);
        if (globList) {
            let fixedGlobs;
            if (!Array.isArray(globList)) {
                fixedGlobs = [globList];
            }
            else {
                fixedGlobs = globList;
            }
            fixedGlobs = fixedGlobs.map((glob) => {
                return resData + "/" + glob;
            });
            files = (0, micromatch_1.default)(files, fixedGlobs);
        }
        if (files.length == 0) {
            logError(chalk_1.default.red("Warning, " +
                source +
                ".ejs requested data files but none were found at " +
                this.dataDir));
        }
        return files;
    }
    getTemplateFileName(file) {
        const p = path_1.default.join("./", this.inputDir, "/", file);
        return p;
    }
    /// -----------------------------------------------------------------------------
    /// Caching
    /// -----------------------------------------------------------------------------
    expireCache() {
        for (const pageName in this.state.cache) {
            const pageCache = this.state.cache[pageName];
            for (const itemName in pageCache) {
                const expires = pageCache[itemName].expires;
                if (expires) {
                    if (!isNaN(expires)) {
                        const now = new Date().getTime();
                        if (now > expires) {
                            log(chalk_1.default.green("Expired " + pageName + " cache item: " + itemName));
                            delete pageCache[itemName];
                        }
                    }
                    else {
                        throw new Error(pageName + " cache item " + itemName + " expires date is invalid");
                    }
                }
            }
        }
    }
    loadCache() {
        const p = path_1.default.resolve(this.cacheDir);
        if (fs_1.default.existsSync(p + "/cache.json")) {
            let rawdata = fs_1.default.readFileSync(p + "/cache.json");
            if (rawdata && rawdata.length > 0) {
                this.state.cache = JSON.parse(rawdata.toString());
            }
        }
    }
    // call before exiting
    storeCache() {
        const p = path_1.default.resolve(this.cacheDir);
        let data = JSON.stringify(this.state.cache);
        if (data) {
            if (!fs_1.default.existsSync(this.cacheDir)) {
                log(chalk_1.default.green("Making cache dir: " + p));
                fs_1.default.mkdirSync(this.cacheDir, { recursive: true });
            }
            log(chalk_1.default.green("Writing cache: " + p + "/cache.json"));
            fs_1.default.writeFileSync(this.cacheDir + "/cache.json", data);
        }
    }
    /// -----------------------------------------------------------------------------
    /// Helpers
    /// -----------------------------------------------------------------------------
    getGlobalDataAccessProxy(name) {
        // a proxy to detect access to global data from scripts
        const state = this.state;
        const globalDataAccessHandler = {
            get: function (...args) {
                // access to global deps was detected
                if (!state.globalData[args[1]]) {
                    throw "Accessing undefined global data Element: " + args[1];
                }
                state.globalDeps[name] = true;
                return Reflect.get.apply(null, args);
            },
        };
        return new Proxy(state.globalData, globalDataAccessHandler);
    }
    chalkUpError(name, error) {
        // Show generate script errors nicely.
        logError("\nScript Error: " + chalk_1.default.bgBlack.red(name));
        if (error.message) {
            log(chalk_1.default.bgBlack.white(error.message));
        }
        if (typeof error == "string") {
            log(chalk_1.default.bgBlack.white(error));
        }
        if (error.stack) {
            try {
                const lines = error.stack.split("\n");
                const errorLine = Number(lines[0].split(":")[1]) - 1;
                const script = this.getGenerateScript(name).split("\n");
                script.forEach((line, index) => {
                    if (index == errorLine) {
                        log(chalk_1.default.bgBlack.red(line));
                    }
                    else {
                        log(chalk_1.default.bgBlack.blue(line));
                    }
                });
            }
            catch {
                this.state.errorCount++;
                log(chalk_1.default.red(error.stack));
            }
        }
    }
    scriptLogger(name) {
        // Format log messages from generate script.
        const args = Array.from(arguments);
        log(chalk_1.default.yellow(name) + chalk_1.default.white(": " + args[1]), ...args.slice(2));
    }
    fixPath(path) {
        // trim trailing path if it exists.
        // this should allow us to work no matter how
        // the user specified generate paths
        if (path.length && path.slice(-1) == "/") {
            path = path.substring(0, path.length - 1);
            return path;
        }
        return path;
    }
    markDependsOn(template, dependency) {
        if (!this.state.templateDepTree[dependency]) {
            this.state.templateDepTree[dependency] = {};
        }
        this.state.templateDepTree[dependency][template] = true;
    }
    writeEntryScript(template, script, path, name) {
        const writePath = "./" + path_1.default.join(this.outputDir, "/", path);
        if (!fs_1.default.existsSync(writePath)) {
            this.mkdirSyncSafe(writePath, { recursive: true });
        }
        const p = path_1.default.resolve(writePath + "/" + name);
        this.state.outputData.entry.push({ source: template, path: p });
        this.writeFileSafe(p, script, (err) => {
            if (err) {
                this.state.errorCount++;
                logError(chalk_1.default.red("Error writting: " + p));
            }
            else {
                log(chalk_1.default.magenta("Wrote: " + p));
            }
        });
    }
    processEntryScripts(pageName, outPath) {
        // Write out entry scripts (and append wrapper entry scripts)
        const me = this;
        let entryScripts = [];
        if (me.state.entryScripts[pageName] != undefined) {
            if (me.verbose) {
                log(chalk_1.default.yellow("using entry script for '" + pageName + "'"));
            }
            entryScripts.unshift("// entry script: " + pageName + "\n" + me.state.entryScripts[pageName]);
        }
        // find any wrapper entry scripts
        let wrapperRef = pageName;
        while (wrapperRef) {
            const wrapperPage = me.state.frontMatter[wrapperRef].wrapper;
            if (wrapperPage) {
                if (me.state.entryScripts[wrapperPage] != undefined) {
                    if (me.verbose) {
                        log(chalk_1.default.yellow("appending wrapper entry script from '" +
                            wrapperPage +
                            "' for '" +
                            pageName +
                            "'"));
                    }
                    entryScripts.unshift("// entry script: " +
                        wrapperPage +
                        "\n" +
                        me.state.entryScripts[wrapperPage]);
                }
            }
            wrapperRef = wrapperPage;
        }
        if (entryScripts.length) {
            const script = entryScripts.join("\n");
            const scriptName = me.getEntryScriptName(outPath);
            me.writeEntryScript(pageName, script, outPath, scriptName + ".js");
        }
    }
    /// -----------------------------------------------------------------------------
    /// processGeneratorResponse
    ///
    /// Process what was resolved from generator scripts.
    /// Deal with returned promise such as cache, site data, and dependency requests
    /// -----------------------------------------------------------------------------
    processGeneratorResponse(response, name, cacheName) {
        if (!response) {
            return;
        }
        if (response.cache) {
            // page is requesting to update its cache
            this.state.cache[cacheName] = response.cache;
        }
        if (response.outData) {
            this.state.outputData.outData[name] = response.outData;
        }
        if (response.siteFiles) {
            // page is asking to create a json file in the output directory
            const siteFiles = response.siteFiles;
            for (const file in siteFiles) {
                const p = path_1.default.resolve("./" + path_1.default.join(this.outputDir + "/" + file));
                const writePath = path_1.default.parse(p).dir;
                if (!fs_1.default.existsSync(writePath)) {
                    this.mkdirSyncSafe(writePath, { recursive: true });
                }
                this.state.outputData.json.push({ source: name, path: p });
                let writeData;
                if (typeof siteFiles[file] === "string" ||
                    siteFiles[file] instanceof String) {
                    writeData = siteFiles[file];
                }
                else {
                    writeData = JSON.stringify(siteFiles[file]);
                }
                this.writeFileSafe(p, writeData, (err) => {
                    if (err) {
                        this.state.errorCount++;
                        logError(chalk_1.default.red("Error writing template's siteFiles '" + name + "': '" + p));
                    }
                    else {
                        log(chalk_1.default.cyanBright("Wrote: " + p));
                    }
                });
            }
        }
        if (response.watchFiles) {
            response.watchFiles.forEach((file) => {
                const dep = path_1.default.resolve(file);
                if (!this.state.pathDepTree[dep]) {
                    this.state.pathDepTree[dep] = {};
                }
                this.state.pathDepTree[dep][name] = true;
            });
        }
        if (response.watchGlobs) {
            response.watchGlobs.forEach((glob) => {
                if (!this.state.wildDepTree[glob]) {
                    this.state.wildDepTree[glob] = {};
                }
                this.state.wildDepTree[glob][name] = true;
            });
        }
    }
    /// -----------------------------------------------------------------------------
    /// getEntryScriptName
    ///
    /// Get the entry script name for a template
    /// -----------------------------------------------------------------------------
    getEntryScriptName(path) {
        const parts = path.split("/");
        let scriptName = "";
        if (path == "") {
            scriptName = "main";
        }
        else if (parts.length) {
            scriptName = parts[parts.length - 1];
        }
        else {
            scriptName = "main";
        }
        return scriptName;
    }
    /// -----------------------------------------------------------------------------
    /// renderTemplate
    ///
    /// recursively render a template and all its children / wrappers to disk
    /// -----------------------------------------------------------------------------
    renderTemplate(template, path, data) {
        let _progress = template;
        const me = this;
        return new Promise(function (resolve, reject) {
            try {
                const renderRecursive = function (wrapStack, // stack of wrappers
                passedData, // from front matter, global, etc
                current, // included template
                includeData // passed with ejs include
                ) {
                    _progress = current;
                    // Check for _body include
                    if (current == "_body") {
                        if (wrapStack.length == 0) {
                            throw new Error("Wrapper " + template + " was not wrapping anything");
                        }
                        current = wrapStack.pop();
                    }
                    else {
                        // template depends on this dependency
                        me.markDependsOn(template, current);
                        // Wrappers render where _body gets redirected back to wrapped template.
                        // Support nested wrapping.
                        let wrapper = current;
                        let wrapCheck = wrapper;
                        wrapStack = [];
                        while (me.state.frontMatter[wrapCheck].wrapper) {
                            wrapper = me.state.frontMatter[wrapCheck].wrapper;
                            // current depends on this wrapper
                            me.markDependsOn(current, wrapper);
                            wrapStack.push(wrapCheck);
                            wrapCheck = wrapper;
                        }
                        current = wrapper;
                    }
                    // combine data from passed, current front matter, and passed with include
                    const renderData = {
                        ...passedData,
                        ...(me.state.frontMatter[current] || {}),
                        ...(includeData || {}),
                    };
                    return me.state.templates[current](renderData, undefined, renderRecursive.bind(null, wrapStack, renderData));
                };
                path = me.fixPath(path);
                const entryScriptName = me.getEntryScriptName(path);
                const inputVars = {
                    pagePath: path,
                    pageName: template,
                    lastPath: entryScriptName,
                    entryScript: (path == "/" ? "" : path + "/") + entryScriptName + ".js",
                };
                const renderData = {
                    ...inputVars,
                    ...data,
                };
                const html = renderRecursive([], renderData, template);
                const writePath = "./" + path_1.default.join(me.outputDir, "/", path);
                if (!fs_1.default.existsSync(writePath)) {
                    me.mkdirSyncSafe(writePath, { recursive: true });
                }
                const p = path_1.default.resolve(writePath + "/index.html");
                me.state.outputData.html.push({ source: template, path: p });
                me.writeFileSafe(p, html, (err) => {
                    if (err) {
                        reject(err);
                    }
                    else {
                        log(chalk_1.default.magenta("Wrote: " + p));
                        resolve(path);
                    }
                });
            }
            catch (error) {
                me.state.errorCount++;
                logError(chalk_1.default.red.bold(`Error rendering page: ${template}, template: ${_progress}, path: ${path}`));
                logError(chalk_1.default.red(error));
                reject(error);
            }
        });
    }
    /// -----------------------------------------------------------------------------
    /// generatePages
    ///
    /// Generate all cued pages
    /// running generate scripts if specified,
    /// rendering templates to disk.
    /// -----------------------------------------------------------------------------
    generatePages() {
        const me = this;
        return new Promise(function (resolve, _) {
            let toGenerate = Object.values(me.state.toGenerate);
            let toRender = toGenerate.length; // todo list count
            const checkDone = (pageName, outPath = "") => {
                // if a page was generated, process any entry scripts
                if (outPath) {
                    me.processEntryScripts(pageName, outPath);
                }
                // else subtract from todo list
                toRender--;
                if (toRender == 0) {
                    resolve();
                }
            };
            if (toRender == 0) {
                log(chalk_1.default.yellow("\nNothing to do.  Will wait for changes."));
                resolve();
                return;
            }
            const generateSimple = (pageName, path) => {
                // Generate a page that does not have a generate script
                // or returns no page creation data from it
                const data = {
                    global: me.getGlobalDataAccessProxy(pageName),
                    ...me.state.frontMatter[pageName],
                };
                me.renderTemplate(pageName, path, data)
                    .then((fixedPath) => {
                    checkDone(pageName, fixedPath);
                })
                    .catch(() => {
                    checkDone(pageName);
                });
            };
            toGenerate.forEach((generateData) => {
                delete me.state.toGenerate[generateData.name]; // mark completed
                if (me.getGenerateScript(generateData.name)) {
                    let rendered = 0;
                    let pinger = new shared_ts_1.Pinger(generateData.name, (id) => {
                        log(chalk_1.default.yellowBright("Waiting for generator to call resolve: " + id));
                    }, 3000);
                    const generateDone = (response) => {
                        pinger.stop();
                        log(chalk_1.default.yellowBright("Generator Resolved: " + generateData.name));
                        if (rendered == 0) {
                            const pathStars = (generateData.generate.match(/\*/g) || [])
                                .length;
                            if (pathStars > 0) {
                                if (me.verbose) {
                                    log(chalk_1.default.yellowBright("Generate script '" +
                                        generateData.name +
                                        "' requested no pages.  Ignoring."));
                                }
                            }
                            else {
                                if (me.verbose) {
                                    log(chalk_1.default.yellow("Rendering template " +
                                        generateData.name +
                                        " with absolute generate path after running its generate script."));
                                }
                                toRender++; // need to generate just one page
                                generateSimple(generateData.name, generateData.generate);
                            }
                        }
                        // callback on generate script complete
                        me.processGeneratorResponse(response, generateData.name, me.getCacheName(generateData.name));
                        checkDone(generateData.name, "");
                    };
                    const generatePages = (response) => {
                        log(chalk_1.default.yellowBright("Generating batch pages for: " + generateData.name));
                        let pages;
                        if (!Array.isArray(response)) {
                            // script specified a single page to generate
                            pages = [response];
                        }
                        else {
                            // script specified an array of pages to generate
                            pages = response;
                        }
                        const pathStars = (generateData.generate.match(/\*/g) || []).length;
                        if (pathStars > 1) {
                            throw new Error("Generate paths can only include a single path replacement *" +
                                generateData.name);
                        }
                        else if (pathStars == 0) {
                            throw new Error("Generate paths must include a path replacement * when generating 1 or more pages from data." +
                                generateData.name);
                        }
                        else {
                            if (pages.length == 0) {
                                if (me.verbose) {
                                    log(chalk_1.default.yellow("Generate script " +
                                        generateData.name +
                                        " requesting zero pages to render"));
                                }
                            }
                            else {
                                toRender += pages.length; // add extra pages to todo list
                                pages.forEach((generatePageRequest) => {
                                    const data = {
                                        global: me.getGlobalDataAccessProxy(generateData.name),
                                        ...generatePageRequest.data,
                                        ...me.state.frontMatter[generateData.name],
                                    };
                                    const starReplacedPath = generateData.generate.replace(/\*/, generatePageRequest.path);
                                    rendered++;
                                    me.renderTemplate(generateData.name, starReplacedPath, data)
                                        .then((fixedPath) => {
                                        checkDone(generateData.name, fixedPath);
                                    })
                                        .catch(() => {
                                        checkDone(generateData.name, "");
                                    });
                                });
                            }
                        }
                    };
                    const generateError = (error) => {
                        pinger.stop();
                        me.chalkUpError(generateData.name, error);
                        checkDone(generateData.name);
                    };
                    if (!me.state.cache[me.getCacheName(generateData.name)]) {
                        me.state.cache[me.getCacheName(generateData.name)] = {};
                    }
                    let reason = "";
                    if (generateData.triggeredBy) {
                        switch (generateData.reason) {
                            case TriggerReason.Added:
                                reason = "Added";
                                break;
                            case TriggerReason.Modified:
                                reason = "Modified";
                                break;
                            case TriggerReason.Deleted:
                                reason = "Deleted";
                                break;
                        }
                    }
                    const inputs = {
                        triggeredBy: generateData.triggeredBy
                            ? {
                                path: generateData.triggeredBy,
                                reason: reason,
                            }
                            : undefined,
                        frontMatter: me.state.frontMatter[generateData.name],
                        global: me.getGlobalDataAccessProxy(generateData.name),
                    };
                    const code = "((require, resolve, reject, generate, inputs, getDataFileNames, cache, log, frontMatterParse, dataDir) =>  {" +
                        me.getGenerateScript(generateData.name) +
                        "})";
                    me.expireCache();
                    try {
                        vm_1.default.runInThisContext(code)(require, generateDone, // set done
                        generateError, generatePages, // render array of pages and continue
                        inputs, me.getDataFileNames.bind(me, generateData.name), me.state.cache[me.getCacheName(generateData.name)], me.scriptLogger.bind(null, generateData.name), front_matter_1.default, path_1.default.resolve(me.dataDir));
                    }
                    catch (error) {
                        me.state.errorCount++;
                        if (error instanceof Error) {
                            generateError(error);
                        }
                        else {
                            logError(chalk_1.default.red("Unknown error " + error));
                            generateError(new Error("unknown error"));
                        }
                    }
                }
                else if (generateData.generate) {
                    generateSimple(generateData.name, generateData.generate);
                }
            });
        });
    }
    /// -----------------------------------------------------------------------------
    /// compileTemplate
    ///
    /// Pre-compile an EJS template
    /// -----------------------------------------------------------------------------
    compileTemplate(source, name) {
        // Pre compile ejs template
        try {
            const fn = ejs_1.default.compile(source, { client: true });
            this.state.templates[name] = fn;
        }
        catch (error) {
            this.state.errorCount++;
            logError(chalk_1.default.red(`${error.message?.split("\n")[0]} in ${name}`));
        }
    }
    /// -----------------------------------------------------------------------------
    /// cueGeneration
    ///
    /// Mark a page to be generated
    /// -----------------------------------------------------------------------------
    cueGeneration(name, triggeredBy = "", reason = TriggerReason.Modified) {
        const generate = this.state.frontMatter[name].generate;
        if (generate) {
            this.state.toGenerate[name] = {
                name: name,
                generate: generate,
                triggeredBy: triggeredBy,
                reason: reason,
            };
        }
    }
    /// -----------------------------------------------------------------------------
    /// getGenerateScript
    ///
    /// Get cache name -- all scripts referring to another script share it's cache
    /// -----------------------------------------------------------------------------
    getCacheName(name) {
        if (this.state.generateScripts[name]) {
            return "_" + name;
        }
        const ref = this.state.generateScriptRefs[name];
        if (ref) {
            if (this.state.generateScripts[ref]) {
                if (this.verbose) {
                    log(chalk_1.default.yellow("using reference cache '" + ref + "' for '" + name + "'"));
                }
                return "_" + ref;
            }
        }
        logError("Unexpected attempt to get cache for non script: " + name);
        return "_ERROR";
    }
    /// -----------------------------------------------------------------------------
    /// getGenerateScript
    ///
    /// Get script for template, either direct or referred
    /// -----------------------------------------------------------------------------
    getGenerateScript(name) {
        if (this.state.generateScripts[name]) {
            return this.state.generateScripts[name];
        }
        const ref = this.state.generateScriptRefs[name];
        if (ref) {
            if (this.state.generateScripts[ref]) {
                if (this.verbose) {
                    log(chalk_1.default.yellow("using reference generate script '" + ref + "' for '" + name + "'"));
                }
                return this.state.generateScripts[ref];
            }
        }
        return "";
    }
    /// -----------------------------------------------------------------------------
    /// processScript
    ///
    /// Process a script tag found in a template file.
    /// - Generate scripts are stored,
    /// - site scripts are state to output.
    /// -----------------------------------------------------------------------------
    processScript(source, name) {
        if (source.startsWith(SCRIPT_GENERATE)) {
            // add generate source to build map
            const stripped = source.slice(SCRIPT_GENERATE_LENGTH, -END_SCRIPT_LENGTH);
            this.state.generateScripts[name] = stripped;
            return true;
        }
        if (source.startsWith(SCRIPT_GENERATE_USE)) {
            // refer to an existing script
            const stripped = source
                .slice(SCRIPT_GENERATE_USE_LENGTH, -END_SCRIPT_LENGTH)
                .trim();
            const match = stripped.match(SCRIPT_GENERATE_USE_REGEX);
            if (match) {
                const dependency = match[1];
                this.state.generateScriptRefs[name] = dependency;
                // add source of generate script as a dependency
                this.markDependsOn(name, dependency);
            }
            else {
                logError(chalk_1.default.red("Generate-use script template in: '" +
                    name +
                    "' not specified correctly.  See: (https://jaunt.github.io/airfry/docs/input/templates)"));
            }
            return true;
        }
        if (source.startsWith(SCRIPT_ENTRY)) {
            // add entry source to build map
            const stripped = source.slice(SCRIPT_ENTRY_LENGTH, -END_SCRIPT_LENGTH);
            this.state.entryScripts[name] = stripped;
            return true;
        }
        else if (source.startsWith(SCRIPT_LIB)) {
            // create <file>.js for any component source in output/js
            const stripped = source.slice(SCRIPT_LIB_LENGTH, -END_SCRIPT_LENGTH);
            const parsed = path_1.default.parse(name);
            const dir = parsed.dir;
            if (!fs_1.default.existsSync(this.outputDir + libDir + "/" + dir)) {
                this.mkdirSyncSafe(this.outputDir + libDir + "/" + dir, {
                    recursive: true,
                });
            }
            const p = path_1.default.resolve(this.outputDir + libDir + "/" + name + ".js");
            this.state.outputData.lib.push({ source: name, path: p });
            this.writeFileSafe(p, stripped, (err) => {
                if (err) {
                    this.state.errorCount++;
                    logError(chalk_1.default.red(err));
                }
                log(chalk_1.default.cyan("Wrote: " + p));
            });
            return true;
        }
        return false;
    }
    /// -----------------------------------------------------------------------------
    /// testTemplate
    ///
    /// Make sure extension is ejs and format the name the way we like it.
    /// -----------------------------------------------------------------------------
    testTemplate(file) {
        const parsed = path_1.default.parse(file);
        const rel = path_1.default.relative(this.inputDir, parsed.dir);
        const name = rel + (rel ? "/" : "") + parsed.name;
        const ext = path_1.default.parse(file).ext;
        if (ext == ".ejs") {
            return name;
        }
        return undefined;
    }
    /// -----------------------------------------------------------------------------
    /// processDeletedTemplatePromise
    ///
    /// Remove template from site data
    /// -----------------------------------------------------------------------------
    processDeletedTemplatePromise(template) {
        // clean up template state
        delete this.state.generateScripts[template];
        delete this.state.generateScriptRefs[template];
        delete this.state.entryScripts[template];
        for (let key in this.state.pathDepTree) {
            delete this.state.pathDepTree[key][template];
        }
        for (let key in this.state.wildDepTree) {
            delete this.state.wildDepTree[key][template];
        }
        delete this.state.globalDeps[template];
        delete this.state.frontMatter[template];
        delete this.state.toGenerate[template];
        delete this.state.cache[this.getCacheName(template)];
        delete this.state.outputData.outData[template];
    }
    /// -----------------------------------------------------------------------------
    /// processTemplateFilesPromise
    ///
    /// Process all template files found under input directory,
    /// or a single file if we had been watching it for changes.
    /// -----------------------------------------------------------------------------
    processTemplateFilesPromise(file = undefined) {
        const me = this;
        return new Promise(function (resolve, reject) {
            let list = [];
            if (file == undefined) {
                try {
                    list = (0, shared_ts_1.getAllFiles)(me.inputDir);
                }
                catch (error) {
                    me.state.errorCount++;
                    logError(chalk_1.default.red("Could not scan " + me.inputDir));
                }
            }
            else {
                list = [file];
            }
            const names = [];
            let pending = list.length;
            const checkDone = (name) => {
                if (name) {
                    names.push(name);
                }
                pending--;
                if (pending <= 0) {
                    resolve(names);
                }
            };
            if (list.length == 0) {
                resolve([]);
                return;
            }
            log(chalk_1.default.green(`Processing ${pending} input files.`));
            list.forEach((file) => {
                const name = me.testTemplate(file);
                if (name) {
                    fs_1.default.readFile(file, "utf8", function (err, data) {
                        if (err)
                            reject(err);
                        const content = (0, front_matter_1.default)(data);
                        me.state.frontMatter[name] =
                            content.attributes;
                        const body = content.body;
                        const remove = [];
                        const replacer = (match, offset) => {
                            const used = me.processScript(match, name);
                            if (used) {
                                const first = offset;
                                const second = offset + match.length;
                                remove.push([first, second]);
                            }
                            return "";
                        };
                        body.replace(EXTRACT_SCRIPT, replacer);
                        // piece together template without scripts
                        let template = "";
                        let index = 0;
                        if (remove.length > 0) {
                            remove.forEach((script) => {
                                template += body.substr(index, script[0] - index);
                                index = script[1];
                            });
                        }
                        else
                            template = body;
                        log("compiling template: " + name);
                        me.compileTemplate(template.trim(), name);
                        me.cueGeneration(name);
                        checkDone(name);
                    });
                }
                else {
                    checkDone();
                }
            });
        });
    }
    /// -----------------------------------------------------------------------------
    /// processPreGenerate
    ///
    /// preGenerate.js creates global data for all generate scripts.
    /// If changed via watcher, make sure to re-generate
    /// any pages that asked to depend on global.
    /// -----------------------------------------------------------------------------
    processPreGenerate() {
        const me = this;
        return new Promise(function (resolve, reject) {
            const g = me.inputDir + "/" + exports.PRE_GENERATE_JS;
            if (fs_1.default.existsSync(g)) {
                let pinger = new shared_ts_1.Pinger("preGenerate", (id) => {
                    log(chalk_1.default.yellowBright("Waiting for generator to call resolve: " + id));
                }, 3000);
                const generateSuccess = (response) => {
                    pinger.stop();
                    me.state.globalData = response.global;
                    me.processGeneratorResponse(response, exports.PRE_GENERATE_JS, exports.PRE_GENERATE_NAME);
                    resolve();
                };
                const generateError = (error) => {
                    pinger.stop();
                    me.chalkUpError(exports.PRE_GENERATE_NAME, error);
                    reject(error);
                };
                const script = fs_1.default.readFileSync(g, "utf8");
                if (!me.state.cache[exports.PRE_GENERATE_NAME]) {
                    me.state.cache[exports.PRE_GENERATE_NAME] = {};
                }
                const code = "((require, resolve, reject, cache, log, dataDir) =>  {" +
                    script +
                    "})";
                try {
                    vm_1.default.runInThisContext(code)(require, generateSuccess, generateError, me.state.cache[exports.PRE_GENERATE_NAME], me.scriptLogger.bind(null, exports.PRE_GENERATE_NAME), path_1.default.resolve(me.dataDir));
                }
                catch (error) {
                    me.state.errorCount++;
                    logError(chalk_1.default.red(error));
                    reject(error);
                }
            }
            else {
                log(chalk_1.default.blue(exports.PRE_GENERATE_JS + " not found, skipping."));
                resolve(); // no global data
            }
        });
    }
    /// -----------------------------------------------------------------------------
    /// processPostGenerate
    ///
    /// postGenerate.js has access what we wrote during site generation
    /// -----------------------------------------------------------------------------
    processPostGenerate() {
        const me = this;
        return new Promise(function (resolve, reject) {
            const g = me.inputDir + "/" + exports.POST_GENERATE_JS;
            if (fs_1.default.existsSync(g)) {
                let pinger = new shared_ts_1.Pinger("postGenerate", (id) => {
                    log(chalk_1.default.yellowBright("Waiting for generator to call resolve: " + id));
                }, 3000);
                const generateSuccess = (response) => {
                    pinger.stop();
                    me.processGeneratorResponse(response, exports.POST_GENERATE_JS, exports.POST_GENERATE_NAME);
                    resolve();
                };
                const generateError = (error) => {
                    me.state.errorCount++;
                    pinger.stop();
                    me.chalkUpError(exports.POST_GENERATE_NAME, error);
                    reject(error);
                };
                const script = fs_1.default.readFileSync(g, "utf8");
                const code = "((require, resolve, reject, output, log, dataDir) =>  {" +
                    script +
                    "})";
                try {
                    vm_1.default.runInThisContext(code)(require, generateSuccess, generateError, me.state.outputData, me.scriptLogger.bind(null, exports.POST_GENERATE_NAME), path_1.default.resolve(me.dataDir));
                }
                catch (error) {
                    me.state.errorCount++;
                    logError(chalk_1.default.red(error));
                    reject(error);
                }
            }
            else {
                log(chalk_1.default.blue(exports.POST_GENERATE_JS + " not found, skipping."));
                resolve(); // no global data
            }
        });
    }
    /// -----------------------------------------------------------------------------
    /// updateDeps
    ///
    /// When watching for file changes, we make sure to
    /// trigger any dependencies to regenerate.
    /// -----------------------------------------------------------------------------
    updateDeps(dependencies, dependency = "", reason = TriggerReason.Modified) {
        const me = this;
        return new Promise(function (resolve, reject) {
            for (const pageName in dependencies) {
                // tell the generator that this data file
                // has changed in case it can be efficient
                me.cueGeneration(pageName, dependency, reason);
            }
            const toGenerate = Object.values(me.state.toGenerate);
            if (toGenerate.length) {
                me.generatePages()
                    .then(() => {
                    log(chalk_1.default.green("Dependency Updates Complete."));
                    return me.processPostGenerate();
                })
                    .then(() => {
                    resolve();
                })
                    .catch((error) => {
                    me.state.errorCount++;
                    logError(chalk_1.default.red("Dependency Updates Failed."), error);
                    reject(error);
                });
            }
        });
    }
    /// -----------------------------------------------------------------------------
    /// getDataDeps
    ///
    /// It's up to generator scripts to tell us which datafiles they'd like to watch
    /// -----------------------------------------------------------------------------
    getDataDeps(path) {
        let dependencies;
        // intelligently find the dep
        // first look for direct match:
        dependencies = this.state.pathDepTree[path];
        if (dependencies) {
            log(chalk_1.default.green("Update Triggered by: " + path));
        }
        else if (!dependencies) {
            // check for wildcard match
            const wildDeps = Object.keys(this.state.wildDepTree);
            for (let pattern of wildDeps) {
                if (micromatch_1.default.isMatch(path, "**/" + pattern)) {
                    dependencies = this.state.wildDepTree[pattern];
                    log(chalk_1.default.green("Update Triggered by: " + path));
                    break;
                }
            }
        }
        if (!dependencies) {
            log(chalk_1.default.yellow("Info: No dependencies to update for " + path));
        }
        return dependencies;
    }
    /// -----------------------------------------------------------------------------
    /// updateTemplateDeps
    ///
    /// It's up to generator scripts to tell us which datafiles they'd like to watch
    /// -----------------------------------------------------------------------------
    getTemplateDeps(templateName) {
        // when a template updates, we need to check its dependencies and also trigger its own
        // generation if it is a page maker
        if (this.verbose) {
            log("Dependency Tree Tree:");
            log(JSON.stringify(this.state.templateDepTree, null, "  "));
        }
        const dependencies = {
            ...(this.state.templateDepTree[templateName] || {}),
            [templateName]: true,
        };
        return dependencies;
    }
    /// -----------------------------------------------------------------------------
    /// getGlobalDeps
    ///
    /// If the global data changed, anything that depended
    /// on global data needs to be updated
    /// -----------------------------------------------------------------------------
    getGlobalDeps() {
        console.log(chalk_1.default.green("Update Triggered by preGenerate.js change."));
        return this.state.globalDeps;
    }
}
exports.AirFry = AirFry;
//# sourceMappingURL=api.js.map