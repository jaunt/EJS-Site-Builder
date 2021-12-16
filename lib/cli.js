#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const chokidar_1 = __importDefault(require("chokidar"));
const nconf_1 = __importDefault(require("nconf"));
const process_1 = __importDefault(require("process"));
const shared_ts_1 = require("@danglingdev/shared-ts");
const process_2 = require("process");
const airfry_1 = require("./airfry");
const version = "0.0.3"; // todo get version from git tag
const BAD_OPTIONS = 3;
console.log(chalk_1.default.black.bgWhite.bold("\n Air", chalk_1.default.white.bgBlue(" Fry \n")));
console.log(chalk_1.default.blueBright("Version " + version + "\n"));
const loggers = (0, shared_ts_1.makeLoggers)("@ ");
const log = loggers.log;
const logError = loggers.logError;
const program = new commander_1.Command()
    .option("-i, --input <inputDir>", "input directory")
    .option("-d, --data <dataDir>", "data directory")
    .option("-o, --output <outputDir>", "output directory")
    .option("-c, --cache <cacheDir>", "cache directory")
    .option("-nw, --noWatch", "quit after processing all templates")
    .option("-wo, --watchOnly", "don't process at start, only watch")
    .option("-k, --keepOutDir", "clear output directory on start")
    .option("-cc, --clearCache", "clear cache on start")
    .option("-v, --verbose", "logging verbosity");
program.version(version);
program.parse(process_1.default.argv);
const options = program.opts();
if (options.verbose) {
    log("Options detected:");
    log(options);
}
nconf_1.default.argv().env().file({ file: "./airfry.json" });
const optionsConfig = nconf_1.default.get("options") || {};
const getOption = (opt, def) => {
    if (options[opt] && optionsConfig[opt]) {
        log(chalk_1.default.yellow("Warning, command line argument " +
            chalk_1.default.white(opt) +
            " is overriding option specified in airfry.json"));
    }
    let result = options[opt] || optionsConfig[opt];
    if (!result) {
        if (options.verbose) {
            log(chalk_1.default.yellow("No option specified for " +
                chalk_1.default.white(opt) +
                ", using default value: " +
                chalk_1.default.green(def || "undefined")));
        }
        result = def;
    }
    return result;
};
const inputDir = getOption("input", "./airfry-input");
const dataDir = getOption("data", "./airfry-data");
const outputDir = getOption("output", "./airfry-output");
const cacheDir = getOption("cache", "./airfry-cache");
const keepOutDir = getOption("keepOutDir", "");
const noWatch = getOption("noWatch", "");
const watchOnly = getOption("watchOnly", "");
if (!keepOutDir) {
    if (fs_1.default.existsSync(outputDir)) {
        log("Clearing output dir: " + outputDir);
        fs_1.default.rmSync(outputDir, { recursive: true });
    }
}
if (watchOnly && noWatch) {
    logError("Can't both watch and not watch!  Exiting.");
    (0, process_2.exit)(BAD_OPTIONS);
}
const isOneOrTheOtherRelative = (a, b) => {
    const result = (0, shared_ts_1.isRelative)(a, b) || (0, shared_ts_1.isRelative)(b, a);
    if (result) {
        logError("Directories must not contian each other: " + chalk_1.default.white(a + ", " + b));
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
const airfry = new airfry_1.AirFry(inputDir, dataDir, outputDir, cacheDir);
// We want to the cache to store to disk whenever we exit.
// simplified from:
// https://github.com/sindresorhus/exit-hook
// https://github.com/sindresorhus/exit-hook/blob/main/license
let _exited = false;
const onExit = (shouldExit, signal) => {
    if (_exited)
        return;
    _exited = true;
    airfry.storeCache();
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
if (!watchOnly) {
    // step 1:  process global.js
    airfry
        .processPreGenerate()
        .then(() => {
        // step 2. process existing src files
        return airfry.processTemplateFilesPromise();
    })
        .then(() => {
        // step 3. wait until first batch page generation
        return airfry.generatePages();
    })
        .then(() => {
        // step 3. wait until first batch page generation
        return airfry.processPostGenerate();
    })
        .then(() => {
        // step 3. watch src directory
        let errors = airfry.getErrorCount();
        if (errors > 0) {
            logError("Errors detected: " + errors);
        }
        else {
            log("Zero errors detected.");
        }
        if (options.noWatch) {
            log(`All files written.  No-watch option ending program now.`);
            return;
        }
        log(`All files written.  Watching for changes.`);
        const watcher = chokidar_1.default.watch([inputDir, dataDir], {
            ignored: /(^|[\/\\])\../,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 1000,
                pollInterval: 100,
            },
        });
        const getKind = (p) => {
            const checks = [
                {
                    kind: "data",
                    prefix: path_1.default.join(dataDir),
                },
                {
                    kind: airfry_1.PRE_GENERATE_NAME,
                    prefix: path_1.default.join(inputDir, airfry_1.PRE_GENERATE_JS),
                },
                {
                    kind: airfry_1.POST_GENERATE_NAME,
                    prefix: path_1.default.join(inputDir, airfry_1.POST_GENERATE_JS),
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
                        name: p.substr(check.prefix.length + 1),
                    };
                }
            }
            return {
                kind: "",
                name: "",
            };
        };
        let pinger;
        let deps = {};
        const queueChange = (p) => {
            pinger.restart();
            const check = getKind(p);
            if (check.kind == airfry_1.PRE_GENERATE_NAME) {
                airfry
                    .processPreGenerate()
                    .then(() => {
                    log("Pre Generate JS updated -- updating deps");
                    deps = { ...deps, ...airfry.getGlobalDeps() };
                })
                    .catch((error) => {
                    logError("Pre Generate JS update error: ", error);
                });
            }
            else if (check.kind == airfry_1.POST_GENERATE_NAME) {
                airfry
                    .processPostGenerate()
                    .then(() => {
                    log("Post Generate JS updated");
                    // nothing can depend on post generate
                })
                    .catch((error) => {
                    logError("Post Generate JS update error: ");
                    log(error);
                });
            }
            else if (check.kind == "template") {
                // step 1. update the template itself,
                airfry
                    .processTemplateFilesPromise(airfry.getTemplateFileName(check.name))
                    .then((updateList) => {
                    log("Template Updated: " + p);
                    // render it:
                    // step 2. ... then any other templates depending on it
                    deps = { ...deps, ...airfry.getTemplateDeps(updateList[0]) };
                })
                    .catch((error) => {
                    logError("Template update error: ", error);
                });
            }
            else if (check.kind == "data") {
                // when it's data, we need to process separately for
                // every file in case a generator can rebuild for a single file.
                const dataFileName = path_1.default.resolve(dataDir + "/" + check.name);
                const dataDeps = airfry.getDataDeps(dataFileName);
                airfry.updateDeps(dataDeps, dataFileName);
            }
        };
        watcher
            .on("add", (p) => {
            queueChange(p);
        })
            .on("change", (p) => {
            queueChange(p);
        })
            .on("unlink", (p) => {
            log(`${p} has been removed`);
            // deleting dependencies will likely cause parents to complain!
            queueChange(p);
        })
            .on("unlinkDir", (path) => log(`Directory ${path} has been removed`));
        pinger = new shared_ts_1.Pinger("watcher", (id) => {
            pinger.stop();
            airfry
                .updateDeps({ ...deps })
                .then(() => {
                log("Dependencies updated.");
            })
                .catch((error) => {
                logError(error);
            })
                .finally(() => {
                deps = {};
                const newCount = airfry.getErrorCount();
                if (newCount > errors) {
                    logError("New errors detected: " + (newCount - errors));
                    errors = newCount;
                }
                pinger.restart();
            });
        }, 250);
    })
        .catch((error) => {
        logError(error);
    });
}
//# sourceMappingURL=cli.js.map