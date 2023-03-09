const Diff2html = require("diff2html");
const { execFileSync } = require("child_process");
const fs = require("fs-extra");

const diff2htmlstyle = `
<!-- CSS -->
<link rel="stylesheet" type="text/css" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css" />

<!-- Javascripts -->
<script type="text/javascript" src="https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html-ui.min.js"></script>
`;

const test = (CliFry) => {
  return new Promise(async function (resolve, reject) {
    const testRun = CliFry(
      {
        name: "Simple Test 1",
        description: "Make sure a simple template outputs properly.",
        timeout: 5000,
      },
      // arguments
      [
        "--input",
        "./templates",
        "--output",
        "./output",
        "--cache",
        "./cache",
        "--noWatch",
      ]
    );

    try {
      await testRun.start(100);
      testRun.log("untilstopped");
      await testRun.untilStopped(5000);
      testRun.log("stopped");
      try {
        testRun.log("dif");
        execFileSync("diff", [
          "--unified",
          "-r",
          testRun.dir + "/expected/",
          testRun.dir + "/output/",
        ]);
        resolve("success");
      } catch (error) {
        testRun.log(error);
        const out = error.stdout.toString();
        testRun.log(out);
        const diffHtml = Diff2html.html(out, {
          drawFileList: true,
        });
        testRun.log(testRun.dir + "/diff.html");
        try {
          fs.writeFileSync(
            testRun.dir + "/diff.html",
            diff2htmlstyle + "\n" + diffHtml
          );
        } catch (error) {
          testRun.log(error);
        }
        reject("Output does not match expected");
      }
    } catch (error) {
      reject(error);
    }
  });
};

module.exports = test;
