const Diff2html = require("diff2html");
const { execFileSync } = require("child_process");
const fs = require("fs-extra");

const diff2htmlstyle = `
<!-- CSS -->
<link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css" />

<!-- Javascripts -->
<script type="text/javascript" src="https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html-ui.min.js"></script>
`;

const copyInputs = (testRun, time) => {
  const templates = testRun.dir + "/templates-time-" + time;
  const data = testRun.dir + "/data-time-" + time;
  if (fs.existsSync(templates)) {
    fs.copySync(templates, testRun.dir + "/templates");
  }
  if (fs.existsSync(data)) {
    fs.copySync(data, testRun.dir + "/data");
  }
};

const outputMatchesExpected = (testRun, time) => {
  const outputDir = testRun.dir + "/output";
  if (!fs.existsSync(outputDir)) {
    // do something
    testRun.error(outputDir + " does not exist.");
    return false;
  }
  //  copy output to output-time-N and compare compare with expected-time-N
  fs.rmSync(testRun.dir + "/output-time-" + time, {
    recursive: true,
    force: true,
  });
  fs.copySync(outputDir, testRun.dir + "/output-time-" + time);
  const expectedDir = testRun.dir + "/expected-time-" + time;
  if (!fs.existsSync(testRun.dir + "/expected-time-" + time)) {
    // do something
    testRun.error(expectedDir + " does not exist.");
    return false;
  }
  try {
    execFileSync("diff", [
      "--unified",
      "-r",
      testRun.dir + "/output-time-" + time,
      expectedDir,
    ]);
    return true;
  } catch (error) {
    const out = error.stdout.toString();
    const diffHtml = Diff2html.html(out, {
      drawFileList: true,
    });
    fs.writeFile(testRun.dir + "/diff.html", diff2htmlstyle + "\n" + diffHtml);
    return false;
  }
};

const lastTest = 2; // number of final time test

const test = (CliFry) => {
  return new Promise(async function (resolve, reject) {
    const testRun = CliFry(
      {
        name: "Advanced Test",
        description: "Run through all features.",
      },
      // arguments
      [
        "--input ./templates",
        "--output ./output",
        "--data ./data",
        "--cache ./cache",
      ]
    );

    // STEP 1, clear all folders
    fs.rmSync(testRun.dir + "/data", { recursive: true, force: true });
    fs.rmSync(testRun.dir + "/templates", { recursive: true, force: true });
    fs.rmSync(testRun.dir + "/output", { recursive: true, force: true });
    fs.rmSync(testRun.dir + "/cache", { recursive: true, force: true });

    // STEP 2, copy templates-time-0 and data-time-0 to data and templates
    copyInputs(testRun, 0);

    try {
      // STEP 3, start AirFry
      await testRun.start(100);

      // STEP 4, wait for airfry to be done initial run.
      await testRun.untilStdoutIncludes("Watching for changes", 5000);
      // and a bit in case file system is writing?
      await testRun.sleep(100);

      if (!outputMatchesExpected(testRun, 0)) {
        reject("Failed to match expected at time " + 0);
        return;
      }

      testRun.log("Time 0 Matched");

      // STEP 4, loop through time tests {
      //  copy time data-time-N and templates-time-N contents recursively into data and templates
      //  wait for settle
      //  copy output to output-time-N compare with expected-time-N
      // }
      for (let i = 1; i <= lastTest; i++) {
        testRun.log("\n\nSTARTING SUBTEST " + i + "\n");
        copyInputs(testRun, i);
        await testRun.untilOutputIdleSeconds(2, 5000);
        if (!outputMatchesExpected(testRun, i)) {
          reject("Failed to match expected at time " + i);
          return;
        }
        testRun.log("Time " + i + " Matched");
      }

      testRun.forceStop();
      await testRun.untilStopped(3000);

      resolve("success");
    } catch (error) {
      reject("Advanced test failed.");
    }
  });
};

module.exports = test;
