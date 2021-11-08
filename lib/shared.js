"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllFiles = exports.isRelative = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
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
    const aof = arrayOfFiles || [];
    try {
        const files = fs_1.default.readdirSync(dirPath);
        files.forEach(function (file) {
            if (fs_1.default.statSync(dirPath + "/" + file).isDirectory()) {
                arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
            }
            else {
                aof.push(path_1.default.join("./", dirPath, "/", file));
            }
        });
    }
    catch (error) {
        arrayOfFiles = [];
    }
    return aof;
};
exports.getAllFiles = getAllFiles;
//# sourceMappingURL=shared.js.map