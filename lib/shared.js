"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeLoggers = exports.Pinger = exports.getAllFiles = exports.isRelative = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
/// ----------------------------------------------------------------------------
/// Safety to prevent user from accidently
/// writing files outside the output directory
/// ----------------------------------------------------------------------------
const isRelative = (parent, dir) => {
    const relative = path_1.default.relative(parent, dir);
    return (Boolean(relative == "") ||
        (Boolean(relative) &&
            !relative.startsWith("..") &&
            !path_1.default.isAbsolute(relative)));
};
exports.isRelative = isRelative;
/// -----------------------------------------------------------------------------
/// Scanning for files
/// -----------------------------------------------------------------------------
const getAllFiles = function (dirPath, arrayOfFiles) {
    const resDir = path_1.default.resolve(dirPath);
    const aof = arrayOfFiles || [];
    try {
        const files = fs_1.default.readdirSync(resDir);
        files.forEach(function (file) {
            if (fs_1.default.statSync(resDir + "/" + file).isDirectory()) {
                arrayOfFiles = getAllFiles(resDir + "/" + file, aof);
            }
            else {
                aof.push(resDir + "/" + file);
            }
        });
    }
    catch (error) {
        arrayOfFiles = [];
    }
    return aof;
};
exports.getAllFiles = getAllFiles;
/// -----------------------------------------------------------------------------
/// Simple pinger until done is called
/// -----------------------------------------------------------------------------
class Pinger {
    constructor(id, func, timeout = 2000) {
        this._done = false;
        this.timer = null;
        this.id = id;
        this.ping = func;
        this._startTimer();
        this.timeout = timeout;
    }
    _startTimer() {
        this.timer = setTimeout(() => {
            this.ping(this.id);
            if (!this._done)
                this._startTimer();
        }, this.timeout);
    }
    stop() {
        if (this.timer) {
            clearTimeout(this.timer);
        }
    }
    restart() {
        this.stop();
        this._startTimer();
    }
}
exports.Pinger = Pinger;
const _formatLog = (prefix, useChalk = chalk_1.default.green, ...args) => {
    for (let arg of args) {
        let txt;
        if (typeof arg === "string" || arg instanceof String) {
            txt = arg;
        }
        else {
            txt = JSON.stringify(arg, null, 2);
        }
        console.log(useChalk(prefix + chalk_1.default.bgWhite(arg)));
    }
};
const makeLoggers = (prefix, errorFlag = "[ERROR] ", goodColor = chalk_1.default.green, badColor = chalk_1.default.red) => {
    return {
        log: _formatLog.bind(null, prefix, goodColor),
        logError: _formatLog.bind(null, prefix + errorFlag, badColor),
    };
};
exports.makeLoggers = makeLoggers;
//# sourceMappingURL=shared.js.map