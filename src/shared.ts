import fs from "fs";
import fspath from "path";

/// ----------------------------------------------------------------------------
/// Safety to prevent user from accidently
/// writing files outside the output directory
/// ----------------------------------------------------------------------------
const isRelative = (parent: string, dir: string): Boolean => {
  const relative = fspath.relative(parent, dir);
  return (
    Boolean(relative == "") ||
    (Boolean(relative) &&
      !relative.startsWith("..") &&
      !fspath.isAbsolute(relative))
  );
};

/// -----------------------------------------------------------------------------
/// Scanning for files
/// -----------------------------------------------------------------------------
const getAllFiles = function (
  dirPath: string,
  arrayOfFiles?: string[]
): string[] {
  const resDir = fspath.resolve(dirPath);
  const aof: string[] = arrayOfFiles || [];
  try {
    const files = fs.readdirSync(resDir);
    files.forEach(function (file) {
      if (fs.statSync(resDir + "/" + file).isDirectory()) {
        arrayOfFiles = getAllFiles(resDir + "/" + file, aof);
      } else {
        aof.push(resDir + "/" + file);
      }
    });
  } catch (error) {
    arrayOfFiles = [];
  }
  return aof;
};

export { isRelative, getAllFiles };
