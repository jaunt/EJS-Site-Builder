"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AirFry = exports.POST_GENERATE_NAME = exports.PRE_GENERATE_NAME = exports.POST_GENERATE_JS = exports.PRE_GENERATE_JS = void 0;
const ejs_1 = __importDefault(require("ejs"));
const vm_1 = __importDefault(require("vm"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const front_matter_1 = __importDefault(require("front-matter"));
const chalk_1 = __importDefault(require("chalk"));
const micromatch_1 = __importDefault(require("micromatch"));
const shared_1 = require("./shared");
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
const END_SCRIPT = "</script>";
const END_SCRIPT_LENGTH = END_SCRIPT.length;
const EXTRACT_SCRIPT = /<script[\s\S]*?>[\s\S]*?<\/script>/gi;
function safeOutputCheck(func, outPath, path, ...args) {
    if (!(0, shared_1.isRelative)(outPath, path)) {
        throw "Trying to write " + path + " which is outside of " + outPath;
    }
    func(path, ...args);
}
class AirFry {
    constructor(inputDir, dataDir, outputDir, cacheDir) {
        this.state = {
            generateScripts: {},
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
            state: {
                html: {},
                entry: {},
                lib: {},
                json: {},
            },
        };
        this.inputDir = inputDir;
        this.dataDir = dataDir;
        this.outputDir = outputDir;
        this.cacheDir = cacheDir;
        this.outPath = path_1.default.resolve("./" + this.outputDir);
        this.loadCache();
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
    getDataFileNames(globList) {
        let files = (0, shared_1.getAllFiles)(this.dataDir);
        if (globList && globList.length > 0) {
            files = (0, micromatch_1.default)(files, globList);
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
                            console.log(chalk_1.default.green("Expired " + pageName + " cache item: " + itemName));
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
        if (fs_1.default.existsSync(this.cacheDir + "/cache.json")) {
            let rawdata = fs_1.default.readFileSync(this.cacheDir + "/cache.json");
            if (rawdata && rawdata.length > 0) {
                this.state.cache = JSON.parse(rawdata.toString());
            }
        }
    }
    // call before exiting
    storeCache() {
        let data = JSON.stringify(this.state.cache);
        if (data && data != "{}") {
            if (!fs_1.default.existsSync(this.cacheDir)) {
                console.log(chalk_1.default.green("Making cache dir: " + this.cacheDir));
                fs_1.default.mkdirSync(this.cacheDir, { recursive: true });
            }
            console.log(chalk_1.default.green("Writing cache"));
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
                state.globalDeps[name] = true;
                return Reflect.get.apply(null, args);
            },
        };
        return new Proxy(state.globalData, globalDataAccessHandler);
    }
    chalkUpError(name, error) {
        // Show generate script errors nicely.
        console.log("\nScript Error: " + chalk_1.default.bgBlack.red(name));
        if (error.message) {
            console.log(chalk_1.default.bgBlack.white(error.message));
        }
        if (typeof error == "string") {
            console.log(chalk_1.default.bgBlack.white(error));
        }
        if (error.stack) {
            try {
                const lines = error.stack.split("\n");
                const errorLine = Number(lines[0].split(":")[1]) - 1;
                const script = this.state.generateScripts[name].split("\n");
                script.forEach((line, index) => {
                    if (index == errorLine) {
                        console.log(chalk_1.default.bgBlack.red(line));
                    }
                    else {
                        console.log(chalk_1.default.bgBlack.blue(line));
                    }
                });
            }
            catch {
                console.log(chalk_1.default.red(error.stack));
            }
        }
    }
    scriptLogger(name) {
        // Format log messages from generate script.
        const args = Array.from(arguments);
        console.log(chalk_1.default.yellow(name) + chalk_1.default.white(": " + args[1]), ...args.slice(2));
    }
    writeEntryScript(script, url) {
        const writePath = "./" + path_1.default.join(this.outputDir, "/", url);
        if (!fs_1.default.existsSync(writePath)) {
            this.mkdirSyncSafe(writePath, { recursive: true });
        }
        let name = "index.js";
        if (url == "/")
            name = "main.js";
        const p = path_1.default.resolve(writePath + "/" + name);
        this.state.state["entry"][url] = p;
        this.writeFileSafe(p, script, (err) => {
            if (err) {
                console.log(chalk_1.default.red("Error writting: " + p));
            }
            else {
                console.log(chalk_1.default.magenta("Wrote: " + p));
            }
        });
    }
    /// -----------------------------------------------------------------------------
    /// Core
    /// -----------------------------------------------------------------------------
    processGeneratorResponse(response, name, cacheName) {
        // Deal with returned promise such as cache, site data, and dependency requests
        if (response.cache) {
            // page is requesting to update its cache
            this.state.cache[cacheName] = response.cache;
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
                this.state.state["json"][name] = p;
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
                        console.log(chalk_1.default.red("Error writing template's siteFiles '" + name + "': '" + p));
                    }
                    else {
                        console.log(chalk_1.default.cyanBright("Wrote: " + p));
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
    renderTemplate(template, path, data) {
        const me = this;
        // recursively render a template to disk
        return new Promise(function (resolve, reject) {
            try {
                const renderInclude = function (dependency, passedData) {
                    if (dependency == "_body") {
                        dependency = template;
                        // pass along the data from whoever was wrapped by this
                        passedData = {
                            ...(passedData || {}),
                            ...data,
                            global: me.getGlobalDataAccessProxy(template),
                        };
                    }
                    if (!me.state.templateDepTree[dependency]) {
                        me.state.templateDepTree[dependency] = {};
                    }
                    me.state.templateDepTree[dependency][template] = true;
                    return me.state.templates[dependency](passedData, undefined, renderInclude);
                };
                let html;
                if (me.state.frontMatter[template].wrapper) {
                    // render wrapper where _body gets redirected back to this template.
                    html = me.state.templates[me.state.frontMatter[template].wrapper](data, undefined, renderInclude);
                }
                else {
                    html = me.state.templates[template](data, undefined, renderInclude);
                }
                const writePath = "./" + path_1.default.join(me.outputDir, "/", path);
                if (!fs_1.default.existsSync(writePath)) {
                    me.mkdirSyncSafe(writePath, { recursive: true });
                }
                const p = path_1.default.resolve(writePath + "/index.html");
                me.state.state["html"][path] = p;
                me.writeFileSafe(p, html, (err) => {
                    if (err) {
                        reject(template);
                    }
                    else {
                        console.log(chalk_1.default.magenta("Wrote: " + p));
                        resolve(template);
                    }
                });
            }
            catch (error) {
                console.log(chalk_1.default.red.bold(`${template}: ${path}`));
                console.log(chalk_1.default.red(error));
                reject(template);
            }
        });
    }
    generatePages() {
        const me = this;
        // Generate all pending pages
        // running generate scripts if specified,
        // rendering templates to disk.
        return new Promise(function (resolve, _) {
            let toGenerate = Object.values(me.state.toGenerate);
            let toRender = toGenerate.length;
            const checkDone = (pageName, path = "") => {
                toRender--;
                delete me.state.toGenerate[pageName]; // mark completed
                if (path && me.state.entryScripts[pageName] != undefined) {
                    me.writeEntryScript(me.state.entryScripts[pageName], path);
                }
                if (toRender == 0) {
                    resolve();
                }
            };
            if (toGenerate.length == 0) {
                console.log(chalk_1.default.yellow("\nNothing to do.  Will wait for changes."));
                resolve();
                return;
            }
            toGenerate.forEach((generateData) => {
                if (me.state.generateScripts[generateData.name]) {
                    // found a generate script -> run it
                    const generateSuccess = (response) => {
                        // callback on generate script complete
                        const generate = response.generate;
                        if (!generate) {
                            throw new Error("No data returned by generate function: " + generateData.name);
                        }
                        me.processGeneratorResponse(response, generateData.name, "_" + generateData.name);
                        let pages = generate;
                        if (!Array.isArray(generate)) {
                            pages = [generate];
                        }
                        else {
                            toRender += pages.length - 1; // account for extra pages
                        }
                        pages.forEach((generatePageRequest) => {
                            const data = {
                                ...me.state.frontMatter[generateData.name],
                                global: me.getGlobalDataAccessProxy(generateData.name),
                                ...generatePageRequest.data,
                            };
                            me.renderTemplate(generateData.name, generatePageRequest.path, data)
                                .then(() => {
                                checkDone(generateData.name, generatePageRequest.path);
                            })
                                .catch((error) => {
                                console.log(chalk_1.default.red.bold(`${generateData.name}: ${generatePageRequest.path}`));
                                console.log(chalk_1.default.red(error));
                                checkDone(generateData.name);
                            });
                        });
                    };
                    const generateError = (error) => {
                        me.chalkUpError(generateData.name, error);
                        checkDone(generateData.name);
                    };
                    if (!me.state.cache["_" + generateData.name]) {
                        me.state.cache["_" + generateData.name] = {};
                    }
                    const inputs = {
                        triggeredBy: generateData.triggeredBy,
                        frontMatter: me.state.frontMatter[generateData.name].attributes,
                    };
                    const code = "((require, resolve, reject, inputs, global, getDataFileNames, cache, log) =>  {" +
                        me.state.generateScripts[generateData.name] +
                        "})";
                    me.expireCache();
                    try {
                        vm_1.default.runInThisContext(code)(require, generateSuccess, generateError, inputs, me.getGlobalDataAccessProxy(generateData.name), me.getDataFileNames, me.state.cache["_" + generateData.name], me.scriptLogger.bind(null, generateData.name));
                    }
                    catch (error) {
                        if (error instanceof Error) {
                            generateError(error);
                        }
                        else {
                            console.log("Unknown error " + error);
                            generateError(new Error("unknown error"));
                        }
                    }
                }
                else if (generateData.generate) {
                    const data = {
                        ...me.state.frontMatter[generateData.name],
                        global: me.getGlobalDataAccessProxy(generateData.name),
                    };
                    me.renderTemplate(generateData.name, generateData.generate, data)
                        .then(() => {
                        checkDone(generateData.name, generateData.generate);
                    })
                        .catch((error) => {
                        console.log(chalk_1.default.red.bold(`${generateData.name}: ${generateData.generate}`));
                        console.log(chalk_1.default.red(error));
                        checkDone(generateData.name, generateData.generate);
                    });
                }
            });
        });
    }
    compileTemplate(source, name) {
        // Pre compile ejs template
        const fn = ejs_1.default.compile(source, { client: true });
        this.state.templates[name] = fn;
    }
    cueGeneration(name, triggeredBy = "") {
        // Mark a page ready for generation.
        const generate = this.state.frontMatter[name].generate;
        this.state.toGenerate[name] = {
            name: name,
            generate: generate,
            triggeredBy: triggeredBy,
        };
    }
    processScript(source, name) {
        // Generate scripts are stored,
        // site scripts are state to output.
        if (source.startsWith(SCRIPT_GENERATE)) {
            // add generate source to build map
            const stripped = source.slice(SCRIPT_GENERATE_LENGTH, -END_SCRIPT_LENGTH);
            this.state.generateScripts[name] = stripped;
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
            this.state.state["lib"][name] = p;
            this.writeFileSafe(p, stripped, (err) => {
                if (err) {
                    console.log(chalk_1.default.red(err));
                }
                console.log(chalk_1.default.cyan("Wrote: " + p));
            });
            return true;
        }
        return false;
    }
    testTemplate(file) {
        // Make sure extension is html and format the name the way we like it.
        const parsed = path_1.default.parse(file);
        const rel = path_1.default.relative(this.inputDir, parsed.dir);
        const name = rel + (rel ? "/" : "") + parsed.name;
        const ext = path_1.default.parse(file).ext;
        if (ext == ".ejs") {
            return name;
        }
        return undefined;
    }
    processTemplateFilesPromise(file = undefined) {
        const me = this;
        // Process all template files found under input director,
        // or a single file if we had been watching it for changes.
        return new Promise(function (resolve, reject) {
            let list = [];
            if (file == undefined) {
                try {
                    list = (0, shared_1.getAllFiles)(me.inputDir);
                }
                catch (error) {
                    console.log(chalk_1.default.red("Could not scan " + me.inputDir));
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
            console.log(chalk_1.default.green(`Processing ${pending} input files.`));
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
                        me.compileTemplate(template.trim(), name);
                        me.cueGeneration(name);
                        checkDone(name);
                    });
                }
                else {
                    console.log(chalk_1.default.yellow("Warning, non html file found in templates folders: " + file));
                    checkDone();
                }
            });
        });
    }
    processGeneratePre() {
        const me = this;
        // preGenerate.js creates global data for all generate scripts.
        // If changed via watcher, make sure to re-generate
        // any pages that asked to depend on global.
        return new Promise(function (resolve, reject) {
            const generateSuccess = (response) => {
                me.state.globalData = response.global;
                me.processGeneratorResponse(response, exports.PRE_GENERATE_JS, exports.PRE_GENERATE_NAME);
                resolve();
            };
            const g = me.inputDir + "/" + exports.PRE_GENERATE_JS;
            const generateError = (error) => {
                me.chalkUpError(exports.PRE_GENERATE_NAME, error);
                reject(error);
            };
            if (fs_1.default.existsSync(g)) {
                const script = fs_1.default.readFileSync(g, "utf8");
                if (!me.state.cache[exports.PRE_GENERATE_NAME]) {
                    me.state.cache[exports.PRE_GENERATE_NAME] = {};
                }
                const code = "((require, resolve, reject, cache, log) =>  {" + script + "})";
                try {
                    vm_1.default.runInThisContext(code)(require, generateSuccess, generateError, me.state.cache[exports.PRE_GENERATE_NAME], me.scriptLogger.bind(null, exports.PRE_GENERATE_NAME));
                }
                catch (error) {
                    console.log(chalk_1.default.red(error));
                    reject(error);
                }
            }
            else {
                resolve(); // no global data
            }
        });
    }
    processGeneratePost() {
        const me = this;
        // postGenerate.js has access what we wrote during site generation
        return new Promise(function (resolve, reject) {
            const generateSuccess = (response) => {
                me.processGeneratorResponse(response, exports.POST_GENERATE_JS, exports.POST_GENERATE_NAME);
                resolve();
            };
            const g = me.inputDir + "/" + exports.POST_GENERATE_JS;
            const generateError = (error) => {
                me.chalkUpError(exports.POST_GENERATE_NAME, error);
                reject(error);
            };
            if (fs_1.default.existsSync(g)) {
                const script = fs_1.default.readFileSync(g, "utf8");
                const code = "((require, resolve, reject, state, log) =>  {" + script + "})";
                try {
                    vm_1.default.runInThisContext(code)(require, generateSuccess, generateError, me.state.state, me.scriptLogger.bind(null, exports.POST_GENERATE_NAME));
                }
                catch (error) {
                    console.log(chalk_1.default.red(error));
                    reject(error);
                }
            }
            else {
                resolve(); // no global data
            }
        });
    }
    updateDeps(dependencies, dependency = "") {
        for (const pageName in dependencies) {
            // tell the generator that this data file
            // has changed in case it can be efficient
            this.cueGeneration(pageName, dependency);
        }
        this.generatePages()
            .then(() => {
            console.log(chalk_1.default.green("Dependency Updates Complete."));
        })
            .catch((error) => {
            console.log(chalk_1.default.red("Dependency Updates Failed."));
            console.log(chalk_1.default.red(error));
        });
    }
    updateDataDeps(path) {
        let dependencies;
        // intelligently find the dep
        // first look for direct match:
        dependencies = this.state.pathDepTree[path];
        if (dependencies) {
            console.log(chalk_1.default.green("Update Triggered by: " + path));
        }
        else if (!dependencies) {
            // check for wildcard match
            const wildDeps = Object.keys(this.state.wildDepTree);
            for (let pattern of wildDeps) {
                if (micromatch_1.default.isMatch(path, "**/" + pattern)) {
                    dependencies = this.state.wildDepTree[pattern];
                    console.log(chalk_1.default.green("Update Triggered by: " + path));
                    break;
                }
            }
        }
        if (dependencies) {
            this.updateDeps(dependencies, path);
        }
        else {
            console.log(chalk_1.default.yellow("Info: No dependencies to update for " + path));
        }
    }
    updateTemplateDeps(templateName) {
        // when a template updates, we need to check its dependencies and also trigger its own
        // generation if it is a page maker
        const deps = {
            ...(this.state.templateDepTree[templateName] || {}),
            [templateName]: true,
        };
        console.log(chalk_1.default.green("Update Triggered by: " + templateName));
        this.updateDeps(deps);
    }
    updatGlobalDeps() {
        console.log(chalk_1.default.green("Update Triggered by preGenerate.js change."));
        this.updateDeps(this.state.globalDeps);
    }
}
exports.AirFry = AirFry;
//# sourceMappingURL=airfry.js.map