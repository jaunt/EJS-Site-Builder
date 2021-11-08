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
  const aof: string[] = arrayOfFiles || [];
  try {
    const files = fs.readdirSync(dirPath);
    files.forEach(function (file) {
      if (fs.statSync(dirPath + "/" + file).isDirectory()) {
        arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
      } else {
        aof.push(fspath.join("./", dirPath, "/", file));
      }
    });
  } catch (error) {
    arrayOfFiles = [];
  }
  return aof;
};

export { isRelative, getAllFiles };
