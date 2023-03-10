"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EjsSiteBuilder = exports.TriggerReason = void 0;
const ejs_1 = __importDefault(require("ejs"));
const vm_1 = __importDefault(require("vm"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const front_matter_1 = __importDefault(require("front-matter"));
const picocolors_1 = __importDefault(require("picocolors"));
const micromatch_1 = __importDefault(require("micromatch"));
const shared_ts_1 = require("@danglingdev/shared-ts");
const loggers = (0, shared_ts_1.makeLoggers)("@ ");
const log = loggers.log;
const logError = loggers.logError;
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
const TriggerReasonText = ["Added", "Modified", "Deleted"];
function getNowDate() {
    const d = new Date();
    return d.toISOString();
}
function safeOutputCheck(func, outPath, path, ...args) {
    if (!(0, shared_ts_1.isRelative)(outPath, path)) {
        throw new Error("Trying to write " + path + " which is outside of " + outPath);
    }
    func(path, ...args);
}
function stringifyFuncs(_, v) {
    if (typeof v === "function") {
        return "render function";
    }
    return v;
}
class EjsSiteBuilder {
    constructor(inputDir, dataDir, outputDir, cacheDir, verbose) {
        this.state = {
            generateScripts: {},
            generateCompiledScripts: {},
            generateScriptRefs: {},
            generateScriptPaths: {},
            entryScripts: {},
            templateDepTree: {},
            pathDepTree: {},
            wildDepTree: {},
            globalDepTree: {},
            globalDepUpdated: {},
            frontMatter: {},
            templates: {},
            toGenerate: {},
            globalData: {},
            cacheData: {},
            filesWritten: {},
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
            logError(picocolors_1.default.red("Warning, " +
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
        const cacheData = this.state.cacheData;
        for (const itemName in cacheData) {
            const expires = cacheData[itemName].expires;
            if (expires) {
                if (!isNaN(expires)) {
                    const now = new Date().getTime();
                    if (now > expires) {
                        log(picocolors_1.default.green("Expired cache item: " + itemName));
                        delete cacheData[itemName];
                    }
                }
                else {
                    throw new Error("Cache item " + itemName + " expires date is invalid");
                }
            }
        }
    }
    loadCache() {
        const p = path_1.default.resolve(this.cacheDir);
        if (fs_1.default.existsSync(p + "/cache.json")) {
            let rawdata = fs_1.default.readFileSync(p + "/cache.json");
            if (rawdata && rawdata.length > 0) {
                this.state.cacheData = JSON.parse(rawdata.toString());
            }
        }
    }
    // call before exiting
    storeCache() {
        const p = path_1.default.resolve(this.cacheDir);
        let data = JSON.stringify(this.state.cacheData);
        if (data) {
            if (!fs_1.default.existsSync(this.cacheDir)) {
                log(picocolors_1.default.green("Making cache dir: " + p));
                fs_1.default.mkdirSync(this.cacheDir, { recursive: true });
            }
            log(picocolors_1.default.green("Writing cache: " + p + "/cache.json"));
            fs_1.default.writeFileSync(this.cacheDir + "/cache.json", data);
        }
    }
    /// -----------------------------------------------------------------------------
    /// Helpers
    /// -----------------------------------------------------------------------------
    getGlobalDataAccessProxy(name) {
        // a proxy to detect access to global data from scripts
        const state = this.state;
        // always overwrite filesWritten to global data
        state.globalData["filesWritten"] = this.state.filesWritten;
        const globalDataAccessHandler = {
            get: function (...args) {
                // access to global deps was detected
                if (!state.globalData[args[1]]) {
                    throw new Error("Accessing undefined global data Element: " + args[1]);
                }
                const dep = args[1];
                if (!state.globalDepTree[dep]) {
                    state.globalDepTree[dep] = {};
                }
                state.globalDepTree[dep][name] = true;
                return Reflect.get.apply(null, args);
            },
        };
        return new Proxy(state.globalData, globalDataAccessHandler);
    }
    chalkUpError(name, error) {
        // Show generate script errors nicely.
        logError("\nScript Error: " + picocolors_1.default.bgBlack(picocolors_1.default.red(name)));
        if (error.message) {
            log(picocolors_1.default.bgBlack(picocolors_1.default.white(error.message)));
        }
        if (typeof error == "string") {
            log(picocolors_1.default.bgBlack(picocolors_1.default.white(error)));
        }
        if (error.stack) {
            try {
                const lines = error.stack.split("\n");
                const errorLine = Number(lines[0].split(":")[1]) - 1;
                const script = this.getGenerateScript(name).split("\n");
                script.forEach((line, index) => {
                    if (index == errorLine) {
                        log(picocolors_1.default.bgBlack(picocolors_1.default.red(line)));
                    }
                    else {
                        log(picocolors_1.default.bgBlack(picocolors_1.default.blue(line)));
                    }
                });
            }
            catch {
                this.state.errorCount++;
                log(picocolors_1.default.red(error.stack));
            }
        }
    }
    scriptLogger(name) {
        // Format log messages from generate script.
        const args = Array.from(arguments);
        log(picocolors_1.default.yellow(name) + picocolors_1.default.white(": " + args[1]), ...args.slice(2));
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
    updateFileWritten(kind, source, path) {
        const rel = path_1.default.relative(this.outPath, path);
        const now = getNowDate();
        source += " " + now;
        // add to fileswritten if it doesn't exist or set modification and push to source
        if (!this.state.filesWritten[rel]) {
            this.state.filesWritten[rel] = {
                kind: kind,
                source: [source],
                created: now,
                modified: now,
            };
        }
        else {
            this.state.filesWritten[rel].source.push(source);
            this.state.filesWritten[rel].modified = now;
        }
    }
    writeEntryScript(template, script, path, name) {
        const writePath = "./" + path_1.default.join(this.outputDir, "/", path);
        if (!fs_1.default.existsSync(writePath)) {
            this.mkdirSyncSafe(writePath, { recursive: true });
        }
        const p = path_1.default.resolve(writePath + "/" + name);
        this.updateFileWritten("entry", template, p);
        this.writeFileSafe(p, script, (err) => {
            if (err) {
                this.state.errorCount++;
                logError(picocolors_1.default.red("Error writting: " + p));
            }
            else {
                log(picocolors_1.default.magenta("Wrote: " + p));
            }
        });
    }
    processEntryScripts(pageName, outPath) {
        // Write out entry scripts (and append wrapper entry scripts)
        const me = this;
        let entryScripts = [];
        if (me.state.entryScripts[pageName] != undefined) {
            if (me.verbose) {
                log(picocolors_1.default.yellow("using entry script for '" + pageName + "'"));
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
                        log(picocolors_1.default.yellow("appending wrapper entry script from '" +
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
    processGeneratorResponse(response, name) {
        if (!response) {
            return;
        }
        if (response.global) {
            const globalData = response.global;
            for (const key in globalData) {
                if (this.state.globalData[key] == undefined) {
                    this.state.globalData[key] = globalData[key];
                }
                else {
                    if (this.state.globalData[key] != globalData[key]) {
                        this.state.globalData[key] = globalData[key];
                        this.state.globalDepUpdated[key] = true;
                    }
                }
            }
        }
        if (response.cache) {
            // page is requesting to update its cache
            this.state.cacheData = { ...this.state.cacheData, ...response.cache };
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
                this.updateFileWritten("json", name, p);
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
                        logError(picocolors_1.default.red("Error writing template's siteFiles '" + name + "': '" + p));
                    }
                    else {
                        log(picocolors_1.default.cyan("Wrote: " + p));
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
    /// renderRecursive
    /// Render a template and its children recursively
    /// -----------------------------------------------------------------------------
    renderRecursive(parent, // orginal template name
    wrapStack, // stack of wrappers
    passedData, // from front matter, global, etc
    progress, // last template worked on in recursion by ref
    current, // included template
    includeData // passed with ejs include
    ) {
        progress[0] = current;
        // Check for _body include
        if (current == "_body") {
            if (wrapStack.length == 0) {
                throw new Error("Wrapper " + parent + " was not wrapping anything");
            }
            current = wrapStack.pop();
        }
        else {
            // template depends on this dependency
            this.markDependsOn(parent, current);
            // Wrappers render where _body gets redirected back to wrapped template.
            // Support nested wrapping.
            let wrapper = current;
            let wrapCheck = wrapper;
            wrapStack = [];
            while (this.state.frontMatter[wrapCheck]?.wrapper) {
                wrapper = this.state.frontMatter[wrapCheck].wrapper;
                // current depends on this wrapper
                this.markDependsOn(current, wrapper);
                wrapStack.push(wrapCheck);
                wrapCheck = wrapper;
            }
            current = wrapper;
        }
        // combine data from passed, current front matter, and passed with include
        const renderData = {
            ...passedData,
            ...(this.state.frontMatter[current] || {}),
            ...(includeData || {}),
        };
        return this.state.templates[current](renderData, undefined, this.renderRecursive.bind(this, parent, wrapStack, renderData, progress));
    }
    /// -----------------------------------------------------------------------------
    /// renderTemplate
    ///
    /// recursively render a template and all its children / wrappers to disk
    /// -----------------------------------------------------------------------------
    renderTemplate(template, path, data) {
        let _progress = [template];
        const me = this;
        try {
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
            const html = me.renderRecursive(template, [], renderData, _progress, template);
            const writePath = "./" + path_1.default.join(me.outputDir, "/", path);
            if (!fs_1.default.existsSync(writePath)) {
                me.mkdirSyncSafe(writePath, { recursive: true });
            }
            const p = path_1.default.resolve(writePath + "/index.html");
            me.updateFileWritten("html", template, p);
            me.writeFileSafe(p, html, (err) => {
                if (err) {
                    throw err;
                }
                else {
                    log(picocolors_1.default.magenta("Wrote: " + p));
                }
            });
            return path;
        }
        catch (error) {
            me.state.errorCount++;
            logError(picocolors_1.default.red(picocolors_1.default.bold(`Error rendering page: ${template}, template: ${_progress[0]}, path: ${path}`)));
            logError(error);
            throw error;
        }
    }
    /// -----------------------------------------------------------------------------
    /// generatePages
    ///
    /// Generate all cued pages
    /// running generate scripts if specified,
    /// rendering templates to disk.
    /// -----------------------------------------------------------------------------
    async generatePages() {
        const me = this;
        let toGenerate = Object.values(me.state.toGenerate);
        if (toGenerate.length == 0) {
            log(picocolors_1.default.yellow("\nNothing to do.  Will wait for changes."));
            return;
        }
        const generateSimple = (pageName, path) => {
            // Generate a page that does not have a generate script
            // or returns no page creation data from it
            const data = {
                global: me.getGlobalDataAccessProxy(pageName),
                ...me.state.frontMatter[pageName],
            };
            try {
                const fixedPath = me.renderTemplate(pageName, path, data);
                me.processEntryScripts(pageName, fixedPath);
            }
            catch (error) {
                logError(error);
            }
        };
        const hasPre = toGenerate.findIndex((item) => item.name == "preGenerate");
        // if there is a preGenerate template, make sure it's processed first
        const pre = toGenerate[hasPre];
        if (hasPre > 0) {
            toGenerate.splice(hasPre, 1);
        }
        const hasPost = toGenerate.findIndex((item) => item.name == "postGenerate");
        // if there is a postGenerate template, make sure it's processed last
        const post = toGenerate[hasPost];
        if (hasPost > -1 && hasPost < toGenerate.length - 1) {
            toGenerate.splice(hasPost, 1);
        }
        const _generateTemplate = (generateData) => {
            return new Promise(function (resolve, reject) {
                delete me.state.toGenerate[generateData.name]; // mark completed
                if (me.getGenerateScript(generateData.name)) {
                    let rendered = 0;
                    let pinger = new shared_ts_1.Pinger(generateData.name, (id) => {
                        log(picocolors_1.default.yellow("Waiting for generator to call resolve: " + id));
                    }, 3000);
                    const generateError = (error) => {
                        pinger.stop();
                        me.chalkUpError(generateData.name, error);
                        resolve();
                    };
                    const generateDone = (response) => {
                        pinger.stop();
                        log(picocolors_1.default.yellow("Generator Resolved: " + generateData.name));
                        if (rendered == 0) {
                            const pathStars = (generateData.generate.match(/\*/g) || [])
                                .length;
                            if (pathStars > 0) {
                                if (me.verbose) {
                                    log(picocolors_1.default.yellow("Generate script '" +
                                        generateData.name +
                                        "' requested no pages.  Ignoring."));
                                }
                            }
                            else {
                                if (me.verbose) {
                                    log(picocolors_1.default.yellow("Rendering template " +
                                        generateData.name +
                                        " with absolute generate path after running its generate script."));
                                }
                                generateSimple(generateData.name, generateData.generate);
                            }
                        }
                        // callback on generate script complete
                        me.processGeneratorResponse(response, generateData.name);
                        resolve();
                    };
                    const generatePagesRequest = (response) => {
                        log(picocolors_1.default.yellow("Generating batch pages for: " + generateData.name));
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
                                    log(picocolors_1.default.yellow("Generate script " +
                                        generateData.name +
                                        " requesting zero pages to render"));
                                }
                            }
                            else {
                                pages.forEach((generatePageRequest) => {
                                    const data = {
                                        global: me.getGlobalDataAccessProxy(generateData.name),
                                        ...generatePageRequest.data,
                                        ...me.state.frontMatter[generateData.name],
                                    };
                                    const starReplacedPath = generateData.generate.replace(/\*/, generatePageRequest.path);
                                    rendered++;
                                    try {
                                        const fixedPath = me.renderTemplate(generateData.name, starReplacedPath, data);
                                        me.processEntryScripts(generateData.name, fixedPath);
                                    }
                                    catch (error) {
                                        logError(error);
                                    }
                                });
                            }
                        }
                    };
                    let reason = "";
                    if (generateData.triggeredBy) {
                        reason = TriggerReasonText[generateData.reason];
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
                    // in case a generate script wants to directly render a template
                    const _progress = [""];
                    const renderTemplateRequest = (template, data) => {
                        _progress[0] = template;
                        try {
                            const html = me.renderRecursive(generateData.name, [], data, _progress, template);
                            return html;
                        }
                        catch (error) {
                            throw new Error("Couldn't render template " +
                                template +
                                " (" +
                                _progress[0] +
                                "): " +
                                error);
                        }
                    };
                    me.expireCache();
                    try {
                        const script = me.getGenerateCompiledScript(generateData.name);
                        if (!script) {
                            throw new Error("No script found for " + generateData.name);
                        }
                        const f = script.runInThisContext();
                        try {
                            const result = f({
                                require,
                                generatePages: generatePagesRequest,
                                inputs,
                                getDataFileNames: me.getDataFileNames.bind(me, generateData.name),
                                cache: me.state.cacheData,
                                log: me.scriptLogger.bind(null, generateData.name),
                                frontMatterParse: front_matter_1.default,
                                dataDir: path_1.default.resolve(me.dataDir),
                                renderTemplate: renderTemplateRequest,
                            });
                            if (result instanceof Promise) {
                                result
                                    .then((result) => generateDone(result))
                                    .catch((error) => generateError(error));
                            }
                            else {
                                console.log("sync function resolving now...");
                                generateDone(result);
                            }
                        }
                        catch (error) {
                            reject(error);
                        }
                    }
                    catch (error) {
                        me.state.errorCount++;
                        if (error instanceof Error) {
                            generateError(error);
                        }
                        else {
                            logError(picocolors_1.default.red("Unknown error " + error));
                            generateError(new Error("unknown error"));
                        }
                    }
                }
                else if (generateData.generate) {
                    generateSimple(generateData.name, generateData.generate);
                    resolve();
                }
            });
        };
        if (pre) {
            await _generateTemplate(pre);
        }
        const promiseList = toGenerate.map((generateData) => {
            return _generateTemplate(generateData);
        });
        await Promise.all(promiseList);
        if (post) {
            await _generateTemplate(post);
        }
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
            logError(picocolors_1.default.red(`${error.message?.split("\n")[0]} in ${name}`));
        }
    }
    /// -----------------------------------------------------------------------------
    /// cueGeneration
    ///
    /// Mark a page to be generated
    /// -----------------------------------------------------------------------------
    cueGeneration(name, triggeredBy = "", reason = TriggerReason.Modified) {
        const generate = this.state.frontMatter[name].generate;
        if (generate != undefined) {
            this.state.toGenerate[name] = {
                name: name,
                generate: generate,
                triggeredBy: triggeredBy,
                reason: reason,
            };
        }
    }
    /// -----------------------------------------------------------------------------
    /// getGenerateCompiledScript
    ///
    /// Get a compiled script for template, either direct or referred
    /// -----------------------------------------------------------------------------
    getGenerateCompiledScript(name) {
        if (this.state.generateScripts[name]) {
            return this.state.generateCompiledScripts[name];
        }
        const ref = this.state.generateScriptRefs[name];
        if (ref) {
            if (this.state.generateScripts[ref]) {
                if (this.verbose) {
                    log(picocolors_1.default.yellow("using reference generate script '" + ref + "' for '" + name + "'"));
                }
                return this.state.generateCompiledScripts[ref];
            }
        }
        return undefined;
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
                    log(picocolors_1.default.yellow("using reference generate script '" + ref + "' for '" + name + "'"));
                }
                return this.state.generateScripts[ref];
            }
        }
        return "";
    }
    /// -----------------------------------------------------------------------------
    /// compileGenerateScript
    ///
    /// Process a script tag found in a template file.
    /// - Generate scripts are stored,
    /// - site scripts are state to output.
    /// -----------------------------------------------------------------------------
    compileGenerateScript(name, lineOffset = 0) {
        // generate func can be a promise or a regular function
        const code = this.state.generateScripts[name];
        this.state.generateCompiledScripts[name] = new vm_1.default.Script(code, {
            filename: this.state.generateScriptPaths[name],
            lineOffset: lineOffset,
        });
    }
    /// -----------------------------------------------------------------------------
    /// processScript
    ///
    /// Process a script tag found in a template file.
    /// - Generate scripts are stored,
    /// - site scripts are state to output.
    /// -----------------------------------------------------------------------------
    processScript(source, name, lineOffset = 0) {
        if (source.startsWith(SCRIPT_GENERATE)) {
            // add generate source to build map
            const stripped = source.slice(SCRIPT_GENERATE_LENGTH, -END_SCRIPT_LENGTH);
            this.state.generateScripts[name] = stripped;
            this.compileGenerateScript(name, lineOffset);
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
                logError(picocolors_1.default.red("Generate-use script template in: '" +
                    name +
                    "' not specified correctly.  See: (https://jaunt.github.io/ejssitebuilder/docs/input/templates)"));
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
            this.updateFileWritten("lib", name, p);
            this.writeFileSafe(p, stripped, (err) => {
                if (err) {
                    this.state.errorCount++;
                    logError(err);
                }
                log(picocolors_1.default.cyan("Wrote: " + p));
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
        delete this.state.generateCompiledScripts[template];
        delete this.state.generateScriptRefs[template];
        delete this.state.generateScriptPaths[template];
        delete this.state.entryScripts[template];
        for (let key in this.state.pathDepTree) {
            delete this.state.pathDepTree[key][template];
        }
        for (let key in this.state.wildDepTree) {
            delete this.state.wildDepTree[key][template];
        }
        for (let key in this.state.globalDepTree) {
            delete this.state.globalDepTree[key][template];
        }
        delete this.state.frontMatter[template];
        delete this.state.toGenerate[template];
        this.state.cacheData = {};
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
                    logError(picocolors_1.default.red("Could not scan " + me.inputDir));
                }
            }
            else {
                list = [file];
            }
            const names = {};
            // reset global dependency used tracking table
            me.state.globalDepUpdated = {};
            let pending = list.length;
            const checkDone = (name) => {
                if (name) {
                    names[name] = true;
                }
                pending--;
                if (pending <= 0) {
                    resolve({
                        updatedTemplates: Object.keys(names),
                        updatedGlobalDeps: Object.keys(me.state.globalDepUpdated),
                    });
                }
            };
            if (list.length == 0) {
                resolve({ updatedTemplates: [], updatedGlobalDeps: [] });
                return;
            }
            log(picocolors_1.default.green(`Processing ${pending} input files.`));
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
                        const bodyOffset = content.bodyBegin;
                        let scriptProgressIndex = 0;
                        const lines = body.split("\n");
                        const findScriptLineStartNumber = () => {
                            const progress = lines.slice(scriptProgressIndex);
                            const start = progress.findIndex((line) => {
                                return line.startsWith("<script");
                            });
                            const end = progress.findIndex((line) => {
                                return line.startsWith("</script>");
                            });
                            return { start: start, end: end };
                        };
                        const replacer = (match, offset) => {
                            const { start, end } = findScriptLineStartNumber();
                            let scriptStartindex = 0;
                            if (start > -1) {
                                if (end == -1)
                                    throw new Error("Missing </script> tag");
                                scriptStartindex = scriptProgressIndex + start;
                                scriptProgressIndex += end + 1;
                            }
                            me.state.generateScriptPaths[name] = file;
                            const used = me.processScript(match, name, scriptStartindex + bodyOffset);
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
                    log(picocolors_1.default.green("Dependency Updates Complete."));
                    resolve();
                })
                    .catch((error) => {
                    me.state.errorCount++;
                    logError(picocolors_1.default.red("Dependency Updates Failed."), error);
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
            log(picocolors_1.default.green("Update Triggered by: " + path));
        }
        else if (!dependencies) {
            // check for wildcard match
            const wildDeps = Object.keys(this.state.wildDepTree);
            for (let pattern of wildDeps) {
                if (micromatch_1.default.isMatch(path, "**/" + pattern)) {
                    dependencies = this.state.wildDepTree[pattern];
                    log(picocolors_1.default.green("Update Triggered by: " + path));
                    break;
                }
            }
        }
        if (!dependencies) {
            log(picocolors_1.default.yellow("Info: No dependencies to update for " + path));
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
            log(JSON.stringify(this.state.templateDepTree, null, "  "));
        }
        const dependencies = {
            ...(this.state.templateDepTree[templateName] || {}),
            [templateName]: true,
        };
        return dependencies;
    }
    /// ----------------------------------------------------------------------------
    /// updateTemplateDeps
    ///
    /// When templates access global data keys...
    /// ----------------------------------------------------------------------------
    getGlobalDataDeps(globalDataKey) {
        // when a template updates, it might write to 1 or more global data keys.
        // we will compile a list of any templates that depend on those keys...
        if (this.verbose) {
            log(JSON.stringify(this.state.globalDepTree, null, "  "));
        }
        let dependencies = {};
        for (const key of globalDataKey) {
            Object.keys(this.state.globalDepTree[key]).forEach((templateName) => {
                dependencies[templateName] = true;
            });
        }
        return dependencies;
    }
}
exports.EjsSiteBuilder = EjsSiteBuilder;
//# sourceMappingURL=api.js.map