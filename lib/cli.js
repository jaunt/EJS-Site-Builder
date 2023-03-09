#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const path_1 = __importDefault(require("path"));
const picocolors_1 = __importDefault(require("picocolors"));
const { promises: fs } = require("fs");
const chokidar_1 = __importDefault(require("chokidar"));
const nconf_1 = __importDefault(require("nconf"));
const process_1 = __importDefault(require("process"));
const shared_ts_1 = require("@danglingdev/shared-ts");
const process_2 = require("process");
const api_1 = require("./api");
// this is only safe because ejssitebuilder is a stand-alone cli, not a module
const LIB_VERSION = require("../package.json").version;
const BAD_OPTIONS = 3;
console.log(picocolors_1.default.black(picocolors_1.default.bgWhite(picocolors_1.default.bold("\n EJS Site Builder \n"))));
console.log(picocolors_1.default.blue("Version " + LIB_VERSION + "\n"));
const loggers = (0, shared_ts_1.makeLoggers)("@ ");
const log = loggers.log;
const logError = loggers.logError;
const program = new commander_1.Command()
    .option("-i, --input <inputDir>", "input directory")
    .option("-d, --data <dataDir>", "data directory")
    .option("-o, --output <outputDir>", "output directory")
    .option("-o, --public <publicDir>", "public directory")
    .option("-c, --cache <cacheDir>", "cache directory")
    .option("-nw, --noWatch", "quit after processing all templates")
    .option("-cc, --clearCache", "clear cache on start")
    .option("-v, --verbose", "logging verbosity");
program.version(LIB_VERSION);
program.parse(process_1.default.argv);
const options = program.opts();
nconf_1.default.argv().env().file({ file: "./ejssitebuilder.json" });
const optionsConfig = nconf_1.default.get("options") || {};
const getOption = (opt, def) => {
    if (options[opt] && optionsConfig[opt]) {
        log(picocolors_1.default.yellow("Warning, command line argument " +
            picocolors_1.default.white(opt) +
            " is overriding option specified in ejssitebuilder.json"));
    }
    let result = options[opt] || optionsConfig[opt];
    if (!result) {
        if (options.verbose || optionsConfig.verbose) {
            log(picocolors_1.default.yellow("No option specified for " +
                picocolors_1.default.white(opt) +
                ", using default value: " +
                picocolors_1.default.green(def || "undefined")));
        }
        result = def;
    }
    return result;
};
const inputDir = getOption("input", "./ejssitebuilder/input");
const dataDir = getOption("data", "./ejssitebuilder/data");
const outputDir = getOption("output", "./ejssitebuilder/output");
const publicDir = getOption("public", "");
const cacheDir = getOption("cache", "./ejssitebuilder/cache");
const verbose = getOption("verbose", "");
const noWatch = getOption("noWatch", "");
if (verbose) {
    log("Options detected:");
    log(JSON.stringify({
        input: inputDir,
        output: outputDir,
        data: dataDir,
        public: publicDir,
        cache: cacheDir,
        noWatch: noWatch,
    }, null, "\t"));
}
const isOneOrTheOtherRelative = (a, b) => {
    const result = (0, shared_ts_1.isRelative)(a, b) || (0, shared_ts_1.isRelative)(b, a);
    if (result) {
        logError("Directories must not contian each other: " + picocolors_1.default.white(a + ", " + b));
    }
    return result;
};
if (isOneOrTheOtherRelative(inputDir, dataDir)) {
    (0, process_2.exit)(BAD_OPTIONS);
}
if (isOneOrTheOtherRelative(inputDir, outputDir)) {
    (0, process_2.exit)(BAD_OPTIONS);
}
if (isOneOrTheOtherRelative(cacheDir, outputDir)) {
    (0, process_2.exit)(BAD_OPTIONS);
}
if (isOneOrTheOtherRelative(dataDir, outputDir)) {
    (0, process_2.exit)(BAD_OPTIONS);
}
if (isOneOrTheOtherRelative(dataDir, cacheDir)) {
    (0, process_2.exit)(BAD_OPTIONS);
}
//https://stackoverflow.com/questions/39106516/node-fs-copy-a-folder
async function copyDir(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    let entries = await fs.readdir(src, { withFileTypes: true });
    for (let entry of entries) {
        let srcPath = path_1.default.join(src, entry.name);
        let destPath = path_1.default.join(dest, entry.name);
        entry.isDirectory()
            ? await copyDir(srcPath, destPath)
            : await fs.copyFile(srcPath, destPath);
    }
}
if (publicDir) {
    if (verbose) {
        log("Recursively copying from " + publicDir + " to " + outputDir);
    }
    copyDir(publicDir, outputDir);
}
const ejssitebuilder = new api_1.EjsSiteBuilder(inputDir, dataDir, outputDir, cacheDir, verbose);
// We want to the cache to store to disk whenever we exit.
// simplified from:
// https://github.com/sindresorhus/exit-hook
// https://github.com/sindresorhus/exit-hook/blob/main/license
let _exited = false;
const onExit = (shouldExit, signal) => {
    if (_exited)
        return;
    _exited = true;
    ejssitebuilder.storeCache();
    if (shouldExit === true) {
        process_1.default.exit(128 + signal);
    }
};
process_1.default.once("exit", onExit);
process_1.default.once("SIGINT", onExit.bind(undefined, true, 2));
process_1.default.once("SIGTERM", onExit.bind(undefined, true, 15));
process_1.default.on("message", (message) => {
    if (message === "shutdown") {
        onExit(true, -128);
    }
});
const watcher = chokidar_1.default.watch([inputDir, dataDir], {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
    },
});
let pinger;
let deps = {};
const startWatching = () => {
    // step 3. watch src directory
    let errors = ejssitebuilder.getErrorCount();
    if (errors > 0) {
        logError("Errors detected: " + errors);
    }
    else {
        log("Zero errors detected.");
    }
    if (options.noWatch) {
        log(`All files written.  No-watch option ending program now.`);
        watcher.close().then(() => console.log("closed"));
        return;
    }
    log(`All files written.  Watching for changes.`);
    const getKind = (p) => {
        const checks = [
            {
                kind: "data",
                prefix: path_1.default.join(dataDir),
            },
            {
                kind: "template",
                prefix: path_1.default.join(inputDir),
            },
        ];
        for (const check of checks) {
            if (p.startsWith(check.prefix)) {
                return {
                    kind: check.kind,
                    name: p.slice(check.prefix.length + 1),
                };
            }
        }
        return {
            kind: "",
            name: "",
        };
    };
    const queueChange = (p, reason = api_1.TriggerReason.Modified) => {
        pinger.restart();
        const check = getKind(p);
        if (check.kind == "template") {
            if (reason == api_1.TriggerReason.Added || reason == api_1.TriggerReason.Modified) {
                // step 1. update the template itself,
                ejssitebuilder
                    .processTemplateFilesPromise(ejssitebuilder.getTemplateFileName(check.name))
                    .then((updateList) => {
                    log("Template Updated: " + p);
                    // render it:
                    // s(tep 2. ... then any other templates depending on it
                    if (updateList.updatedTemplates.length != 1) {
                        throw "Unexpected updatedTemplates is not 1";
                    }
                    deps = {
                        ...deps,
                        ...ejssitebuilder.getTemplateDeps(updateList.updatedTemplates[0]),
                        ...ejssitebuilder.getGlobalDataDeps(updateList.updatedGlobalDeps),
                    };
                    log("Ready to update deps:");
                    log(JSON.stringify(deps));
                })
                    .catch((error) => {
                    logError("Template update error: ", error);
                });
            }
            else if (reason == api_1.TriggerReason.Deleted) {
                // step 1. clean up the template.  this will surely
                // produce errors from anything depending on it.
                ejssitebuilder.processDeletedTemplatePromise(ejssitebuilder.getTemplateFileName(check.name));
            }
        }
        else if (check.kind == "data") {
            // when it's data, we need to process separately for
            // every file in case a generator can rebuild for a single file.
            const dataFileName = path_1.default.resolve(dataDir + "/" + check.name);
            const dataDeps = ejssitebuilder.getDataDeps(dataFileName);
            ejssitebuilder.updateDeps(dataDeps, dataFileName, reason);
        }
    };
    watcher
        .on("add", (p) => {
        queueChange(p, api_1.TriggerReason.Added);
    })
        .on("change", (p) => {
        queueChange(p, api_1.TriggerReason.Modified);
    })
        .on("unlink", (p) => {
        log(`${p} has been removed`);
        // deleting dependencies will likely cause parents to complain!
        queueChange(p, api_1.TriggerReason.Deleted);
    })
        .on("unlinkDir", (path) => log(`Directory ${path} has been removed`));
    pinger = new shared_ts_1.Pinger("watcher", (id) => {
        pinger.stop();
        ejssitebuilder
            .updateDeps({ ...deps })
            .then(() => {
            log("Dependencies updated.");
        })
            .catch((error) => {
            logError(error);
        })
            .finally(() => {
            deps = {};
            const newCount = ejssitebuilder.getErrorCount();
            if (newCount > errors) {
                logError("New errors detected: " + (newCount - errors));
                errors = newCount;
            }
            pinger.restart();
        });
    }, 50);
};
ejssitebuilder
    .processTemplateFilesPromise()
    .then(() => {
    // step 3. wait until first batch page generation
    return ejssitebuilder.generatePages();
})
    .then(() => {
    startWatching();
})
    .catch((error) => {
    logError(error);
});
//# sourceMappingURL=cli.js.map