const Diff2html = require("diff2html");
const { execFileSync } = require("child_process");
const fs = require("fs-extra");

const diff2htmlstyle = `
<!-- CSS -->
<link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css" />

<!-- Javascripts -->
<script type="text/javascript" src="https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html-ui.min.js"></script>
`;

const copyInputs = (testRunDir, time) => {
  fs.copySync(
    testRunDir + "/templates-time-" + time,
    testRunDir + "/templates"
  );
  fs.copySync(testRunDir + "/data-time-" + time, testRunDir + "/data");
};

const outputMatchesExpected = (testRunDir, time) => {
  //  copy output to output-time-N and compare compare with expected-time-N
  fs.rmSync(testRunDir + "/output-time-" + time, {
    recursive: true,
    force: true,
  });
  fs.copySync(testRunDir + "/output", testRunDir + "/output-time-" + time);
  try {
    execFileSync("diff", [
      "--unified",
      "-r",
      testRunDir + "/output-time-" + time,
      testRunDir + "/expected-time-" + time,
    ]);
    return true;
  } catch (error) {
    const out = error.stdout.toString();
    const diffHtml = Diff2html.html(out, {
      drawFileList: true,
    });
    fs.writeFile(testRunDir + "/diff.html", diff2htmlstyle + "\n" + diffHtml);
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
    copyInputs(testRun.dir, 0);

    // STEP 3, start AirFry
    testRun.start();

    // STEP 4, wait for airfry to be done initial run.
    await testRun.untilOutputIncludes("Watching for changes");
    // and a bit in case file system is writing?
    await testRun.sleep(1000);

    if (!outputMatchesExpected(testRun.dir, 0)) {
      reject("Output does not match expected at time " + 0);
      return;
    }

    testRun.log("Time 0 Matched");

    // STEP 4, loop through time tests {
    //  copy time data-time-N and templates-time-N contents recursively into data and templates
    //  wait for settle
    //  copy output to output-time-N compare with expected-time-N
    // }
    for (let i = 1; i <= lastTest; i++) {
      copyInputs(testRun.dir, i);
      await testRun.waitUntilOutputIdleSeconds(5);
      if (!outputMatchesExpected(testRun.dir, i)) {
        reject("Output does not match expected at time " + i);
        return;
      }
      testRun.log("Time " + i + " Matched");
    }

    testRun.forceStop();
    await testRun.sleep(1000);

    resolve("success");
  });
};

module.exports = test;
